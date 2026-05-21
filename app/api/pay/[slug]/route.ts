import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

const isLive = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ?? false;

type MerchantRow = {
  business_name: string;
  iban: string | null;
  sort_code: string | null;
  account_number: string | null;
  slug: string;
  enabled_methods: string[] | null;
  stripe_account_id: string | null;
  stripe_account_id_live: string | null;
  business_currency: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const merchant = await queryOne<MerchantRow>(
    'SELECT business_name, iban, sort_code, account_number, slug, enabled_methods, stripe_account_id, stripe_account_id_live, business_currency FROM merchants WHERE slug = $1 AND is_active = true',
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
    iban: merchant.sort_code ? null : merchant.iban,
    sort_code: merchant.sort_code ?? null,
    account_number: merchant.account_number ?? null,
    slug: merchant.slug,
    enabled_methods: merchant.enabled_methods,
    stripe_account_id: stripeAccountId,
    currency: merchant.business_currency ?? (merchant.sort_code ? 'GBP' : 'EUR'),
  });
}
