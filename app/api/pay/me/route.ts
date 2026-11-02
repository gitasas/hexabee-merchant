import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getPayerSession } from '@/lib/payer-auth';

/**
 * The payer's invoices, across every HexaBee merchant that has invoiced this
 * address through the BCC ledger. Grouped by merchant; the merchant whose pay
 * link the payer arrived on (`?slug=`) comes first, the rest follow.
 *
 * Only rows with an invoice number are returned - without one there is nothing
 * for the pay page to look up, so the row could not be paid from here anyway.
 *
 * ⚠️ **It matches `payer_email_cc` as well as `payer_email` (2026-11-02).** The
 * send path deliberately stores a second address - that is what the column is
 * for, copied from the remembered payer - and HexaBee emails the invoice to
 * both. Matching only the first meant the second parent verified their address
 * and was told there was nothing for them, about an invoice sitting in their
 * own inbox. Reported by Kauno Valdorfo mokykla's director, who sent himself
 * one invoice at two addresses.
 *
 * It does NOT fix the BCC path, where the second recipient is never stored at
 * all: `_ingest_email` takes the first To/Cc that is not ours and discards the
 * rest. Whether a BCC'd invoice should remember both is a decision about who
 * may reach an invoice, not a bug - see inbound.py.
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

  const listSql = (match: string) =>
    `SELECT i.id, i.invoice_number, i.amount, i.currency, i.status, i.paid_at, i.created_at,
            m.slug, m.business_name
     FROM merchant_invoices i
     JOIN merchants m ON m.id = i.merchant_id
     WHERE ${match} AND i.invoice_number IS NOT NULL
     ORDER BY (i.status = 'paid'), i.created_at DESC
     LIMIT 300`;

  let rows: Row[] = [];
  try {
    rows = await query<Row>(
      listSql('(LOWER(i.payer_email) = $1 OR LOWER(i.payer_email_cc) = $1)'),
      [session.email]
    );
  } catch (err) {
    // The column arrives by backend migration, and here it sits in the WHERE
    // clause - so on a split deploy the throw would reach the catch below and
    // answer 503, taking the whole inbox down rather than costing one column.
    // Retry without it, like /api/merchant/invoices does for due_date.
    if (String(err).includes('payer_email_cc')) {
      console.warn('[payer/me] payer_email_cc missing - matching the primary address only');
      try {
        rows = await query<Row>(listSql('LOWER(i.payer_email) = $1'), [session.email]);
      } catch (retryErr) {
        console.error('[payer/me] ledger query failed', String(retryErr));
        return NextResponse.json({ error: 'unavailable' }, { status: 503 });
      }
    } else {
      console.error('[payer/me] ledger query failed', String(err));
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
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
