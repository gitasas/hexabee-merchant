import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';
import { parseStatement, matchStatement, type OpenInvoice } from '@/lib/bank-statement';

export const runtime = 'nodejs';

/**
 * Upload a bank statement (camt.053 / camt.054 XML) and close the invoices it
 * settles (2026-11-12). The merchant downloads the file from their own bank;
 * nothing here connects to a bank, which is why no licence is needed.
 *
 * - Only lines that NAME an invoice and pay its exact amount close it
 *   (`lib/bank-statement.ts`); everything else comes back as a suggestion the
 *   merchant confirms with the ordinary "mark paid" button.
 * - Closed rows get `paid_source = 'statement'`. Like `manual` and `centas`
 *   this writes no `merchant_payments` row: we did not process the money and
 *   must never bill 0,39 EUR for it.
 * - `merchant_statement_entries` remembers the lines that closed something, so
 *   uploading the same statement twice closes nothing twice.
 */

const MAX_BYTES = 8 * 1024 * 1024;

type Row = {
  id: string; invoice_number: string | null; amount: string | null; currency: string | null;
  payer_name: string | null; payment_purpose: string | null; status: string;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let xml = '';
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
    xml = await file.text();
  } catch {
    return NextResponse.json({ error: 'no_file' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseStatement(xml);
  } catch {
    return NextResponse.json({ error: 'not_camt' }, { status: 422 });
  }

  // Lines already used to close something, from an earlier upload.
  let seen = new Set<string>();
  try {
    const keys = parsed.credits.map(c => c.key);
    if (keys.length) {
      const rows = await query<{ entry_key: string }>(
        `SELECT entry_key FROM merchant_statement_entries WHERE merchant_id = $1 AND entry_key = ANY($2)`,
        [session.id, keys]
      );
      seen = new Set(rows.map(r => r.entry_key));
    }
  } catch (err) {
    console.error('[statement] table not ready', String(err));
    return NextResponse.json({ error: 'not_ready' }, { status: 503 });
  }
  const fresh = parsed.credits.filter(c => !seen.has(c.key));

  const rows = await query<Row>(
    `SELECT id, invoice_number, amount::text, currency, payer_name, payment_purpose, status
       FROM merchant_invoices
      WHERE merchant_id = $1 AND invoice_number IS NOT NULL AND amount > 0`,
    [session.id]
  );
  const invoices: OpenInvoice[] = rows.map(r => ({
    id: r.id,
    invoiceNumber: r.invoice_number ?? '',
    amountCents: Math.round(Number(r.amount ?? 0) * 100),
    currency: (r.currency ?? 'EUR').toUpperCase(),
    payerName: r.payer_name,
    paymentPurpose: r.payment_purpose,
    status: r.status,
  }));
  const byId = new Map(invoices.map(i => [i.id, i]));
  const brief = (id: string) => {
    const i = byId.get(id)!;
    return { id, invoiceNumber: i.invoiceNumber, amount: (i.amountCents / 100).toFixed(2), currency: i.currency, payerName: i.payerName };
  };

  const closed: unknown[] = [];
  const suggested: unknown[] = [];
  const already: unknown[] = [];
  const unmatched: unknown[] = [];

  for (const { entry, outcome } of matchStatement(fresh, invoices)) {
    const line = {
      amount: (entry.amountCents / 100).toFixed(2), currency: entry.currency,
      bookedOn: entry.bookedOn, debtor: entry.debtor, text: entry.remittance.slice(0, 200),
    };
    if (outcome.kind === 'close') {
      // The status guard makes a race with a webhook or a second tab harmless.
      const done = await query<{ id: string }>(
        `UPDATE merchant_invoices
            SET status = 'paid', paid_at = COALESCE($3::date, NOW()), paid_source = 'statement'
          WHERE id = $1 AND merchant_id = $2 AND status <> 'paid'
          RETURNING id`,
        [outcome.invoiceId, session.id, entry.bookedOn]
      );
      if (done.length) {
        await query(
          `INSERT INTO merchant_statement_entries (merchant_id, entry_key, invoice_id, amount, booked_on)
           VALUES ($1, $2, $3, $4, $5::date) ON CONFLICT (merchant_id, entry_key) DO NOTHING`,
          [session.id, entry.key.slice(0, 200), outcome.invoiceId, line.amount, entry.bookedOn]
        );
        closed.push({ line, invoice: brief(outcome.invoiceId) });
      } else {
        already.push({ line, invoice: brief(outcome.invoiceId) });
      }
    } else if (outcome.kind === 'already') {
      already.push({ line, invoice: brief(outcome.invoiceId) });
    } else if (outcome.kind === 'suggest') {
      suggested.push({ line, why: outcome.why, invoices: outcome.invoiceIds.map(brief) });
    } else {
      unmatched.push({ line });
    }
  }

  return NextResponse.json({
    credits: parsed.credits.length,
    debitsSkipped: parsed.debitsSkipped,
    seenBefore: seen.size,
    closed, suggested, already, unmatched,
  });
}
