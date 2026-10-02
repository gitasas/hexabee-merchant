import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// Send one chunk of a batch. The browser calls this repeatedly until nothing is
// left, which is what keeps a sixty-invoice send inside every timeout between
// here and Resend, and what makes an interruption cost one chunk instead of a
// batch. The Python backend owns the sending, the per-invoice record and the
// decision about when to stop.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let limit = 10;
  try {
    const body = await req.json();
    const n = Number(body?.limit);
    if (Number.isFinite(n)) limit = Math.max(1, Math.min(25, Math.round(n)));
  } catch { /* the default chunk is fine */ }

  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !internalToken) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-invoices/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
      body: JSON.stringify({ merchant_id: session.id, limit }),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `Send service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/invoices/send] proxy failed', String(err));
    return NextResponse.json({ error: 'Send service unreachable' }, { status: 502 });
  }
}
