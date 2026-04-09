import { NextResponse } from 'next/server';
import { createIdempotencyKey, getAccessToken, signRequest } from '@/lib/truelayer';

const TRUELAYER_PAYMENT_LINK_URL = 'https://api.truelayer-sandbox.com/v3/payment-links';

type CreatePaymentLinkRequest = {
  amount: string | number;
  currency?: string;
  email?: string;
  name?: string;
  reference?: string;
  selectedBank?: string;
};

function toMinorAmount(amount: string | number): number {
  const amountText = String(amount).replace(/[^\d.,-]/g, '').replace(',', '.');
  const parsed = Number(amountText);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  return Math.round(parsed * 100);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreatePaymentLinkRequest;
    const amountInMinor = toMinorAmount(body.amount);
    const invoiceId = body.reference || `invoice-${Date.now()}`;

    const payload = {
      amount_in_minor: amountInMinor,
      currency: 'GBP',
      user: {
        name: body.name || 'HexaBee Merchant',
        email: body.email || 'support@hexabee.local',
      },
      metadata: {
        invoice_id: invoiceId,
        ...(body.selectedBank ? { selected_bank: body.selectedBank } : {}),
      },
    };

    console.log('[CreatePaymentLink] payload', payload);

    const accessToken = await getAccessToken();
    const tlSignature = await signRequest(JSON.stringify(payload));
    const idempotencyKey = createIdempotencyKey();

    const trueLayerResponse = await fetch(TRUELAYER_PAYMENT_LINK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Tl-Signature': tlSignature,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const responseText = await trueLayerResponse.text();
    console.log('[CreatePaymentLink] TrueLayer status', trueLayerResponse.status);
    console.log('[CreatePaymentLink] TrueLayer response', responseText);

    if (!trueLayerResponse.ok) {
      return NextResponse.json(
        {
          error: 'Failed to create payment link',
          details: responseText,
        },
        { status: trueLayerResponse.status },
      );
    }

    const parsed = JSON.parse(responseText) as { payment_link?: string; url?: string };
    const paymentLink = parsed.payment_link ?? parsed.url;

    if (!paymentLink) {
      return NextResponse.json(
        {
          error: 'Payment link missing in TrueLayer response',
          details: parsed,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      payment_link: paymentLink,
    });
  } catch (error) {
    console.error('[CreatePaymentLink] Unexpected error', error);
    return NextResponse.json(
      {
        error: 'Unexpected error while creating payment link',
      },
      { status: 500 },
    );
  }
}
