import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

const CL_URL = (process.env.ADMIN_API_BASE_URL || '').replace(/\/$/, '');
const SERVICE_TOKEN = process.env.HEXABEE_ADMIN_API_TOKEN || ''; // same value as on cooperative-luck

function clHeaders(merchantId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Token': SERVICE_TOKEN,
    'X-Merchant-Id': merchantId,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const res = await fetch(`${CL_URL}/api/admin/payment-links/${id}`, {
      headers: clHeaders(session.id),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch payment link' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = await req.json();
    const res = await fetch(`${CL_URL}/api/admin/payment-links/${id}`, {
      method: 'PATCH',
      headers: clHeaders(session.id),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update payment link' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const res = await fetch(`${CL_URL}/api/admin/payment-links/${id}`, {
      method: 'DELETE',
      headers: clHeaders(session.id),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete payment link' },
      { status: 500 }
    );
  }
}
