import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// What an SMS batch would cost, and whether it can run at all.
//
// Shown before the merchant presses send, which is the entire point. Tele2 cap
// an account at 10 000 messages a month and provide **no endpoint to query the
// remaining allowance** - the only signal is `limit_reached`, which refuses a
// whole request after the fact. That is the Resend quota cliff again, and the
// lesson from 2026-10-13 is that a limit nobody can see becomes half a customer
// list messaged while the merchant believes everyone was. So the backend counts
// our own rows and this puts that number in front of them.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !internalToken) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-sms/usage?merchant_id=${encodeURIComponent(session.id)}`,
      { headers: { 'X-Internal-Token': internalToken }, cache: 'no-store' }
    );
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `SMS service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/sms/usage] proxy failed', String(err));
    return NextResponse.json({ error: 'SMS service unreachable' }, { status: 502 });
  }
}
