import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// The merchant's Rivilė ERP key: read-only access to their own books, so an
// invoice paid by a plain bank transfer stops being chased here.
//
// Proxied to the Python backend rather than written here, because the key is
// **proved against Rivilė before it is stored** (`rivile.verify_key`) and
// because the reading itself lives there.
//
// ⚠️ **Validation matters more here than for the other credentials, because
// the merchant pays per request.** Every Rivilė call is billed to their own
// subscription, so a key that merely answers 401 still costs them something
// on every pass - and a stored-but-dead key would do that daily while
// closing nothing.
//
// ⚠️ **The expiry is asked for, not read.** `GET /v1/users/api-keys` answers a
// bare "valid" with no date, and unlike the Tele2 key there is nothing inside
// a Rivilė key to decode - yet the key does expire on a date chosen when it
// was created. Without that date the link dies in silence: invoices simply
// stop being read.
//
// The key itself is never returned by any endpoint.

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
      `${cfg.baseUrl}/api/plugin/merchant-rivile?merchant_id=${encodeURIComponent(session.id)}`,
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
    console.error('[merchant/rivile-settings] proxy failed', String(err));
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
  // the spot by Rivilė itself, and a removed one shows up as a stale link on
  // the settings page and a red banner in the admin panel.

  let token: string;
  let validUntil: string | undefined;
  try {
    const payload = await req.json();
    if (typeof payload?.token !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    // ⚠️ Asked for, because Rivilė will not tell us. Their validity check
    // answers a bare "valid" with no date, and unlike the Tele2 key there is
    // nothing inside a Rivilė key to decode - yet it does expire on a date
    // chosen when it was created. Without it the link dies in silence.
    if (typeof payload?.validUntil === 'string') {
      const v = payload.validUntil.trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json({ error: 'bad_date' }, { status: 400 });
      }
      validUntil = v;
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
    const res = await fetch(`${cfg.baseUrl}/api/plugin/merchant-rivile`, {
      method: 'POST',
      headers: { 'X-Internal-Token': cfg.internalToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: session.id,
        api_key: token,
        ...(validUntil === undefined ? {} : { valid_until: validUntil }),
      }),
    });
    const body = await res.json().catch(() => ({ error: `accounting service returned ${res.status}` }));
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/rivile-settings] proxy failed', String(err));
    return NextResponse.json({ error: 'accounting_service_unreachable' }, { status: 502 });
  }
}
