import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

type MerchantRow = {
  id: string;
  stripe_account_id: string | null;
  business_name: string | null;
  slug: string | null;
  enabled_methods: string[] | null;
};

export async function POST(req: NextRequest) {
  try {
    const { iban } = (await req.json()) as { iban?: string };

    if (!iban) return NextResponse.json({ found: false });

    const merchant = await queryOne<MerchantRow>(
      'SELECT id, stripe_account_id, business_name, slug, enabled_methods FROM merchants WHERE iban = $1 AND is_active = true',
      [iban]
    );

    if (!merchant) return NextResponse.json({ found: false });

    return NextResponse.json({
      found: true,
      merchant: {
        id: merchant.id,
        stripeAccountId: merchant.stripe_account_id,
        businessName: merchant.business_name,
        slug: merchant.slug,
        enabledMethods: merchant.enabled_methods,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { found: false, error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 500 }
    );
  }
}
