import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { query, queryOne } from '@/lib/db';

const isLive = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ?? false;

type MerchantRow = {
  id: string;
  stripe_account_id: string | null;
  stripe_account_id_live: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      console.error('BACKEND_URL is not set — cannot create payment');
      return NextResponse.json(
        { error: 'Payment backend not configured' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { merchantSlug, amount, currency, reference, payment_method_type } = body;

    // Never trust a client-supplied Connect account id — resolve it server-side
    // from the merchant slug for the current Stripe environment.
    delete body.stripeConnectAccountId;
    let merchant: MerchantRow | null = null;
    if (merchantSlug) {
      merchant = await queryOne<MerchantRow>(
        'SELECT id, stripe_account_id, stripe_account_id_live FROM merchants WHERE slug = $1 AND is_active = true',
        [String(merchantSlug).toLowerCase()]
      );
      const accountId = isLive
        ? merchant?.stripe_account_id_live
        : merchant?.stripe_account_id;
      if (accountId) {
        body.stripeConnectAccountId = accountId;
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.BACKEND_API_TOKEN) {
      headers['X-Backend-Token'] = process.env.BACKEND_API_TOKEN;
    }

    const res = await fetch(`${backendUrl}/create-payment`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    if (merchant) {
      await query(
        `INSERT INTO merchant_payments (id, merchant_id, provider, provider_payment_id, amount, currency, reference, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'initiated', NOW())`,
        [randomUUID(), merchant.id, payment_method_type ?? 'stripe', data.session_id ?? null, amount ?? null, currency ?? 'EUR', reference ?? null]
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payment creation failed' },
      { status: 500 }
    );
  }
}
