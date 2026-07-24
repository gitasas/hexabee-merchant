import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

type InvoiceRow = {
  id: string;
  payer_email: string | null;
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  email_subject: string | null;
  pdf_filename: string | null;
  paid_at: string | null;
  created_at: string;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // The merchant_invoices table is created by the backend ingestion service —
  // it may not exist yet in every environment. Degrade to an empty ledger
  // instead of 500ing.
  let invoices: InvoiceRow[] = [];
  try {
    invoices = await query<InvoiceRow>(
      `SELECT id, payer_email, invoice_number, amount, currency, status, email_subject, pdf_filename, paid_at, created_at
       FROM merchant_invoices
       WHERE merchant_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [session.id]
    );
  } catch (err) {
    console.error('[merchant/invoices] ledger query failed (table missing?)', String(err));
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
