import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

type InvoiceRow = {
  id: string;
  payer_email: string | null;
  payer_name: string | null;
  payment_purpose: string | null;
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
};

// Columns the backend adds by migration. This app can deploy first, and then the
// SELECT fails on a column that is not there yet — with the catch-all below that
// reads to the merchant as "you have no invoices", which is worse than the
// missing column. So each one carries a fallback and is dropped individually.
const OPTIONAL: Record<string, string> = {
  due_date: 'NULL::date AS due_date',
  paid_source: 'NULL::text AS paid_source',
  payer_claimed_at: 'NULL::timestamp AS payer_claimed_at',
  payer_name: 'NULL::text AS payer_name',
  payment_purpose: 'NULL::text AS payment_purpose',
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // The merchant_invoices table is created by the backend ingestion service —
  // it may not exist yet in every environment. Degrade to an empty ledger
  // instead of 500ing.
  const columns = (missing: Set<string>) =>
    ['id', 'payer_email', 'invoice_number', 'amount', 'currency']
      .concat(Object.keys(OPTIONAL).map(c => (missing.has(c) ? OPTIONAL[c] : c)))
      .concat(['status', 'email_subject', 'pdf_filename', 'paid_at', 'created_at', 'reminders_sent', 'last_reminder_at'])
      .join(', ');

  const load = (missing: Set<string>) =>
    query<InvoiceRow>(
      `SELECT ${columns(missing)}
       FROM merchant_invoices
       WHERE merchant_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [session.id]
    );

  // One retry per optional column, so a half-applied migration still serves the
  // ledger rather than an empty page.
  const missing = new Set<string>();
  let invoices: InvoiceRow[] | null = null;
  for (let attempt = 0; attempt <= Object.keys(OPTIONAL).length; attempt++) {
    try {
      invoices = await load(missing);
      break;
    } catch (err) {
      const absent = Object.keys(OPTIONAL).find(c => !missing.has(c) && String(err).includes(c));
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

  return NextResponse.json({ invoices, usesInvoicePurpose });
}
