import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { montonioFee } from '@/app/pay/methods';

// POS v2 — the till's side.
//
// POST creates the amount the counter is currently asking for; GET polls it so
// the till screen can turn into "Paid ✓" on its own. The customer's side is
// /api/pos/tap/[slug].
//
// No merchant session is required, because the till may be any device at the
// counter and the pay page it lives on has never required one. That is
// affordable here: every route leads to money landing in this merchant's own
// account, and the only mischief available — creating a request so a customer
// pays the wrong amount — is bounded by three things: exactly one request is
// live per merchant (a new one supersedes the last), it dies after
// REQUEST_TTL_MINUTES, and the till's confirmation screen shows the amount that
// was actually paid, so a mismatch is visible at the counter rather than
// discovered in the books.

const REQUEST_TTL_MINUTES = 10;

type MerchantRow = {
  id: string;
  currency: string | null;
  sort_code: string | null;
  fee_mode: string | null;
  payment_rail: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { slug, amount, reference } = body ?? {};

    if (typeof slug !== 'string' || !slug.trim()) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
    }

    const invoiceAmount = Number(String(amount ?? '').replace(',', '.'));
    if (!Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const merchant = await queryOne<MerchantRow>(
      `SELECT id, currency, sort_code, fee_mode, payment_rail
       FROM merchants WHERE slug = $1 AND is_active = true`,
      [slug.trim().toLowerCase()]
    );
    if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const currency = merchant.currency ?? (merchant.sort_code ? 'GBP' : 'EUR');

    // One live request per merchant. Without this a till that corrected a typo
    // would leave the wrong amount reachable by a tap.
    await query(
      `UPDATE pos_requests SET status = 'superseded'
       WHERE merchant_id = $1 AND status IN ('open', 'claimed')`,
      [merchant.id]
    );

    const id = randomUUID();
    await query(
      `INSERT INTO pos_requests (id, merchant_id, amount, currency, reference, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'open', NOW(), NOW() + ($6 || ' minutes')::interval)`,
      [
        id,
        merchant.id,
        invoiceAmount,
        currency,
        typeof reference === 'string' && reference.trim() ? reference.trim() : null,
        String(REQUEST_TTL_MINUTES),
      ]
    );

    // Quoted so the till can show the customer's total before they tap. The
    // charge itself is decided in /api/payment/montonio and nowhere else; this
    // is the same helper every other screen displays, so the two cannot drift.
    const fee = montonioFee(merchant.payment_rail, merchant.fee_mode);

    return NextResponse.json({
      id,
      amount: invoiceAmount,
      currency,
      fee,
      total: Math.round((invoiceAmount + fee) * 100) / 100,
      expires_in_minutes: REQUEST_TTL_MINUTES,
    });
  } catch (err) {
    console.error('[POS] create request failed', String(err));
    return NextResponse.json({ error: 'Could not create request' }, { status: 500 });
  }
}

/** Poll one request. The till calls this every couple of seconds. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // pos_requests.id is a uuid column: anything else throws in Postgres.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const row = await queryOne<{
      status: string;
      amount: string;
      currency: string;
      expires_at: string;
      paid_amount: string | null;
      payer_fee: string | null;
    }>(
      `SELECT r.status, r.amount, r.currency, r.expires_at,
              p.amount AS paid_amount, p.payer_fee
       FROM pos_requests r
       LEFT JOIN merchant_payments p ON p.id = r.payment_id
       WHERE r.id = $1`,
      [id]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Age it here rather than with a cron: a request nobody paid simply stops
    // being live, and the till sees that without another moving part.
    const expired = row.status === 'open' && new Date(row.expires_at).getTime() < Date.now();

    return NextResponse.json({
      status: expired ? 'expired' : row.status,
      amount: Number(row.amount),
      currency: row.currency,
      // What actually arrived, so the counter can see a mismatch instead of
      // trusting that "paid" meant the amount they typed.
      paid_amount: row.paid_amount !== null ? Number(row.paid_amount) : null,
      payer_fee: row.payer_fee !== null ? Number(row.payer_fee) : null,
    });
  } catch (err) {
    console.error('[POS] poll failed', String(err));
    return NextResponse.json({ error: 'Could not read request' }, { status: 500 });
  }
}
