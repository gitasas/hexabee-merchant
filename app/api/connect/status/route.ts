import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSession } from '@/lib/merchant-auth';
import { queryOne } from '@/lib/db';

export const runtime = 'nodejs';

// Caller (settings page) passes the correct accountId for the current env (live or test).
// The route verifies the accountId belongs to the logged-in merchant before querying Stripe.

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

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get('accountId');

  if (!accountId) {
    return NextResponse.json({ ok: false, error: 'Missing accountId' }, { status: 400 });
  }

  const merchant = await queryOne<{ stripe_account_id: string | null; stripe_account_id_live: string | null }>(
    'SELECT stripe_account_id, stripe_account_id_live FROM merchants WHERE id = $1',
    [session.id]
  );

  if (
    !merchant ||
    (accountId !== merchant.stripe_account_id && accountId !== merchant.stripe_account_id_live)
  ) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const account = await getStripe().accounts.retrieve(accountId);

    return NextResponse.json({
      ok: true,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve account';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
