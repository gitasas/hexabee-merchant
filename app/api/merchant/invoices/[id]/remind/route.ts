import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// Proxy to the Python backend which owns reminder sending (dunning emails).
// The backend enforces ownership (merchant_id), paid-status and payer-email checks.
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
      `${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-invoices/${encodeURIComponent(id)}/remind`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': internalToken,
        },
        body: JSON.stringify({ merchant_id: session.id }),
      }
    );

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `Reminder service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/invoices/remind] proxy failed', String(err));
    return NextResponse.json({ error: 'Reminder service unreachable' }, { status: 502 });
  }
}
