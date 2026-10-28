import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

type InvoiceRow = {
  id: string;
  payer_email: string | null;
  payer_email_cc: string | null;
  payer_phone: string | null;
  payer_name: string | null;
  payment_purpose: string | null;
  sent_at: string | null;
  sms_sent_at: string | null;
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  due_date: string | null;
  status: string;
  email_subject: string | null;
  pdf_filename: string | null;
  paid_at: string | null;
  paid_source: string | null;
  payer_claimed_at: string | null;
  created_at: string;
  reminders_sent: number | null;
  last_reminder_at: string | null;
  has_pdf: boolean | null;
  // 'bcc' (the merchant emailed it themselves) or 'upload' (we still have to).
  // The page needs it to tell "not sent yet" from "sent, just not by us".
  source: string | null;
};

// Columns the backend adds by migration. This app can deploy first, and then the
// SELECT fails on a column that is not there yet - with the catch-all below that
// reads to the merchant as "you have no invoices", which is worse than the
// missing column. So each one carries a fallback and is dropped individually.
const OPTIONAL: Record<string, string> = {
  due_date: 'NULL::date AS due_date',
  paid_source: 'NULL::text AS paid_source',
  payer_claimed_at: 'NULL::timestamp AS payer_claimed_at',
  payer_email_cc: 'NULL::text AS payer_email_cc',
  payer_phone: 'NULL::text AS payer_phone',
  payer_name: 'NULL::text AS payer_name',
  payment_purpose: 'NULL::text AS payment_purpose',
  sent_at: 'NULL::timestamp AS sent_at',
  sms_sent_at: 'NULL::timestamp AS sms_sent_at',
  // The fallback is NULL rather than a guess at 'bcc' or 'upload', and the page
  // treats NULL as "cannot tell" and keeps its old test. Guessing 'bcc' would
  // empty the "not sent yet" group and lose real work silently; guessing
  // 'upload' would put every BCC row back in it.
  source: 'NULL::text AS source',
};

// Optional columns that are selected as an expression rather than by name.
// `pdf_bytes` is a blob of a megabyte or two, so the list asks only whether one
// exists - selecting the column itself would pull every stored invoice into
// memory to render a button.
const OPTIONAL_EXPR: Record<string, [present: string, missing: string]> = {
  pdf_bytes: ['(pdf_bytes IS NOT NULL) AS has_pdf', 'FALSE AS has_pdf'],
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // The merchant_invoices table is created by the backend ingestion service -
  // it may not exist yet in every environment. Degrade to an empty ledger
  // instead of 500ing.
  const columns = (missing: Set<string>) =>
    ['id', 'payer_email', 'invoice_number', 'amount', 'currency']
      .concat(Object.keys(OPTIONAL).map(c => (missing.has(c) ? OPTIONAL[c] : c)))
      .concat(Object.keys(OPTIONAL_EXPR).map(c => OPTIONAL_EXPR[c][missing.has(c) ? 1 : 0]))
      .concat(['status', 'email_subject', 'pdf_filename', 'paid_at', 'created_at', 'reminders_sent', 'last_reminder_at'])
      .join(', ');

  // Every unpaid row, and only the newest slice of the paid ones.
  //
  // This was one query with `LIMIT 200`, which silently hid the rest: a
  // merchant who BCC'd 432 invoices in a day (Kauno Valdorfo, 2026-10-13) saw
  // 200 of them, with nothing on screen saying so, and the outstanding total -
  // derived from the rows - was short by every invoice past the limit. A
  // ledger that under-reports a debt is worse than one that loads slowly.
  //
  // So the split follows what the page is for. Unpaid rows are the work, they
  // are what every count and every group header is built from, and they are
  // bounded in practice because they stop being unpaid; they load in full, with
  // no limit. Paid rows are history: capped, newest first, and the summary
  // below reports the true count so the page can say when it is showing a
  // slice. "Nothing to pay" rows are `issued`, so they arrive with the unpaid
  // set - correct, since the merchant still has to see them once.
  const PAID_PAGE = 300;

  const load = (missing: Set<string>) =>
    Promise.all([
      query<InvoiceRow>(
        `SELECT ${columns(missing)}
         FROM merchant_invoices
         WHERE merchant_id = $1 AND status <> 'paid'
         ORDER BY created_at DESC`,
        [session.id]
      ),
      query<InvoiceRow>(
        `SELECT ${columns(missing)}
         FROM merchant_invoices
         WHERE merchant_id = $1 AND status = 'paid'
         ORDER BY created_at DESC
         LIMIT ${PAID_PAGE}`,
        [session.id]
      ),
    ]).then(([unpaid, paid]) => [...unpaid, ...paid]);

  // One retry per optional column, so a half-applied migration still serves the
  // ledger rather than an empty page.
  const missing = new Set<string>();
  let invoices: InvoiceRow[] | null = null;
  // Both maps, or a missing pdf_bytes would never be recognised as a droppable
  // column and would fall through to the catch-all that answers "no invoices".
  const droppable = [...Object.keys(OPTIONAL), ...Object.keys(OPTIONAL_EXPR)];
  for (let attempt = 0; attempt <= droppable.length; attempt++) {
    try {
      invoices = await load(missing);
      break;
    } catch (err) {
      const absent = droppable.find(c => !missing.has(c) && String(err).includes(c));
      if (!absent) {
        console.error('[merchant/invoices] ledger query failed (table missing?)', String(err));
        return NextResponse.json({ invoices: [] });
      }
      console.warn(`[merchant/invoices] ${absent} column missing - backend deploy pending, serving without it`);
      missing.add(absent);
    }
  }
  if (invoices === null) {
    console.error('[merchant/invoices] ledger query failed after dropping every optional column');
    return NextResponse.json({ invoices: [] });
  }

  // The per-currency outstanding total used to be computed here and rendered
  // from the response. The Invoices page updates rows in place when a merchant
  // settles one, so that total went stale the moment they clicked: the yellow
  // box kept showing the amount of an invoice they had just marked paid, and
  // called it unpaid. The page derives the total from the rows it is showing,
  // which cannot disagree with them, so this no longer belongs on the server.

  // Whether this merchant's payments carry the purpose printed on the invoice
  // ("Už Rytį Černiauską") instead of the reference. Off for everyone unless an
  // operator turned it on, so the Invoices page must not show that line to a
  // merchant whose payments do not actually use it - it would describe a
  // behaviour they do not have. Its own query, guarded: this route must keep
  // serving the ledger even if the column or the table is missing.
  // How many paid invoices exist in total, and what they came to, per currency.
  //
  // The page derives every other figure from the rows it is showing, on purpose
  // (settling an invoice updates them in place, and a server total would then
  // disagree with the table). This one cannot be derived: the paid rows above
  // are a capped slice, so counting them would under-report a merchant's own
  // history. Guarded like the purpose flag - a ledger that loads without its
  // summary is far better than one that 500s because of it.
  let paidSummary: { currency: string; count: number; total: number }[] = [];
  try {
    const rows = await query<{ currency: string; count: string; total: string }>(
      `SELECT COALESCE(UPPER(currency), 'EUR') AS currency,
              COUNT(*)                          AS count,
              COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS total
         FROM merchant_invoices
        WHERE merchant_id = $1 AND status = 'paid'
     GROUP BY 1
     ORDER BY 3 DESC`,
      [session.id]
    );
    paidSummary = rows.map(r => ({
      currency: r.currency,
      count: Number(r.count) || 0,
      total: Math.round((Number(r.total) || 0) * 100) / 100,
    }));
  } catch (err) {
    console.warn('[merchant/invoices] paid summary unreadable, hiding the total', String(err));
  }

  let usesInvoicePurpose = false;
  try {
    const m = await queryOne<{ use_invoice_payment_purpose: boolean | null }>(
      'SELECT use_invoice_payment_purpose FROM merchants WHERE id = $1',
      [session.id]
    );
    usesInvoicePurpose = m?.use_invoice_payment_purpose === true;
  } catch (err) {
    console.warn('[merchant/invoices] purpose flag unreadable, hiding the column', String(err));
  }

  return NextResponse.json({ invoices, usesInvoicePurpose, paidSummary, paidPageSize: PAID_PAGE });
}
