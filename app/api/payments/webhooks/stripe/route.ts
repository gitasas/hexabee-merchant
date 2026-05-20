import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { query } from '@/lib/db';

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

  const connectedAccountId = request.headers.get('stripe-account');

  const rawBody = await request.text();
  let event: Stripe.Event;

  try {
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const sessionId = session.id;
    const paymentStatus = session.payment_status;
    // session.id is correct for all methods: the INSERT in /api/payment/stripe uses
    // data.session_id (= session.id from /create-payment) as provider_payment_id for
    // every payment_method_type (card, klarna, bacs, sepa, pay_by_bank, etc.)

    if (paymentStatus === 'paid') {
      await query(
        'UPDATE merchant_payments SET status = $1 WHERE provider_payment_id = $2',
        ['paid', sessionId]
      );
    }

    // Forward to Railway for merchant email notification (fire-and-forget)
    if (process.env.BACKEND_URL && session.payment_intent) {
      const stripe = getStripe();
      const paymentIntent = await stripe.paymentIntents.retrieve(
        session.payment_intent as string
      );
      const connectAccountId = (paymentIntent.transfer_data as any)?.destination ?? null;

      console.log('[Stripe webhook] connectAccountId from PaymentIntent', connectAccountId);

      if (connectAccountId) {
        fetch(`${process.env.BACKEND_URL}/stripe-webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'stripe-signature': signature,
            'x-connect-account-id': connectAccountId,
          },
          body: rawBody,
        }).catch((err) => {
          console.error('[Stripe webhook] Railway forward failed', String(err));
        });
      }
    }

    console.log('[Stripe webhook] checkout.session.completed', {
      eventId: event.id,
      sessionId,
      paymentStatus,
      connectedAccountId,
    });
    console.log('[Stripe webhook] session transfer_data', {
      transfer_data: (session as any).transfer_data,
      payment_intent: session.payment_intent,
    });
  }

  // Fallback: payment_intent events (for non-Checkout flows)
  if (
    event.type === 'payment_intent.succeeded' ||
    event.type === 'payment_intent.payment_failed'
  ) {
    const intent = event.data.object as Stripe.PaymentIntent;
    const status = event.type === 'payment_intent.succeeded' ? 'paid' : 'failed';

    await query(
      'UPDATE merchant_payments SET status = $1 WHERE provider_payment_id = $2',
      [status, intent.id]
    );

    console.log('[Stripe webhook] payment_intent', {
      eventId: event.id,
      type: event.type,
      connectedAccountId,
    });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
