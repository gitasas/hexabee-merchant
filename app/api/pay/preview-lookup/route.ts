import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

type MerchantRow = {
  business_name: string | null;
  slug: string | null;
  payment_rail: string | null;
  enabled_methods: string[] | null;
  fee_mode: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const { iban } = (await req.json()) as { iban?: string };

    if (!iban) return NextResponse.json({ found: false });

    const merchant = await queryOne<MerchantRow>(
      'SELECT business_name, slug, payment_rail, enabled_methods, fee_mode FROM merchants WHERE iban = $1 AND is_active = true',
      [iban]
    );

    if (!merchant) return NextResponse.json({ found: false });

    // Only expose what the pay-preview UI renders. Bank details and Stripe
    // account ids are intentionally not returned here. The rail, the toggles
    // and the fee mode are all needed: without them the preview offered every
    // method in the catalogue, switched off or not, and on the Montonio rail
    // said "Pay" for an amount it was about to add a fee to.
    return NextResponse.json({
      found: true,
      merchant: {
        businessName: merchant.business_name,
        slug: merchant.slug,
        paymentRail: merchant.payment_rail === 'montonio' ? 'montonio' : 'stripe',
        enabledMethods: merchant.enabled_methods,
        feeMode: merchant.fee_mode,
      },
    });
  } catch (err) {
    console.error('PREVIEW_LOOKUP_ERROR', err);
    return NextResponse.json({ found: false, error: 'Lookup failed' }, { status: 500 });
  }
}
