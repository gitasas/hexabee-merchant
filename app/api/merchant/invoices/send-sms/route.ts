import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// Send one chunk of an SMS batch, exactly like the email batch above it.
//
// Chunked for the same reason and one more: Tele2's API takes up to 100
// recipients per request but has **no per-recipient templating**, and our pay
// links carry the invoice reference - so a personalised link means one request
// per person. 700 plot owners is 700 requests, which Tele2 confirmed in
// writing is fine ("galima siųsti ir po vieną SMS"). The browser calls this
// repeatedly and watches the count fall.
//
// The Python backend owns the sending, the per-message record and the decision
// about when to stop - including the monthly allowance, which it counts itself
// because Tele2 will not report it.
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
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-invoices/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
      body: JSON.stringify({ merchant_id: session.id, limit }),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `SMS service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/invoices/send-sms] proxy failed', String(err));
    return NextResponse.json({ error: 'SMS service unreachable' }, { status: 502 });
  }
}
