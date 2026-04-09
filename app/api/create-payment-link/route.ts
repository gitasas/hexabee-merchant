import { NextResponse } from 'next/server';
import { createIdempotencyKey, getAccessToken, signRequest } from '@/lib/truelayer';

const TRUELAYER_PAYMENTS_URL = 'https://api.truelayer-sandbox.com/v3/payment-links';

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
    const currency = (body.currency ?? 'GBP').toUpperCase();

    if (!Number.isInteger(amountInMinor)) {
      throw new Error(`Invalid amount_in_minor. Expected integer, got: ${amountInMinor}`);
    }

    if (!currency || (body.currency && body.currency !== body.currency.toUpperCase())) {
      throw new Error(`Invalid currency. Expected uppercase ISO code, got: ${body.currency}`);
    }

    const beneficiaryName = body.name?.trim() || 'HexaBee Merchant';
    const beneficiaryReference = invoiceId;

    if (!beneficiaryName || !beneficiaryReference) {
      throw new Error('Invalid beneficiary. Missing beneficiary name or reference');
    }

    const clientId = process.env.TRUELAYER_CLIENT_ID || '';
    const clientSecret = process.env.TRUELAYER_CLIENT_SECRET || '';
    const privateKey = process.env.TRUELAYER_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';

    console.log('[CreatePaymentLink] client_id first 30 chars:', clientId.slice(0, 30));
    console.log('[CreatePaymentLink] client_secret exists:', !!clientSecret);
    console.log('[CreatePaymentLink] private key length:', privateKey.length);

    const payload = {
      amount_in_minor: amountInMinor,
      currency,
      payment_method: {
        type: 'bank_transfer',
        beneficiary: {
          type: 'merchant_account',
        },
      },
      user: {
        name: beneficiaryName,
        email: body.email || 'support@hexabee.local',
      },
      metadata: {
        beneficiary_reference: beneficiaryReference,
        invoice_id: invoiceId,
        ...(body.selectedBank ? { selected_bank: body.selectedBank } : {}),
      },
      beneficiary: {
        type: 'merchant_account',
      },
    };

    const paymentRequestBody = JSON.stringify(payload);
    console.log('[CreatePaymentLink] Payment request URL:', TRUELAYER_PAYMENTS_URL);
    console.log('[CreatePaymentLink] Payment request body:', payload);
    console.log('[CreatePaymentLink] Payment request body first 100 chars:', paymentRequestBody.slice(0, 100));

    const accessToken = await getAccessToken();
    console.log('[CreatePaymentLink] Access token acquired:', !!accessToken);
    console.log('[CreatePaymentLink] Access token first 50 chars:', accessToken ? accessToken.slice(0, 50) : null);
    const tlSignature = await signRequest(paymentRequestBody);
    const idempotencyKey = createIdempotencyKey();

    let responseData: Record<string, unknown>;
    try {
      const trueLayerResponse = await fetch(TRUELAYER_PAYMENTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Tl-Signature': tlSignature,
          'Idempotency-Key': idempotencyKey,
        },
        body: paymentRequestBody,
        cache: 'no-store',
      });

      const responseText = await trueLayerResponse.text();
      console.log('[CreatePaymentLink] Payment response status:', trueLayerResponse.status);
      console.log('[CreatePaymentLink] Payment response body:', responseText);
      console.log('[CreatePaymentLink] Exact TrueLayer payment response body:', responseText);

      if (!trueLayerResponse.ok) {
        let parsedError: unknown = responseText;
        try {
          parsedError = responseText ? JSON.parse(responseText) : null;
        } catch {
          parsedError = responseText || null;
        }
        const tlError = new Error(`TrueLayer payments request failed: ${trueLayerResponse.status}`) as Error & {
          status?: number;
          tlStatus?: number;
          tlBody?: unknown;
          response?: { data?: unknown };
        };
        tlError.status = trueLayerResponse.status;
        tlError.tlStatus = trueLayerResponse.status;
        tlError.tlBody = parsedError;
        tlError.response = { data: parsedError };
        throw tlError;
      }

      responseData = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {};
    } catch (tlError) {
      console.error('❌ TrueLayer API ERROR:', (tlError as { response?: { data?: unknown } }).response?.data || tlError);
      throw tlError;
    }

    const paymentId = responseData.id as string | undefined;
    const authUrl = (responseData.authorization_flow as { actions?: { redirect?: { url?: string } } } | undefined)?.actions?.redirect?.url;

    if (!paymentId || !authUrl) {
      return NextResponse.json(
        {
          error: 'Payment ID or authorization URL missing in TrueLayer response',
          details: responseData,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      paymentId,
      authUrl,
      payment_link: authUrl,
    });
  } catch (error) {
    console.error('❌ TrueLayer FULL ERROR:', error);
    const status = (error as { status?: number }).status;
    const tlResponseBody =
      (error as { tlBody?: unknown }).tlBody ||
      (error as { response?: { data?: unknown } }).response?.data ||
      null;
    return NextResponse.json(
      {
        error: (error as { message?: string }).message,
        tlResponse: tlResponseBody,
      },
      { status: status || 500 },
    );
  }
}
