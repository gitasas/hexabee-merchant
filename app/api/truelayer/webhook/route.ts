import { NextResponse } from 'next/server';
const ADMIN_API_BASE_URL = process.env.ADMIN_API_BASE_URL || '';

async function postToAdmin(path: string, payload: unknown) {
  if (!ADMIN_API_BASE_URL) {
    console.warn('[TrueLayer webhook] ADMIN_API_BASE_URL not set');
    return null;
  }

  try {
    const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const text = await response.text();

    if (!response.ok) {
      console.error('[TrueLayer webhook] ADMIN_SYNC_ERROR', {
        path,
        status: response.status,
        body: text,
      });
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error) {
    console.error('[TrueLayer webhook] ADMIN_FETCH_FAILED', error);
    return null;
  }
}

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

function mapTrueLayerStatusToStoredStatus(rawStatus?: string) {
  const normalized = rawStatus?.toLowerCase();

  switch (normalized) {
    case 'authorization_required':
      return 'authorization_required';
    case 'authorizing':
      return 'authorizing';
    case 'executed':
      return 'executed';
    case 'settled':
      return 'settled';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'created':
      return 'created';
    default:
      return 'unknown';
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as WebhookBody;
    console.log('[TrueLayer webhook] Incoming payload:', JSON.stringify(payload));

    const paymentUpdate = extractPaymentUpdate(payload);

    await postToAdmin('/api/plugin/events', {
      email: 'system@hexabee.local',
      event_type: 'truelayer_webhook_received',
      event_data: {
        truelayer_payment_id: paymentUpdate.truelayerPaymentId,
        raw_status: paymentUpdate.rawStatus,
        mapped_status: paymentUpdate.status,
        failure_reason: paymentUpdate.failureReason,
        event_id: paymentUpdate.eventId,
        type: paymentUpdate.type,
        payload,
      },
    });

    if (!paymentUpdate.truelayerPaymentId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    return NextResponse.json({
      ok: true,
      synced_to_events_only: true,
      todo: 'FastAPI still needs a dedicated endpoint to update payment status by provider_payment_id',
    });
  } catch (error) {
    console.error('[TrueLayer webhook] Failed to process webhook', error);
    return NextResponse.json({ ok: false, error: 'invalid_webhook_payload' }, { status: 400 });
  }
}
