import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

type MerchantRow = {
  business_name: string;
  iban: string | null;
  sort_code: string | null;
  account_number: string | null;
  slug: string;
  enabled_methods: string[] | null;
  business_currency: string | null;
  fee_mode: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const merchant = await queryOne<MerchantRow>(
    'SELECT business_name, iban, sort_code, account_number, slug, enabled_methods, business_currency, fee_mode FROM merchants WHERE slug = $1 AND is_active = true',
    [slug.toLowerCase()]
  );

  if (!merchant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // The Stripe Connect account id is intentionally not exposed here —
  // /api/payment/stripe resolves it server-side from the merchant slug.
  // iban/sort_code/account_number stay: the pay page renders them for
  // manual bank transfer display.
  return NextResponse.json({
    business_name: merchant.business_name,
    iban: merchant.sort_code ? null : merchant.iban,
    sort_code: merchant.sort_code ?? null,
    account_number: merchant.account_number ?? null,
    slug: merchant.slug,
    enabled_methods: merchant.enabled_methods,
    currency: merchant.business_currency ?? (merchant.sort_code ? 'GBP' : 'EUR'),
    fee_mode: merchant.fee_mode === 'payer' ? 'payer' : 'merchant',
  });
}
