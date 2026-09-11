import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

/**
 * Put this merchant on HexaBee's own sandbox Montonio store.
 *
 * So that anyone can walk through onboarding on staging and take a test
 * payment without first getting a Montonio account. The sandbox keys are not
 * copied into the merchant's row — `montonio_access_key` is unique, because the
 * webhook has only that key to say whose payment arrived — the row is flagged
 * instead, and `/api/payment/montonio` then sends no keys, which the backend
 * takes as "use the env sandbox store".
 *
 * Refused unless the environment says so. In production a merchant settling
 * into HexaBee's store would be HexaBee holding their money, which is the
 * custody SEIS forbids — the flag must never be reachable there.
 */
export async function POST() {
  if (process.env.MONTONIO_SANDBOX_ONBOARDING !== 'true') {
    return NextResponse.json({ error: 'Not available in this environment' }, { status: 403 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await query(
    `UPDATE merchants
     SET montonio_sandbox = TRUE, payment_rail = 'montonio'
     WHERE id = $1`,
    [session.id]
  );

  return NextResponse.json({ ok: true });
}
