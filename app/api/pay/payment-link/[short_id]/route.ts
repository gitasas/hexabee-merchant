import { NextRequest, NextResponse } from 'next/server';

// Public proxy — no auth required. Forwards payer-facing lookup to cooperative-luck.
// cooperative-luck returns 410 with payer-friendly messages for expired/exhausted/disabled links.
const CL_URL = (process.env.ADMIN_API_BASE_URL || '').replace(/\/$/, '');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ short_id: string }> }
) {
  const { short_id } = await params;

  if (!CL_URL) {
    return NextResponse.json({ detail: 'Backend not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `${CL_URL}/api/plugin/payment-links/${encodeURIComponent(short_id)}`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Payment link not found' }, { status: 404 });
  }
}
