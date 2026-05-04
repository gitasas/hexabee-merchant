import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

type MerchantRow = { business_name: string; iban: string; slug: string; enabled_methods: string[] | null; stripe_account_id: string | null };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const merchant = await queryOne<MerchantRow>(
    'SELECT business_name, iban, slug, enabled_methods, stripe_account_id FROM merchants WHERE slug = $1 AND is_active = true',
    [slug.toLowerCase()]
  );

  if (!merchant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(merchant);
}
