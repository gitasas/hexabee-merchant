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
  payment_rail: string | null;
  stripe_account_id: string | null;
  montonio_configured: boolean;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const merchant = await queryOne<MerchantRow>(
    `SELECT business_name, iban, sort_code, account_number, slug, enabled_methods,
            business_currency, fee_mode, payment_rail, stripe_account_id,
            ((montonio_access_key IS NOT NULL AND montonio_secret_key IS NOT NULL) OR montonio_sandbox IS TRUE) AS montonio_configured
     FROM merchants WHERE slug = $1 AND is_active = true`,
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
    // Which rail this merchant's payments take. The pay page needs it to decide
    // both which methods to offer and which endpoint to call — without it, a
    // merchant switched to Montonio in the admin would still check out through
    // Stripe and settle into the wrong account.
    payment_rail: merchant.payment_rail === 'montonio' ? 'montonio' : 'stripe',
    // A merchant part-way through onboarding has neither rail working yet. Saying
    // so beats rendering payment buttons that fail the moment they are pressed —
    // and the payer, who did nothing wrong, is the one who would see that failure.
    accepting_payments:
      merchant.payment_rail === 'montonio'
        ? merchant.montonio_configured
        : !!merchant.stripe_account_id,
  });
}
