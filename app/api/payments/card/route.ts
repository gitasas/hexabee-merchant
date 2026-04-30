import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createStoredPayment } from '@/lib/payments/store';

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

function parseAmountToMinor(amount: string | number | undefined): number {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    return Math.max(0, Math.round(amount * 100));
  }

  if (typeof amount === 'string') {
    const numeric = Number.parseFloat(amount.replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.round(numeric * 100));
    }
  }

  return 0;
}

function calculateApplicationFee(amountInMinor: number, currency: string): number {
  const pct = Math.round(amountInMinor * 0.018);
  const fixed = currency.toLowerCase() === 'gbp' ? 20 : 25;
  return pct + fixed;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      amount?: string | number;
      currency?: string;
      reference?: string;
      stripeConnectAccountId?: string;
    };

    const amountInMinor = parseAmountToMinor(payload.amount);
    const reference = payload.reference ?? `CARD-${Date.now()}`;
    const currency = (payload.currency ?? 'eur').toLowerCase();
    const stripeConnectAccountId = payload.stripeConnectAccountId;

    const intentParams: Stripe.PaymentIntentCreateParams = {
      amount: amountInMinor,
      currency,
      metadata: { reference },
    };

    if (stripeConnectAccountId) {
      intentParams.application_fee_amount = calculateApplicationFee(amountInMinor, currency);
      intentParams.transfer_data = { destination: stripeConnectAccountId };
    }

    const intent = await getStripe().paymentIntents.create(intentParams);

    const payment = await createStoredPayment({
      providerPaymentId: intent.id,
      reference,
      amountInMinor,
      currency,
    });

    return NextResponse.json({
      ok: true,
      paymentId: payment.id,
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret,
      status: 'pending',
      method: 'card',
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'Unable to create card payment.',
      },
      { status: 500 },
    );
  }
}
