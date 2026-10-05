import { NextRequest, NextResponse } from 'next/server';
import { getSession, isOwner } from '@/lib/merchant-auth';

/**
 * The people who can sign in to this merchant's portal.
 *
 * Owner only, reading and writing. Who else has access and at what level is not
 * something a staff account needs to see, and inviting is how an account grows -
 * so it belongs with the person who owns the bank details.
 */
const BASE = () => process.env.ADMIN_API_BASE_URL?.replace(/\/$/, '');
const TOKEN = () => process.env.INTERNAL_SERVICE_TOKEN;

function misconfigured() {
  return NextResponse.json(
    { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
    { status: 500 }
  );
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwner(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!BASE() || !TOKEN()) return misconfigured();

  try {
    const url = new URL(`${BASE()}/api/plugin/merchant-users`);
    url.searchParams.set('merchant_id', session.id);
    const res = await fetch(url, { headers: { 'X-Internal-Token': TOKEN()! }, cache: 'no-store' });
    return NextResponse.json(await res.json().catch(() => ({ users: [] })), { status: res.status });
  } catch (err) {
    console.error('[merchant/users] list failed', String(err));
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwner(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!BASE() || !TOKEN()) return misconfigured();

  let email = '';
  let role = 'staff';
  try {
    const body = await req.json();
    email = String(body?.email ?? '').trim().toLowerCase();
    role = String(body?.role ?? 'staff').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BASE()}/api/plugin/merchant-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': TOKEN()! },
      body: JSON.stringify({
        merchant_id: session.id,
        email,
        role,
        // Built from this request's own origin, so a staging invitation can
        // never mail somebody a production link.
        invite_url: `${req.nextUrl.origin}/merchant/reset`,
      }),
    });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    console.error('[merchant/users] invite failed', String(err));
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
