import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { buildManualInvoice, type ManualInvoiceInput } from '@/lib/invoice-manual';
import { renderInvoicePdf } from '@/lib/invoice-pdf';
import { toInvoiceDoc, type IssueSettings } from '@/lib/invoice-issue';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Issue ONE invoice, typed by hand.
 *
 * ⚠️ **The same three steps as the batch, in the same order.** Allocate the
 * number, render the document, store the row - see
 * `app/api/merchant/invoices/import/issue`. A crash between them leaves a gap
 * in the merchant's series, which an accountant can be told about, where a
 * duplicate cannot. Nothing here re-derives a figure: `renderInvoicePdf`
 * returns the payable the document printed and that is what the ledger stores.
 *
 * Built after the Inga Motuzaitė demo - a lecturer invoicing a few people has
 * no spreadsheet to import, and the PDF upload path assumes a document she
 * would first have to produce somewhere else.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const base = process.env.ADMIN_API_BASE_URL?.replace(/\/$/, '');
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const headers = { 'Content-Type': 'application/json', 'X-Internal-Token': token };

  let input: ManualInvoiceInput;
  try {
    input = (await req.json()) as ManualInvoiceInput;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // ⚠️ Required, exactly as in the batch (2026-11-04). It is the date the
  // reminder loop counts from, and Centas refuses a document without it. One
  // invoice is not a reason for a different rule.
  const dueDate = (input.dueDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: 'no_due_date' }, { status: 400 });
  }

  const built = buildManualInvoice({ ...input, dueDate });
  if (!built.ok) {
    return NextResponse.json({ error: built.error, field: built.field }, { status: 400 });
  }

  // The letterhead, and whatever still stops this merchant issuing at all.
  let settings: IssueSettings & { blockers?: string[] };
  try {
    const res = await fetch(
      `${base}/api/plugin/merchant-invoice-settings?merchant_id=${encodeURIComponent(session.id)}`,
      { headers: { 'X-Internal-Token': token }, cache: 'no-store' }
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    settings = await res.json();
  } catch (err) {
    console.error('[issue-one] settings unreadable', String(err));
    return NextResponse.json({ error: 'upstream' }, { status: 502 });
  }
  if (settings.blockers?.length) {
    return NextResponse.json({ error: 'not_ready', blockers: settings.blockers }, { status: 409 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const ctx = {
    number: '',
    issueDate: (input as { issueDate?: string }).issueDate?.trim() || today,
    dueDate,
    currency: 'EUR',
    openingBalance: null as number | null,
    amountInWords: false,
    issuedBy: null as string | null,
    note: null as string | null,
    lang: 'lt' as const,
  };

  try {
    // 1. The number.
    const alloc = await fetch(`${base}/api/plugin/merchant-invoices/allocate-number`, {
      method: 'POST', headers,
      body: JSON.stringify({ merchant_id: session.id, issue_date: ctx.issueDate }),
    });
    if (!alloc.ok) {
      const detail = await alloc.json().catch(() => ({}));
      console.error('[issue-one] allocate failed', alloc.status, detail);
      return NextResponse.json(
        { error: alloc.status === 409 ? 'numbering' : 'upstream' },
        { status: alloc.status === 409 ? 409 : 502 }
      );
    }
    const { number, issue_date } = (await alloc.json()) as { number: string; issue_date: string };

    // 2. The document.
    const doc = toInvoiceDoc(built.invoice, settings, { ...ctx, number, issueDate: issue_date });
    const rendered = await renderInvoicePdf(doc);

    // 3. The ledger row, carrying the figure the document states.
    const create = await fetch(`${base}/api/plugin/merchant-invoices/issue`, {
      method: 'POST', headers,
      body: JSON.stringify({
        merchant_id: session.id,
        invoice_number: number,
        // ⚠️ **NULL, deliberately.** `issue_key` exists to stop a re-imported
        // spreadsheet issuing every row a second time - a mistake nobody can
        // see happening. Pressing this button twice is a deliberate act with
        // the result on screen, and a merchant may legitimately invoice the
        // same person twice in a day. The index is partial, so NULL is
        // allowed and no uniqueness is claimed.
        issue_key: null,
        issue_date,
        due_date: dueDate,
        amount_cents: rendered.payable,
        currency: ctx.currency,
        payer_name: built.invoice.payerName,
        payer_email: built.invoice.payerEmail,
        payer_email_cc: built.invoice.payerEmailCc,
        payer_phone: built.invoice.payerPhone,
        payment_purpose: doc.paymentPurpose ?? null,
        line_items: built.invoice.lines.map(l => ({
          description: l.description,
          qty: l.qty ?? null,
          amount: (l.amount / 100).toFixed(2),
        })),
        pdf: Buffer.from(rendered.bytes).toString('base64'),
      }),
    });
    const data = await create.json().catch(() => ({}));
    if (!create.ok || data.ok === false) {
      console.error('[issue-one] create failed', create.status, data);
      return NextResponse.json({ error: 'upstream' }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      invoice_number: number,
      issue_date,
      due_date: dueDate,
      // Cents, so the screen states what the document states rather than
      // adding the lines up a second time.
      amount_cents: rendered.payable,
      // ⚠️ Nothing has been sent. The merchant sends from the Invoices page,
      // which is the same rule the batch follows - issuing and sending are
      // two decisions and must stay two presses.
      sent: false,
    });
  } catch (err) {
    console.error('[issue-one] failed', String(err));
    return NextResponse.json({ error: 'upstream' }, { status: 502 });
  }
}
