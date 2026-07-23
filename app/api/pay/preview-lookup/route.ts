import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

type MerchantRow = {
  business_name: string | null;
  slug: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const { iban } = (await req.json()) as { iban?: string };

    if (!iban) return NextResponse.json({ found: false });

    const merchant = await queryOne<MerchantRow>(
      'SELECT business_name, slug FROM merchants WHERE iban = $1 AND is_active = true',
      [iban]
    );

    if (!merchant) return NextResponse.json({ found: false });

    // Only expose what the pay-preview UI renders: name + slug.
    // Bank details and Stripe account ids are intentionally not returned here.
    return NextResponse.json({
      found: true,
      merchant: {
        businessName: merchant.business_name,
        slug: merchant.slug,
      },
    });
  } catch (err) {
    console.error('PREVIEW_LOOKUP_ERROR', err);
    return NextResponse.json({ found: false, error: 'Lookup failed' }, { status: 500 });
  }
}
