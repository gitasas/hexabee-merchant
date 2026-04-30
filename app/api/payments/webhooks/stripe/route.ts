import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { applyWebhookEvent } from '@/lib/payments-store';

export const runtime = 'nodejs';

// Stripe instance (lazy init)
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

export async function GET() {
  return NextResponse.json({ ok: true, service: 'stripe-webhook' });
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing Stripe-Signature header' },
      { status: 400 }
    );
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'Missing STRIPE_WEBHOOK_SECRET' },
      { status: 500 }
    );
  }

  // For Connect webhooks, Stripe sends this header with the connected account ID
  const connectedAccountId = request.headers.get('stripe-account');

  let event: Stripe.Event;

  try {
    const rawBody = await request.text();

    event = await getStripe().webhooks.constructEventAsync(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    );
  }

  if (
    event.type === 'payment_intent.succeeded' ||
    event.type === 'payment_intent.payment_failed'
  ) {
    const intent = event.data.object as Stripe.PaymentIntent;

    const status =
      event.type === 'payment_intent.succeeded' ? 'succeeded' : 'failed';

    const result = applyWebhookEvent({
      providerPaymentId: intent.id,
      status,
      eventId: event.id,
    });

    console.log('[Stripe webhook]', {
      eventId: event.id,
      type: event.type,
      connectedAccountId,
      result,
    });
  }

  // IMPORTANT: always return 200 for handled/unhandled events
  return NextResponse.json({ received: true }, { status: 200 });
}
