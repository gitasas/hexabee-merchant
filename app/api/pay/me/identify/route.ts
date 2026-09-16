import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { callInternal, normaliseEmail } from '@/lib/payer-auth';

/**
 * Step one of the payer inbox: "which address did your invoice come to?"
 *
 * A code is sent only when the ledger holds at least one invoice for the
 * address. Telling the payer "nothing for this address" is deliberate and
 * safe — an invoice's existence is not a secret to the person it was sent to,
 * and it saves someone who was invoiced at a colleague's address from waiting
 * for a code that would show an empty list.
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown } = {};
  try { body = await req.json(); } catch { /* fall through */ }
  const email = normaliseEmail(body.email);
  if (!email) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });

  let known = false;
  try {
    known = !!(await queryOne<{ ok: number }>(
      `SELECT 1 AS ok FROM merchant_invoices WHERE LOWER(payer_email) = $1 LIMIT 1`,
      [email]
    ));
  } catch (err) {
    console.error('[payer/identify] ledger query failed', String(err));
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  if (!known) return NextResponse.json({ error: 'no_invoices' }, { status: 404 });

  const { status } = await callInternal('/api/plugin/payer/code', { email });
  if (status === 429) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (status !== 200) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  return NextResponse.json({ sent: true });
}
