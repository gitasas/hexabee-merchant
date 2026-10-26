import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// The merchant's Centas accounting key: read-only access to their own books,
// so an invoice paid by a plain bank transfer stops being chased.
//
// Both halves are proxied to the Python backend rather than written here,
// because the key has to be **proved against Centas before it is stored** and
// that is where `verify_token` lives. Storing an unproven key would be worse
// than refusing it: a wrong or expired token answers `{"success":0}`, which
// the reader treats as "no documents", which is indistinguishable from
// "nobody owes anything" - so the merchant sees "connected", nothing ever
// closes, and the only symptom is reminders reaching people who have paid.
//
// ⚠️ **The expiry is returned and the token never is.** Centas keys stop
// working on a date. The GET carries `valid_until` / `days_left` so the
// portal can say it out loud; retrieving the key itself is impossible by
// design, the same rule as the Tele2 and Montonio credentials.

function backend() {
  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !internalToken) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), internalToken };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cfg = backend();
  if (!cfg) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `${cfg.baseUrl}/api/plugin/merchant-centas?merchant_id=${encodeURIComponent(session.id)}`,
      { headers: { 'X-Internal-Token': cfg.internalToken }, cache: 'no-store' }
    );
    // A backend that has not deployed the column yet answers 500. Reporting
    // "not connected" is the truthful reading of that and lets this app ship
    // first, exactly as /api/merchant/sms-settings does for its columns.
    if (res.status >= 500) {
      return NextResponse.json({ configured: false, valid_until: null, days_left: null, expired: false });
    }
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    console.error('[merchant/centas-settings] proxy failed', String(err));
    return NextResponse.json({ error: 'accounting_service_unreachable' }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ⚠️ **Staff may set this, unlike the bank details - and that is the safer
  // choice, not a relaxation (2026-10-26).**
  //
  // It was owner-only, reasoned from "this key reads the whole sales ledger".
  // That reasoning ignored who actually holds the key. At Baltijos licėjus the
  // owner is the director, the administrator does the invoicing, and the key is
  // issued to the BOOKKEEPER, who is not even at the school. Owner-only means
  // that key gets forwarded by email to reach the one person allowed to paste
  // it - a live credential sitting in two more inboxes, which is exactly the
  // hop this repo already removed for the Montonio keys.
  //
  // The bank details stay owner-only because a phished staff password there
  // redirects money. This key cannot: it only reads, a wrong one is refused on
  // the spot by Centas itself, and a removed one shows up as a stale link on
  // the settings page and a red banner in the admin panel.

  let token: string;
  try {
    const payload = await req.json();
    if (typeof payload?.token !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    // An empty string is a real intention here - "disconnect my accounting" -
    // and the backend treats it as such. Unlike the SMS route there is nothing
    // else in this request, so absent and empty need not be told apart.
    token = payload.token.trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const cfg = backend();
  if (!cfg) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/api/plugin/merchant-centas`, {
      method: 'POST',
      headers: { 'X-Internal-Token': cfg.internalToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_id: session.id, token }),
    });
    const body = await res.json().catch(() => ({ error: `accounting service returned ${res.status}` }));
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/centas-settings] proxy failed', String(err));
    return NextResponse.json({ error: 'accounting_service_unreachable' }, { status: 502 });
  }
}
