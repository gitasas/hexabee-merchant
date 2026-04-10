import { NextResponse } from 'next/server';
import { postAdminJson } from '@/lib/admin-api';

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
    mappedStatus: mapTrueLayerStatus(rawStatus),
    failureReason,
    type: payload.type,
    eventId: payload.event_id,
  };
}

function mapTrueLayerStatus(rawStatus: string | undefined): string {
  const normalized = rawStatus?.toLowerCase();

  switch (normalized) {
    case 'authorization_required':
    case 'authorizing':
    case 'executed':
    case 'settled':
    case 'failed':
    case 'cancelled':
    case 'created':
      return normalized;
    default:
      return 'unknown';
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as WebhookBody;
    console.log('[TrueLayer webhook] Incoming payload:', JSON.stringify(payload));

    const paymentUpdate = extractPaymentUpdate(payload);

    const synced = await postAdminJson('/api/plugin/events', {
      email: 'system@hexabee.local',
      event_type: 'truelayer_webhook_received',
      event_data: {
        truelayer_payment_id: paymentUpdate.truelayerPaymentId,
        raw_status: paymentUpdate.rawStatus,
        mapped_status: paymentUpdate.mappedStatus,
        failure_reason: paymentUpdate.failureReason,
        event_id: paymentUpdate.eventId,
        type: paymentUpdate.type,
        payload,
      },
    });

    // TODO: FastAPI needs a dedicated endpoint to update payment status by provider_payment_id.
    // We intentionally do not fake local status updates when backend support is unavailable.
    if (!synced) {
      console.warn('[TrueLayer webhook] Failed to sync webhook event to Admin API');
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[TrueLayer webhook] Failed to process webhook', error);
    return NextResponse.json({ ok: false, error: 'invalid_webhook_payload' }, { status: 400 });
  }
}
