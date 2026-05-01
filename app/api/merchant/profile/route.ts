import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

type MerchantRow = {
  id: string;
  email: string;
  business_name: string | null;
  iban: string | null;
  slug: string | null;
  stripe_account_id: string | null;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const merchant = await queryOne<MerchantRow>(
    'SELECT id, email, business_name, iban, slug, stripe_account_id FROM merchants WHERE id = $1',
    [session.id]
  );

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = await queryOne<{ filename: string; created_at: string }>(
    'SELECT filename, created_at FROM merchant_templates WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1',
    [session.id]
  );

  return NextResponse.json({ ...merchant, template: template ?? null });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { businessName, iban, slug } = await req.json();

  if (slug) {
    const existing = await queryOne(
      'SELECT id FROM merchants WHERE slug = $1 AND id != $2',
      [slug.toLowerCase(), session.id]
    );
    if (existing) {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 });
    }
  }

  await query(
    `UPDATE merchants
     SET business_name = COALESCE($1, business_name),
         iban = COALESCE($2, iban),
         slug = COALESCE($3, slug)
     WHERE id = $4`,
    [businessName ?? null, iban ?? null, slug?.toLowerCase() ?? null, session.id]
  );

  return NextResponse.json({ success: true });
}
