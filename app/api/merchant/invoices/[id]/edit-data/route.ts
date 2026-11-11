import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// What the manual invoice form needs to reopen an issued invoice for
// correction. Scoped by the session's merchant on the backend, so an id from
// another account answers 404.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const base = process.env.ADMIN_API_BASE_URL?.replace(/\/$/, '');
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const res = await fetch(
    `${base}/api/plugin/merchant-invoices/${encodeURIComponent(id)}/edit-data?merchant_id=${encodeURIComponent(session.id)}`,
    { headers: { 'X-Internal-Token': token }, cache: 'no-store' }
  );
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
