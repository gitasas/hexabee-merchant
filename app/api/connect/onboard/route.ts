import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';

let _stripe: Stripe | null = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Missing STRIPE_SECRET_KEY');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-04-22.dahlia',
    });
  }
  return _stripe;
}

export async function POST(request: NextRequest) {
  try {
    const stripe = getStripe();

    const body = (await request.json()) as { accountId?: string };
    let accountId = body.accountId;

    if (!accountId) {
      const account = await stripe.accounts.create({ type: 'standard' });
      accountId = account.id;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.headers.get('origin') ?? 'https://merchant.hexabee.buzz';

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/settings/connect/refresh`,
      return_url: `${appUrl}/settings/connect/return`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ ok: true, accountId, url: accountLink.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create Connect link';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
