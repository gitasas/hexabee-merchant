import { NextRequest, NextResponse } from 'next/server';
import { getSession, isOwner } from '@/lib/merchant-auth';

export const runtime = 'nodejs';

/**
 * The letterhead, the series and the column mapping for invoices HexaBee issues.
 *
 * ⚠️ **The role split is not cosmetic.** `CLAUDE.md`: staff do the daily work -
 * upload, send, chase, the letter template - while the owner controls the
 * business name, the bank details, the fees and the slug. The letterhead and
 * the invoice series belong on the owner's side of that line for the same
 * reason the business name does: they are what a customer sees as the payee on
 * an accounting document, and the series is what the merchant's own accounting
 * has to stay clear of.
 *
 * The **column mapping** is the other kind of thing entirely - it is this
 * month's spreadsheet layout, changed by whoever does the invoicing - so staff
 * may save it. Nothing here is a secret, unlike the Montonio or Tele2 keys, so
 * everything is returned in full.
 */

const MAPPING_ONLY = 'invoice_import_mapping';

const OWNER_FIELDS = [
  'invoice_address',
  'invoice_bank_name',
  'is_vat_payer',
  'invoice_vat_code',
  'invoice_vat_rate',
  'invoice_amounts_include_vat',
  'invoice_number_prefix',
  'invoice_number_format',
] as const;

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
    return NextResponse.json({ ...(await res.json()), canEditLetterhead: isOwner(session) });
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
  // by accident - and the role is decided by which of them are present.
  const allowed = [...OWNER_FIELDS, MAPPING_ONLY] as readonly string[];
  const payload: Record<string, unknown> = { merchant_id: session.id };
  for (const key of allowed) if (key in body) payload[key] = body[key];

  const touchesLetterhead = OWNER_FIELDS.some(f => f in payload);
  if (touchesLetterhead && !isOwner(session)) {
    // ⚠️ Enforced here and not only in the UI. A phished staff password must
    // not be able to change the payee on documents going to customers, for the
    // same reason it must not be able to redirect a payout.
    return NextResponse.json({ error: 'owner_only' }, { status: 403 });
  }
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
