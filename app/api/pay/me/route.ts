import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getPayerSession } from '@/lib/payer-auth';

/**
 * The payer's invoices, across every HexaBee merchant that has invoiced this
 * address through the BCC ledger. Grouped by merchant; the merchant whose pay
 * link the payer arrived on (`?slug=`) comes first, the rest follow.
 *
 * Only rows with an invoice number are returned — without one there is nothing
 * for the pay page to look up, so the row could not be paid from here anyway.
 */
type Row = {
  id: string;
  invoice_number: string;
  amount: string | null;
  currency: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
  slug: string;
  business_name: string | null;
};

export async function GET(req: NextRequest) {
  const session = await getPayerSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const slug = req.nextUrl.searchParams.get('slug')?.trim().toLowerCase() || null;

  let rows: Row[] = [];
  try {
    rows = await query<Row>(
      `SELECT i.id, i.invoice_number, i.amount, i.currency, i.status, i.paid_at, i.created_at,
              m.slug, m.business_name
       FROM merchant_invoices i
       JOIN merchants m ON m.id = i.merchant_id
       WHERE LOWER(i.payer_email) = $1 AND i.invoice_number IS NOT NULL
       ORDER BY (i.status = 'paid'), i.created_at DESC
       LIMIT 300`,
      [session.email]
    );
  } catch (err) {
    console.error('[payer/me] ledger query failed', String(err));
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const groups = new Map<string, { slug: string; business_name: string; invoices: Omit<Row, 'slug' | 'business_name'>[] }>();
  for (const r of rows) {
    const g = groups.get(r.slug) ?? { slug: r.slug, business_name: r.business_name ?? r.slug, invoices: [] };
    const { slug: _s, business_name: _b, ...inv } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
    g.invoices.push(inv);
    groups.set(r.slug, g);
  }
  const merchants = Array.from(groups.values()).sort((a, b) => {
    if (a.slug === slug) return -1;
    if (b.slug === slug) return 1;
    return 0;
  });

  return NextResponse.json({ email: session.email, merchants });
}
