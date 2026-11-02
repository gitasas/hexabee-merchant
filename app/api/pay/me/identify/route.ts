import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { callInternal, normaliseEmail } from '@/lib/payer-auth';

/**
 * Step one of the payer inbox: "which address did your invoice come to?"
 *
 * A code is sent only when the ledger holds at least one invoice for the
 * address. Telling the payer "nothing for this address" is deliberate and
 * safe - an invoice's existence is not a secret to the person it was sent to,
 * and it saves someone who was invoiced at a colleague's address from waiting
 * for a code that would show an empty list.
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown } = {};
  try { body = await req.json(); } catch { /* fall through */ }
  const email = normaliseEmail(body.email);
  if (!email) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });

  // ⚠️ Matches `payer_email_cc` too, and must stay in step with /api/pay/me:
  // this gate decides whether a code is even sent, so an address the list
  // would show but this refuses leaves the payer unable to reach their own
  // invoice at all. See the note in that route for why the second address
  // exists and who reported it.
  const knownSql = (match: string) =>
    `SELECT 1 AS ok FROM merchant_invoices WHERE ${match} LIMIT 1`;

  let known = false;
  try {
    known = !!(await queryOne<{ ok: number }>(
      knownSql('(LOWER(payer_email) = $1 OR LOWER(payer_email_cc) = $1)'),
      [email]
    ));
  } catch (err) {
    if (String(err).includes('payer_email_cc')) {
      console.warn('[payer/identify] payer_email_cc missing - matching the primary address only');
      try {
        known = !!(await queryOne<{ ok: number }>(knownSql('LOWER(payer_email) = $1'), [email]));
      } catch (retryErr) {
        console.error('[payer/identify] ledger query failed', String(retryErr));
        return NextResponse.json({ error: 'unavailable' }, { status: 503 });
      }
    } else {
      console.error('[payer/identify] ledger query failed', String(err));
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
  }
  if (!known) return NextResponse.json({ error: 'no_invoices' }, { status: 404 });

  const { status } = await callInternal('/api/plugin/payer/code', { email });
  if (status === 429) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (status !== 200) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  return NextResponse.json({ sent: true });
}
