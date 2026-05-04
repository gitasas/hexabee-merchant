import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

const isLive = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ?? false;

type MerchantRow = {
  business_name: string;
  iban: string;
  slug: string;
  enabled_methods: string[] | null;
  stripe_account_id: string | null;
  stripe_account_id_live: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const merchant = await queryOne<MerchantRow>(
    'SELECT business_name, iban, slug, enabled_methods, stripe_account_id, stripe_account_id_live FROM merchants WHERE slug = $1 AND is_active = true',
    [slug.toLowerCase()]
  );

  if (!merchant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Return the correct Connect account for the current Stripe environment
  const stripeAccountId = isLive
    ? merchant.stripe_account_id_live
    : merchant.stripe_account_id;

  return NextResponse.json({
    business_name: merchant.business_name,
    iban: merchant.iban,
    slug: merchant.slug,
    enabled_methods: merchant.enabled_methods,
    stripe_account_id: stripeAccountId,
  });
}
