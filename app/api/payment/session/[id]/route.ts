import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

let _stripe: Stripe | null = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });
  }
  return _stripe;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !id.startsWith('cs_')) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }
  try {
    const session = await getStripe().checkout.sessions.retrieve(id);
    // Only expose what the payment-success page renders (summary + PDF receipt):
    // metadata is trimmed to the keys the receipt uses, customer_details to name/email.
    const metadata = session.metadata ?? {};
    const trimmedMetadata: Record<string, string> = {};
    if (metadata.reference) trimmedMetadata.reference = metadata.reference;
    if (metadata.receiver) trimmedMetadata.receiver = metadata.receiver;
    if (metadata.merchant) trimmedMetadata.merchant = metadata.merchant;
    return NextResponse.json({
      id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      payment_status: session.payment_status,
      created: session.created,
      metadata: trimmedMetadata,
      customer_details: session.customer_details
        ? { email: session.customer_details.email ?? null, name: session.customer_details.name ?? null }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}