import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';
import { DEFAULT_TEMPLATE, renderTemplate } from '@/lib/invoice-email-template';
import { isSettledToNothing } from '@/lib/invoice-amount';

/**
 * What would go out, and what would not, before anything does.
 *
 * Sixty emails cannot be recalled, and from the moment HexaBee sends them the
 * mistake is ours rather than the merchant's. So the send screen is built
 * around this answer and the button is the small part at the end of it.
 *
 * Four rules decide who is on the list, and each one exists because the
 * alternative is a letter arriving somewhere it should not:
 *
 * - **Only invoices this merchant uploaded.** A row that arrived by BCC was
 *   already emailed to the payer by the merchant themselves - that is what BCC
 *   means - so sending it again is a duplicate nobody asked for.
 * - **Only invoices not already sent by us**, so a batch interrupted by
 *   Resend's daily cap resumes instead of starting over.
 * - **Only invoices with a recipient.** Nothing unmatched ever goes out.
 * - **Only invoices that were read**: a number and an amount. An amount of zero
 *   or less still goes - the payer is entitled to the statement that they owe
 *   nothing - it simply carries no payment link.
 */

type Row = {
  id: string;
  payer_name: string | null;
  payer_email: string | null;
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  due_date: string | null;
  line_items: unknown;
  sent_at: string | null;
};

/**
 * What the invoice charges for, one line each. Mirrors `breakdown_text` in the
 * Python sender exactly - a preview that formats this differently from the send
 * is worse than no preview, because the merchant proofreads the wrong thing.
 */
function breakdownText(items: unknown, currency: string | null): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  const cur = (currency ?? 'EUR').toUpperCase();
  return items
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const description = String(row.description ?? '').trim();
      if (!description) return null;
      let qty = String(row.qty ?? '').trim();
      if (qty === '1' || qty === '1,00' || qty === '1.00') qty = '';
      const amount = String(row.amount ?? '').trim();
      const left = qty ? `${description} (${qty})` : description;
      return amount ? `${left} - ${amount} ${cur}` : left;
    })
    .filter(Boolean)
    .join('\n');
}

const SELECT = (hasSendColumns: boolean) => `
  SELECT id, payer_name, payer_email, invoice_number, amount, currency, due_date,
         ${hasSendColumns ? 'line_items, sent_at' : 'NULL::jsonb AS line_items, NULL::timestamp AS sent_at'}
    FROM merchant_invoices
   WHERE merchant_id = $1
     AND status = 'issued'
     AND source = 'upload'
   ORDER BY created_at DESC
   LIMIT 500`;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rows: Row[] = [];
  try {
    rows = await query<Row>(SELECT(true), [session.id]);
  } catch (err) {
    if (!/sent_at/.test(String(err))) {
      // The ledger table may not exist at all in a fresh environment.
      console.error('[send-preview] query failed', String(err));
      return NextResponse.json({ ready: [], blocked: [], alreadySent: 0, sample: null });
    }
    console.warn('[send-preview] send columns missing - backend deploy pending');
    rows = await query<Row>(SELECT(false), [session.id]);
  }

  const alreadySent = rows.filter(r => r.sent_at).length;
  const pending = rows.filter(r => !r.sent_at);

  const readable = (r: Row) => !!r.invoice_number && r.amount !== null;
  const ready = pending.filter(r => readable(r) && !!r.payer_email);
  const blocked = pending
    .filter(r => !(readable(r) && !!r.payer_email))
    .map(r => ({
      id: r.id,
      payer_name: r.payer_name,
      invoice_number: r.invoice_number,
      // Named, not generic: "something is missing" leaves the merchant with
      // nowhere to go, and they are standing at the screen that can fix it.
      reason: !readable(r) ? 'unreadable' : 'no_recipient',
    }));

  // The letter as the first recipient would actually read it. A preview built
  // from invented data proves nothing about the one thing that goes wrong -
  // a token that does not resolve.
  let sample: { to: string; subject: string; body: string } | null = null;
  // Whether the invoice itself rides along. Stated here because it is off
  // unless the merchant ticked it, and the one place that must never surprise
  // them is the screen that says what is about to happen.
  let attachPdf = false;
  if (ready.length > 0) {
    type Tpl = {
      invoice_email_subject: string | null;
      invoice_email_body: string | null;
      reminder_language: string | null;
      business_country: string | null;
      attach_invoice_pdf: boolean | null;
    };
    let tpl: Tpl | null = null;
    try {
      tpl = await queryOne<Tpl>(
        `SELECT invoice_email_subject, invoice_email_body, reminder_language, business_country,
                attach_invoice_pdf
           FROM merchants WHERE id = $1`,
        [session.id]
      );
    } catch { /* columns pending; the defaults below still apply */ }
    attachPdf = tpl?.attach_invoice_pdf === true;

    const first = ready[0];
    // Which language the default is written in, resolved exactly the way
    // reminders resolve it (`reminder_lang` in reminders.py): the merchant's
    // explicit choice wins, otherwise a Lithuanian business gets Lithuanian and
    // everyone else English. There is no browser toggle to read here - this
    // also runs from a background send - and `business_country` DEFAULTs to
    // 'GB', so English is the fallback rather than a decision.
    const lang = (tpl?.reminder_language ?? '').toLowerCase() === 'lt'
      || ((tpl?.reminder_language ?? '') === '' && (tpl?.business_country ?? '').toUpperCase() === 'LT')
      ? 'lt' : 'en';
    const defaults = DEFAULT_TEMPLATE[lang];
    const vars = {
      name: first.payer_name,
      invoice: first.invoice_number,
      amount: first.amount !== null
        ? `${Number(first.amount).toFixed(2)} ${(first.currency ?? 'EUR').toUpperCase()}`
        : '',
      due: first.due_date ? String(first.due_date).slice(0, 10) : '',
      // Rendered the same way the sender renders it, so the preview is the
      // letter and not an approximation of it.
      breakdown: breakdownText(first.line_items, first.currency),
    };
    sample = {
      to: first.payer_email!,
      subject: renderTemplate(tpl?.invoice_email_subject || defaults.subject, vars),
      body: renderTemplate(tpl?.invoice_email_body || defaults.body, vars),
    };
  }

  return NextResponse.json({
    attachPdf,
    alreadySent,
    ready: ready.map(r => ({
      id: r.id,
      payer_name: r.payer_name,
      payer_email: r.payer_email,
      invoice_number: r.invoice_number,
      amount: r.amount,
      currency: r.currency,
      nothing_to_pay: isSettledToNothing(r.amount),
    })),
    blocked,
    sample,
  });
}
