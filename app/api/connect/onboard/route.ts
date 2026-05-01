import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

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
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stripe = getStripe();

    // Prefer accountId from body, then DB, then create new
    const body = (await request.json().catch(() => ({}))) as { accountId?: string; returnPath?: string };

    let accountId = body.accountId;

    if (!accountId) {
      const row = await queryOne<{ stripe_account_id: string | null }>(
        'SELECT stripe_account_id FROM merchants WHERE id = $1',
        [session.id]
      );
      accountId = row?.stripe_account_id ?? undefined;
    }

    if (!accountId) {
      const account = await stripe.accounts.create({ type: 'standard' });
      accountId = account.id;

      await query(
        'UPDATE merchants SET stripe_account_id = $1 WHERE id = $2',
        [accountId, session.id]
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      request.headers.get('origin') ??
      'https://merchant.hexabee.buzz';

    const returnPath = body.returnPath ?? '/merchant/settings';

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}${returnPath}`,
      return_url: `${appUrl}${returnPath}`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ ok: true, accountId, url: accountLink.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create Connect link';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
