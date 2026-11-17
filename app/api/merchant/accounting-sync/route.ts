import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// The Invoices page's "Sinchronizuoti su apskaita" button (2026-11-17).
// Runs, now, whatever the merchant's connected accounting allows - import new
// invoices, write ours in, read payments - through the same functions the
// scheduled loop runs (`app/accounting_sync.py` in the Python backend).
//
// Staff may press it: it is daily work, and every step is still gated by the
// switch the operator set. The backend limits it to once every 15 minutes,
// because every Rivilė request is billed to the merchant's own subscription.
//
// ⚠️ The backend's own error text is never passed on. The page maps the
// status and the counts to its dictionary; the raw reply is logged here.

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
  if (!cfg) return NextResponse.json({ systems: [] });
  try {
    const res = await fetch(
      `${cfg.baseUrl}/api/plugin/merchant-accounting-sync?merchant_id=${encodeURIComponent(session.id)}`,
      { headers: { 'X-Internal-Token': cfg.internalToken }, cache: 'no-store' }
    );
    // A backend that has not deployed yet: no button, rather than a broken one.
    if (!res.ok) return NextResponse.json({ systems: [] });
    return NextResponse.json(await res.json());
  } catch (err) {
    console.error('[merchant/accounting-sync] status failed', String(err));
    return NextResponse.json({ systems: [] });
  }
}

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cfg = backend();
  if (!cfg) return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  try {
    const res = await fetch(`${cfg.baseUrl}/api/plugin/merchant-accounting-sync`, {
      method: 'POST',
      headers: { 'X-Internal-Token': cfg.internalToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_id: session.id }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    if (res.status === 429) {
      return NextResponse.json({ error: 'too_soon', wait_seconds: data?.detail?.wait_seconds ?? null }, { status: 429 });
    }
    if (res.status === 409) return NextResponse.json({ error: 'not_connected' }, { status: 409 });
    if (!res.ok) {
      console.error('[merchant/accounting-sync] backend', res.status, JSON.stringify(data));
      return NextResponse.json({ error: 'failed' }, { status: 502 });
    }
    if (data?.failed?.length) console.error('[merchant/accounting-sync] steps failed', JSON.stringify(data.failed));
    return NextResponse.json({
      imported: data?.imported ?? 0,
      written: data?.written ?? 0,
      closed: data?.closed ?? 0,
      failed: Array.isArray(data?.failed) ? data.failed.length : 0,
    });
  } catch (err) {
    console.error('[merchant/accounting-sync] proxy failed', String(err));
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
