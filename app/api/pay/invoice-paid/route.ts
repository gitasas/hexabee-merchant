import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * "I already paid this invoice", from the link in a reminder email.
 *
 * An invoice settled by ordinary bank transfer never reaches HexaBee, so the row
 * stays unpaid and the dunning loop keeps chasing someone who has already paid.
 * The payer is the only person in that exchange who knows the reminder is wrong,
 * so they get a way to say so.
 *
 * What it does NOT do is mark the invoice paid. Nobody verified this and no money
 * was seen; only the merchant can confirm that. It records the claim, which stops
 * the automatic reminders and raises the row in the merchant's ledger for them to
 * settle. The worst a false claim can do is stop three emails.
 *
 * GET is read-only and POST performs the claim, deliberately: mail clients and
 * security scanners fetch links in messages, and a GET that mutated would have
 * them claiming invoices on the payer's behalf.
 */

type ClaimRow = {
  id: string;
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  payer_claimed_at: string | null;
  business_name: string | null;
  slug: string | null;
};

// token_urlsafe(32) is 43 chars; the column allows 64. Shape-check before the
// query so a junk token is a clean 404 rather than a database round trip.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function lookup(token: string): Promise<ClaimRow | null> {
  const rows = await query<ClaimRow>(
    `SELECT i.id, i.invoice_number, i.amount, i.currency, i.status, i.payer_claimed_at,
            m.business_name, m.slug
       FROM merchant_invoices i
       JOIN merchants m ON m.id = i.merchant_id
      WHERE i.claim_token = $1`,
    [token]
  );
  return rows[0] ?? null;
}

function shape(row: ClaimRow) {
  return {
    invoice_number: row.invoice_number,
    amount: row.amount,
    currency: row.currency,
    merchant_name: row.business_name,
    slug: row.slug,
    status: row.status,
    claimed: row.payer_claimed_at !== null,
  };
}

function tokenOf(req: NextRequest): string | null {
  const token = req.nextUrl.searchParams.get('t');
  return token && TOKEN_RE.test(token) ? token : null;
}

export async function GET(req: NextRequest) {
  const token = tokenOf(req);
  if (!token) return NextResponse.json({ error: 'invalid_link' }, { status: 404 });

  try {
    const row = await lookup(token);
    if (!row) return NextResponse.json({ error: 'invalid_link' }, { status: 404 });
    return NextResponse.json(shape(row));
  } catch (err) {
    console.error('[pay/invoice-paid] lookup failed', String(err));
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = tokenOf(req);
  if (!token) return NextResponse.json({ error: 'invalid_link' }, { status: 404 });

  try {
    const row = await lookup(token);
    if (!row) return NextResponse.json({ error: 'invalid_link' }, { status: 404 });

    // Already settled through HexaBee: say so rather than record a claim against
    // a paid invoice. The payer most likely clicked an old reminder.
    if (row.status === 'paid') {
      return NextResponse.json({ ...shape(row), already_paid: true });
    }

    // Idempotent: a second click is the same answer, not a second claim.
    await query(
      `UPDATE merchant_invoices
          SET payer_claimed_at = NOW()
        WHERE claim_token = $1 AND status <> 'paid' AND payer_claimed_at IS NULL`,
      [token]
    );

    console.log(
      `[pay/invoice-paid] payer claims paid: merchant=${row.slug ?? '?'} invoice=${row.invoice_number ?? '?'}`
    );

    return NextResponse.json({ ...shape(row), claimed: true });
  } catch (err) {
    console.error('[pay/invoice-paid] claim failed', String(err));
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
