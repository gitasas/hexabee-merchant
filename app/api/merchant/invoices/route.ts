import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

type InvoiceRow = {
  id: string;
  payer_email: string | null;
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
        return NextResponse.json({ invoices: [], outstanding: [] });
      }
      console.warn(`[merchant/invoices] ${absent} column missing - backend deploy pending, serving without it`);
      missing.add(absent);
    }
  }
  if (invoices === null) {
    console.error('[merchant/invoices] ledger query failed after dropping every optional column');
    return NextResponse.json({ invoices: [], outstanding: [] });
  }

  // Per-currency outstanding totals (unpaid invoices only)
  const outstandingMap = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status !== 'issued') continue;
    const amount = Number(inv.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const cur = (inv.currency ?? 'EUR').toUpperCase();
    outstandingMap.set(cur, (outstandingMap.get(cur) ?? 0) + amount);
  }
  const outstanding = Array.from(outstandingMap.entries()).map(([currency, total]) => ({
    currency,
    total: Math.round(total * 100) / 100,
  }));

  return NextResponse.json({ invoices, outstanding });
}
