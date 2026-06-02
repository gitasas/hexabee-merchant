import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// Merchant-authenticated proxy to cooperative-luck /api/admin/payment-links.
// Uses HEXABEE_ADMIN_API_TOKEN — same env var name and value as on cooperative-luck side.
// One secret, set on both Vercel (hexabee-merchant) and Railway (cooperative-luck).
const CL_URL = (process.env.ADMIN_API_BASE_URL || '').replace(/\/$/, '');
const SERVICE_TOKEN = process.env.HEXABEE_ADMIN_API_TOKEN || '';

function clHeaders(merchantId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Token': SERVICE_TOKEN,
    'X-Merchant-Id': merchantId,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const res = await fetch(`${CL_URL}/api/admin/payment-links`, {
      headers: clHeaders(session.id),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch payment links' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const res = await fetch(`${CL_URL}/api/admin/payment-links`, {
      method: 'POST',
      headers: clHeaders(session.id),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create payment link' },
      { status: 500 }
    );
  }
}
