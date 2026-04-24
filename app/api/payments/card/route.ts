import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createStoredPayment } from '@/lib/payments/store';

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

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { amount?: string | number; currency?: string; reference?: string };
    const amountInMinor = parseAmountToMinor(payload.amount);
    const reference = payload.reference ?? `CARD-${Date.now()}`;
    const currency = payload.currency ?? 'EUR';
    const providerPaymentId = `card_${randomUUID()}`;

    const payment = await createStoredPayment({
      providerPaymentId,
      reference,
      amountInMinor,
      currency,
    });

    return NextResponse.json({
      ok: true,
      paymentId: payment.id,
      providerPaymentId,
      status: 'executed',
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
