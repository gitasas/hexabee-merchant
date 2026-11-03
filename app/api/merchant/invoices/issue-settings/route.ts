import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { SAVEABLE_FIELDS } from '@/lib/issue-fields';

export const runtime = 'nodejs';

/**
 * The letterhead, the series and the column mapping for invoices HexaBee issues.
 *
 * ⚠️ **Any merchant session may save these, staff included, since 2026-11-03** -
 * `lib/issue-fields.ts` carries the reason and what it deliberately does not
 * touch. The short version: at both schools the director owns the account and
 * somebody else does the invoicing, so an owner-only letterhead meant the
 * school's own address could only be typed by the person who never signs in.
 * The payee name and the account the money lands in are **not on this form** -
 * they are `business_name` and `iban` on `/api/merchant/profile`, still
 * `ownerOnly`, so a phished staff password still cannot redirect a payout.
 *
 * Nothing here is a secret, unlike the Montonio or Tele2 keys, so everything is
 * returned in full.
 */

function backend(): { base: string; token: string } | null {
  const base = process.env.ADMIN_API_BASE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) return null;
  return { base: base.replace(/\/$/, ''), token };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const api = backend();
  if (!api) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  try {
    const res = await fetch(
      `${api.base}/api/plugin/merchant-invoice-settings?merchant_id=${encodeURIComponent(session.id)}`,
      { headers: { 'X-Internal-Token': api.token }, cache: 'no-store' }
    );
    if (!res.ok) {
      console.error('[issue-settings] backend GET failed', res.status);
      return NextResponse.json({ error: 'Upstream error' }, { status: 502 });
    }
    // `canEditLetterhead` was returned here and read by nobody. It is gone
    // rather than left behind reporting a permission that no longer exists.
    return NextResponse.json(await res.json());
  } catch (err) {
    console.error('[issue-settings] backend unreachable', String(err));
    return NextResponse.json({ error: 'Upstream unreachable' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const api = backend();
  if (!api) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Only keys we know about travel on, so a stray field cannot reach a column
  // by accident. ⚠️ Which also means a field missing from `SAVEABLE_FIELDS` is
  // dropped in silence while the screen reports a save - what
  // `npm run verify:issue-fields` exists to catch.
  const payload: Record<string, unknown> = { merchant_id: session.id };
  for (const key of SAVEABLE_FIELDS) if (key in body) payload[key] = body[key];

  if (Object.keys(payload).length === 1) {
    return NextResponse.json({ error: 'Nothing to save' }, { status: 400 });
  }

  try {
    const res = await fetch(`${api.base}/api/plugin/merchant-invoice-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': api.token },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The backend's own English strings never reach the portal - see
      // CLAUDE.md on never displaying data.error. The status is what the
      // caller maps to a dictionary key; the detail is logged.
      console.error('[issue-settings] backend PUT failed', res.status, data);
      return NextResponse.json({ error: 'upstream' }, { status: res.status === 400 ? 400 : 502 });
    }
    return NextResponse.json({ ok: true, blockers: data.blockers ?? [] });
  } catch (err) {
    console.error('[issue-settings] backend unreachable', String(err));
    return NextResponse.json({ error: 'upstream' }, { status: 502 });
  }
}
