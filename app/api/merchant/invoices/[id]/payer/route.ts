import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// Give one invoice a recipient. The Python backend owns the remembering: it
// stores the address against the payer's name, fills every other invoice this
// month with the same name and no recipient, and refuses to overwrite a name
// that already has a different address (two people share it, so nothing with
// that name may match automatically again).
//
// This route exists only to prove the session and hand over the merchant_id -
// the same shape as the reminder proxy next to it. Ownership is enforced on the
// other side too, against the merchant_id sent from here.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let email = '';
  try {
    const body = await req.json();
    email = String(body?.email ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !internalToken) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-invoices/${encodeURIComponent(id)}/payer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
        body: JSON.stringify({ merchant_id: session.id, email }),
      }
    );
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `Recipient service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/invoices/payer] proxy failed', String(err));
    return NextResponse.json({ error: 'Recipient service unreachable' }, { status: 502 });
  }
}
