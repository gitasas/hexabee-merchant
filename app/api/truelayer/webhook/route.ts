import { NextResponse } from 'next/server';
import { mapTrueLayerStatusToStoredStatus, updateStoredPaymentByTrueLayerPaymentId } from '@/lib/payments-store';

type WebhookBody = {
  event_id?: string;
  type?: string;
  payment_id?: string;
  status?: string;
  failure_reason?: string;
  resource?: {
    id?: string;
    payment_id?: string;
    status?: string;
    failure_reason?: string;
  };
};

function extractPaymentUpdate(payload: WebhookBody) {
  const truelayerPaymentId = payload.payment_id ?? payload.resource?.payment_id ?? payload.resource?.id;
  const rawStatus = payload.status ?? payload.resource?.status;
  const failureReason = payload.failure_reason ?? payload.resource?.failure_reason;

  return {
    truelayerPaymentId,
    rawStatus,
    status: mapTrueLayerStatusToStoredStatus(rawStatus),
    failureReason,
    type: payload.type,
    eventId: payload.event_id,
  };
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as WebhookBody;
    console.log('[TrueLayer webhook] Incoming payload:', JSON.stringify(payload));

    const paymentUpdate = extractPaymentUpdate(payload);

    if (!paymentUpdate.truelayerPaymentId) {
      console.warn('[TrueLayer webhook] Missing payment id in payload');
      return NextResponse.json({ ok: true, ignored: true, reason: 'missing_payment_id' });
    }

    const updatedPayment = await updateStoredPaymentByTrueLayerPaymentId(paymentUpdate.truelayerPaymentId, {
      eventId: paymentUpdate.eventId,
      type: paymentUpdate.type,
      status: paymentUpdate.status,
      failureReason: paymentUpdate.failureReason,
      payload,
    });

    if (!updatedPayment) {
      console.warn(`[TrueLayer webhook] Payment not found for id: ${paymentUpdate.truelayerPaymentId}`);
      return NextResponse.json({ ok: true, ignored: true, reason: 'payment_not_found' });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[TrueLayer webhook] Failed to process webhook', error);
    return NextResponse.json({ ok: false, error: 'invalid_webhook_payload' }, { status: 400 });
  }
}
