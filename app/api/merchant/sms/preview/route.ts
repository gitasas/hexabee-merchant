import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// The server's own price for a template the merchant is still typing.
//
// The editor counts characters in the browser (`smsSegments` in
// lib/sms-template.ts) because a round-trip per keystroke would be absurd -
// which makes that a **second implementation of one rule**, and drift there
// shows the merchant one price while the send charges another. One Lithuanian
// diacritic is the difference between 160 characters a segment and 70, so at
// 700 recipients it is the difference between €18 and €36.
//
// So the portal asks here once the merchant stops typing and compares. A
// disagreement becomes visible on screen rather than on a bill.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let template = '';
  try {
    const body = await req.json();
    if (typeof body?.template === 'string') template = body.template;
  } catch { /* an empty template prices the built-in default, which is useful */ }

  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !internalToken) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-sms/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
      body: JSON.stringify({ merchant_id: session.id, template }),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `SMS service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/sms/preview] proxy failed', String(err));
    return NextResponse.json({ error: 'SMS service unreachable' }, { status: 502 });
  }
}
