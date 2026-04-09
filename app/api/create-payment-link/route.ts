import { createSign, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

const TRUELAYER_TOKEN_URL = 'https://auth.truelayer-sandbox.com/connect/token';
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

function signPayload(payload: string, privateKey: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(payload);
  signer.end();
  return signer.sign(privateKey, 'base64');
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

    console.log('[CreatePaymentLink] CLIENT_ID exists:', !!clientId);
    console.log('[CreatePaymentLink] CLIENT_SECRET exists:', !!clientSecret);
    console.log('[CreatePaymentLink] private key length:', privateKey.length);
    console.log('[CreatePaymentLink] token URL:', TRUELAYER_TOKEN_URL);
    console.log('[CreatePaymentLink] payment URL:', TRUELAYER_PAYMENTS_URL);

    const tokenRequestBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'payments',
    });

    let accessToken = '';

    // Stage A: access token request
    try {
      const tokenRes = await fetch(TRUELAYER_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenRequestBody,
        cache: 'no-store',
      });

      const rawTokenBody = await tokenRes.text();
      let parsedTokenBody: unknown = null;
      try {
        parsedTokenBody = rawTokenBody ? JSON.parse(rawTokenBody) : null;
      } catch {
        parsedTokenBody = null;
      }

      console.log('[CreatePaymentLink] token status:', tokenRes.status);
      console.log('[CreatePaymentLink] token raw response body:', rawTokenBody);

      if (!tokenRes.ok) {
        return NextResponse.json(
          {
            stage: 'token',
            error: 'Failed to obtain TrueLayer access token',
            upstreamStatus: tokenRes.status || null,
            upstreamBody: parsedTokenBody || rawTokenBody || null,
          },
          { status: tokenRes.status || 500 },
        );
      }

      accessToken = ((parsedTokenBody as { access_token?: string } | null)?.access_token ?? '').trim();
      if (!accessToken) {
        return NextResponse.json(
          {
            stage: 'token',
            error: 'Failed to obtain TrueLayer access token',
            upstreamStatus: tokenRes.status || null,
            upstreamBody: parsedTokenBody || rawTokenBody || null,
          },
          { status: tokenRes.status || 500 },
        );
      }
    } catch (error) {
      console.error('[CreatePaymentLink] token request error:', error);
      return NextResponse.json(
        {
          stage: 'token',
          error: 'Failed to obtain TrueLayer access token',
          upstreamStatus: null,
          upstreamBody: { message: (error as { message?: string }).message || 'Unknown token request error' },
        },
        { status: 500 },
      );
    }

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
    const tlSignature = signPayload(paymentRequestBody, privateKey);
    const idempotencyKey = randomUUID();

    // Stage B: payment link request
    try {
      const paymentRes = await fetch(TRUELAYER_PAYMENTS_URL, {
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

      const rawPaymentBody = await paymentRes.text();
      let parsedPaymentBody: unknown = null;
      try {
        parsedPaymentBody = rawPaymentBody ? JSON.parse(rawPaymentBody) : null;
      } catch {
        parsedPaymentBody = null;
      }

      console.log('[CreatePaymentLink] payment status:', paymentRes.status);
      console.log('[CreatePaymentLink] payment raw response body:', rawPaymentBody);

      if (!paymentRes.ok) {
        return NextResponse.json(
          {
            stage: 'payment_link',
            error: 'Failed to create TrueLayer payment link',
            upstreamStatus: paymentRes.status || null,
            upstreamBody: parsedPaymentBody || rawPaymentBody || null,
          },
          { status: paymentRes.status || 500 },
        );
      }

      const responseData = (parsedPaymentBody || {}) as {
        id?: string;
        authorization_flow?: { actions?: { redirect?: { url?: string } } };
      };
      const paymentId = responseData.id;
      const authUrl = responseData.authorization_flow?.actions?.redirect?.url;

      if (!paymentId || !authUrl) {
        return NextResponse.json(
          {
            stage: 'payment_link',
            error: 'Payment ID or authorization URL missing in TrueLayer response',
            upstreamStatus: paymentRes.status || null,
            upstreamBody: parsedPaymentBody || rawPaymentBody || null,
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
      console.error('[CreatePaymentLink] payment request error:', error);
      return NextResponse.json(
        {
          stage: 'payment_link',
          error: 'Failed to create TrueLayer payment link',
          upstreamStatus: null,
          upstreamBody: { message: (error as { message?: string }).message || 'Unknown payment request error' },
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('❌ Create payment link unexpected error:', error);
    return NextResponse.json(
      {
        error: (error as { message?: string }).message || 'Unexpected create-payment-link error',
      },
      { status: 500 },
    );
  }
}
