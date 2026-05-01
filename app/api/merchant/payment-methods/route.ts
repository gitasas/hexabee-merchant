import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await queryOne<{
    business_country: string | null;
    business_currency: string | null;
    enabled_methods: string[] | null;
  }>(
    'SELECT business_country, business_currency, enabled_methods FROM merchants WHERE id = $1',
    [session.id]
  );

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    country: row.business_country ?? 'GB',
    currency: row.business_currency ?? 'GBP',
    enabled_methods: row.enabled_methods ?? ['cards', 'apple_pay', 'google_pay', 'revolut_pay', 'bacs', 'bank_transfer', 'klarna', 'afterpay'],
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { enabled_methods } = body as { enabled_methods: unknown };

  if (!Array.isArray(enabled_methods)) {
    return NextResponse.json({ error: 'enabled_methods must be an array' }, { status: 400 });
  }

  await query(
    'UPDATE merchants SET enabled_methods = $1 WHERE id = $2',
    [JSON.stringify(enabled_methods), session.id]
  );

  return NextResponse.json({ success: true });
}
