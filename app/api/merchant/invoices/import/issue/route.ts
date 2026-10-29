import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { readXlsxSheet } from '@/lib/xlsx-read';
import { buildInvoices, type ImportMapping } from '@/lib/invoice-import';
import { renderInvoicePdf } from '@/lib/invoice-pdf';
import { toInvoiceDoc, issueKeyFor, type IssueSettings } from '@/lib/invoice-issue';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Issue a chunk of the invoices a spreadsheet describes.
 *
 * Same shape as the invoice send, and for the same reasons:
 *
 * - **A chunk at a time, each row committed before the next is attempted.**
 *   Fifty-six allocate-render-store cycles in one request would pass any
 *   serverless limit, and the merchant would be left with a spinner and no idea
 *   which invoices exist. The browser loops.
 * - **An ordinary failure stops that invoice, not the batch.** The reason comes
 *   back against the row, and the rest still get their turn.
 * - ⚠️ **Nothing is sent.** Issuing creates `source = 'issued'` rows with
 *   `sent_at` NULL; sending stays the separate, resumable step with its own
 *   preview. Half a parent list receiving an invoice while the school believes
 *   everyone did is the worst failure this product has had, and that rule does
 *   not get relaxed because the documents are now ours.
 *
 * ⚠️ **The order is allocate, then render, then store - never the other way.**
 * The number has to be on the document, so it is allocated first; it is
 * allocated by the backend inside one transaction on a locked merchant row, and
 * the ledger is asked whether it is already taken. A crash between allocating
 * and storing leaves a GAP in the series, which is explainable to an
 * accountant. A duplicate is not, and the unique index would collapse the two
 * documents into one row.
 *
 * **Termination.** The caller loops while `issued > 0`. Not while
 * `remaining > 0`: a row that keeps failing would then loop for ever.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_CHUNK = 10;

type Outcome = {
  sheetRow: number;
  payerName: string;
  subjectName: string | null;
  ok: boolean;
  invoiceNumber?: string;
  payable?: number;
  reason?: string;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const base = process.env.ADMIN_API_BASE_URL?.replace(/\/$/, '');
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const headers = { 'Content-Type': 'application/json', 'X-Internal-Token': token };

  let file: File | null = null;
  let mappingOverride: ImportMapping | null = null;
  let dueDate: string | null = null;
  let issueDate: string | null = null;
  let limit = DEFAULT_CHUNK;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
    const m = form.get('mapping');
    if (typeof m === 'string' && m.trim()) mappingOverride = JSON.parse(m) as ImportMapping;
    const d = form.get('dueDate');
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) dueDate = d;
    const i = form.get('issueDate');
    if (typeof i === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i)) issueDate = i;
    const l = form.get('limit');
    if (typeof l === 'string' && /^\d+$/.test(l)) limit = Math.min(Math.max(1, Number(l)), 25);
  } catch {
    return NextResponse.json({ error: 'invalid_upload' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  let settings: IssueSettings;
  try {
    const res = await fetch(
      `${base}/api/plugin/merchant-invoice-settings?merchant_id=${encodeURIComponent(session.id)}`,
      { headers: { 'X-Internal-Token': token }, cache: 'no-store' }
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    settings = (await res.json()) as IssueSettings;
  } catch (err) {
    console.error('[import/issue] settings unreachable', String(err));
    return NextResponse.json({ error: 'upstream' }, { status: 502 });
  }

  // ⚠️ Refused here as well as at the allocator. A merchant who has not said
  // whether they charge VAT must not get as far as a document, and checking
  // before the loop means their series gains no gaps while they find out.
  if (settings.blockers?.length) {
    return NextResponse.json({ error: 'not_ready', blockers: settings.blockers }, { status: 409 });
  }

  const mapping = mappingOverride ?? (settings.invoice_import_mapping as ImportMapping | null);
  if (!mapping) return NextResponse.json({ error: 'no_mapping' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let built;
  let batch: string;
  try {
    const sheet = readXlsxSheet(buffer, mapping.sheet ?? 0);
    batch = sheet.name;
    built = buildInvoices(sheet, mapping);
  } catch (err) {
    console.warn('[import/issue] file or mapping rejected', String(err));
    return NextResponse.json({ error: 'unreadable_file', detail: String(err) }, { status: 400 });
  }

  // Which of this batch already exist, so a second run continues rather than
  // duplicating. The backend refuses a duplicate key anyway - this is what
  // keeps the chunking from re-attempting the same rows for ever.
  const done = new Set<string>();
  try {
    const res = await fetch(
      `${base}/api/plugin/merchant-invoices/issued-keys?merchant_id=${encodeURIComponent(session.id)}&batch=${encodeURIComponent(batch)}`,
      { headers: { 'X-Internal-Token': token }, cache: 'no-store' }
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { issued?: { issue_key: string }[] };
    for (const row of data.issued ?? []) done.add(row.issue_key);
  } catch (err) {
    // ⚠️ Refused rather than assumed empty: assuming nothing is issued yet is
    // exactly how every family gets a second invoice.
    console.error('[import/issue] issued-keys unreadable', String(err));
    return NextResponse.json({ error: 'issued_keys_unreadable' }, { status: 502 });
  }

  const pending = built.ready.filter(row => !done.has(issueKeyFor(batch, row)));
  const chunk = pending.slice(0, limit);

  const today = new Date().toISOString().slice(0, 10);
  const ctx = {
    number: '',
    issueDate: issueDate ?? today,
    dueDate,
    currency: 'EUR',
    // ⚠️ Unknown until the merchant's accounting can be read - see
    // INVOICE_ISSUING.md 2.3. The generator then omits the balance block
    // rather than printing 0,00, and says so in `balanceKnown`.
    openingBalance: null as number | null,
    // Both pending the merchant's answer; the generator supports them already.
    amountInWords: false,
    issuedBy: null as string | null,
    note: null as string | null,
    lang: 'lt' as const,
  };

  const outcomes: Outcome[] = [];
  let issued = 0;

  for (const row of chunk) {
    const label: Outcome = {
      sheetRow: row.sheetRow, payerName: row.payerName,
      subjectName: row.subjectName, ok: false,
    };
    const perRowDue = row.dueDate ?? dueDate;
    try {
      // 1. The number, allocated and committed by the backend.
      const alloc = await fetch(`${base}/api/plugin/merchant-invoices/allocate-number`, {
        method: 'POST', headers,
        body: JSON.stringify({ merchant_id: session.id, issue_date: ctx.issueDate }),
      });
      if (!alloc.ok) {
        const detail = await alloc.json().catch(() => ({}));
        console.error('[import/issue] allocate failed', alloc.status, detail);
        outcomes.push({ ...label, reason: alloc.status === 409 ? 'numbering' : 'upstream' });
        continue;
      }
      const { number, issue_date } = (await alloc.json()) as { number: string; issue_date: string };

      // 2. The document, carrying that exact number.
      const rendered = await renderInvoicePdf(
        toInvoiceDoc(row, settings, { ...ctx, number, issueDate: issue_date, dueDate: perRowDue })
      );

      // 3. The ledger row, with the figure the document states.
      const create = await fetch(`${base}/api/plugin/merchant-invoices/issue`, {
        method: 'POST', headers,
        body: JSON.stringify({
          merchant_id: session.id,
          invoice_number: number,
          issue_key: issueKeyFor(batch, row),
          issue_date,
          due_date: perRowDue,
          // ⚠️ Cents, from the one function that computes the payable. The row
          // and the document cannot disagree, because this is the figure the
          // document printed.
          amount_cents: rendered.payable,
          currency: ctx.currency,
          payer_name: row.payerName,
          payer_email: row.payerEmail,
          payer_phone: row.payerPhone,
          payment_purpose: row.subjectName
            ? toInvoiceDoc(row, settings, { ...ctx, number }).paymentPurpose
            : null,
          line_items: row.lines.map(l => ({
            description: l.description,
            qty: l.qty ?? null,
            amount: (l.amount / 100).toFixed(2),
          })),
          pdf: Buffer.from(rendered.bytes).toString('base64'),
        }),
      });
      const data = await create.json().catch(() => ({}));
      if (!create.ok) {
        console.error('[import/issue] create failed', create.status, data);
        outcomes.push({ ...label, reason: 'upstream' });
        continue;
      }
      if (data.ok === false) {
        // Already issued under a key we did not see - a second tab, a retry.
        // Not a failure: the invoice exists, which is what was wanted.
        outcomes.push({ ...label, ok: true, invoiceNumber: data.invoice_number, reason: 'already_issued' });
        issued += 1;
        continue;
      }
      outcomes.push({ ...label, ok: true, invoiceNumber: number, payable: rendered.payable });
      issued += 1;
    } catch (err) {
      // One invoice's problem, not the batch's.
      console.error('[import/issue] row failed', row.sheetRow, String(err));
      outcomes.push({ ...label, reason: 'render_failed' });
    }
  }

  const remaining = pending.length - issued;
  console.log(
    `[import/issue] merchant=${session.id} batch=${JSON.stringify(batch)} issued=${issued} ` +
      `failed=${chunk.length - issued} remaining=${remaining}`
  );
  return NextResponse.json({
    ok: true, batch, issued, failed: chunk.length - issued, remaining, outcomes,
  });
}
