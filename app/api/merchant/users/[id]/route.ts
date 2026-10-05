import { NextRequest, NextResponse } from 'next/server';
import { getSession, isOwner } from '@/lib/merchant-auth';

// Change somebody's role, or remove their access. Owner only; the backend
// separately refuses to leave an account without an owner, because an account
// with none could never change its own bank details again and nobody inside it
// could fix that.
const BASE = () => process.env.ADMIN_API_BASE_URL?.replace(/\/$/, '');
const TOKEN = () => process.env.INTERNAL_SERVICE_TOKEN;

async function guard() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!isOwner(session)) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  if (!BASE() || !TOKEN()) {
    return { error: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }) };
  }
  return { session };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await guard();
  if (error || !session) return error!;
  const { id } = await params;

  let role = '';
  try {
    role = String((await req.json())?.role ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Demoting yourself is how an owner locks themselves out of their own bank
  // details by accident, and the backend's last-owner check would not catch it
  // while a second owner exists.
  if (session.userId && session.userId === id && role !== 'owner') {
    return NextResponse.json({ error: 'cannot_demote_self' }, { status: 409 });
  }

  try {
    const res = await fetch(`${BASE()}/api/plugin/merchant-users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': TOKEN()! },
      body: JSON.stringify({ merchant_id: session.id, role }),
    });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    console.error('[merchant/users] role change failed', String(err));
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await guard();
  if (error || !session) return error!;
  const { id } = await params;

  if (session.userId && session.userId === id) {
    return NextResponse.json({ error: 'cannot_remove_self' }, { status: 409 });
  }

  try {
    const url = new URL(`${BASE()}/api/plugin/merchant-users/${encodeURIComponent(id)}`);
    url.searchParams.set('merchant_id', session.id);
    const res = await fetch(url, { method: 'DELETE', headers: { 'X-Internal-Token': TOKEN()! } });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch (err) {
    console.error('[merchant/users] remove failed', String(err));
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
