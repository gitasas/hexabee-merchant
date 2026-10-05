import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// Send one invoice again. The batch refuses anything already sent - and should,
// because half a customer list receiving the same invoice twice is the mirror
// of half not receiving it at all. This is the other case: a letter went out
// with a typo, or a customer says it never arrived, and the merchant is
// pointing at one row and asking for it to go again.
//
// The Python backend waives exactly one check, `sent_at`, and keeps the ones
// that protect the payer: a recipient, a number, a readable amount.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

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
      `${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-invoices/${encodeURIComponent(id)}/resend`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
        body: JSON.stringify({ merchant_id: session.id }),
      }
    );
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `Send service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/invoices/resend] proxy failed', String(err));
    return NextResponse.json({ error: 'Send service unreachable' }, { status: 502 });
  }
}
