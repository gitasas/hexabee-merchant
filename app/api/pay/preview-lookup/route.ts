import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

type MerchantRow = {
  business_name: string | null;
  slug: string | null;
  payment_rail: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const { iban } = (await req.json()) as { iban?: string };

    if (!iban) return NextResponse.json({ found: false });

    const merchant = await queryOne<MerchantRow>(
      'SELECT business_name, slug, payment_rail FROM merchants WHERE iban = $1 AND is_active = true',
      [iban]
    );

    if (!merchant) return NextResponse.json({ found: false });

    // Only expose what the pay-preview UI renders: name, slug and the rail.
    // Bank details and Stripe account ids are intentionally not returned here.
    // The rail is needed or the preview shows a Montonio merchant the Stripe
    // methods — a preview whose whole purpose is to show what really happens.
    return NextResponse.json({
      found: true,
      merchant: {
        businessName: merchant.business_name,
        slug: merchant.slug,
        paymentRail: merchant.payment_rail === 'montonio' ? 'montonio' : 'stripe',
      },
    });
  } catch (err) {
    console.error('PREVIEW_LOOKUP_ERROR', err);
    return NextResponse.json({ found: false, error: 'Lookup failed' }, { status: 500 });
  }
}
