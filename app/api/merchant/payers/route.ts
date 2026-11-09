import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

export const runtime = 'nodejs';

/**
 * This merchant's saved customers.
 *
 * ⚠️ **It exists so that issuing one invoice does not start from an empty
 * form every time.** `merchant_payers` has remembered who gets what since the
 * send was built, and only the BCC and upload paths ever read it - a merchant
 * invoicing the same company every month retyped the name, the code and the
 * address, which is precisely what the table was for.
 *
 * ⚠️ **A failure here is not an error.** The worst case is the merchant
 * typing a customer they could have picked, so an unreachable backend costs a
 * convenience and must never stop them issuing. It answers an empty list.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const base = process.env.ADMIN_API_BASE_URL?.replace(/\/$/, '');
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) return NextResponse.json({ payers: [] });

  try {
    const res = await fetch(
      `${base}/api/plugin/merchant-payers?merchant_id=${encodeURIComponent(session.id)}`,
      { headers: { 'X-Internal-Token': token }, cache: 'no-store' }
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (err) {
    console.warn('[payers] list unavailable', String(err));
    return NextResponse.json({ payers: [] });
  }
}
