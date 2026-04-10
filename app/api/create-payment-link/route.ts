import { createPrivateKey, randomUUID } from 'crypto';
import { CompactSign, importPKCS8 } from 'jose';
import { NextResponse } from 'next/server';

const TRUELAYER_TOKEN_URL = 'https://auth.truelayer-sandbox.com/connect/token';
const TRUELAYER_PAYMENTS_URL = 'https://api.truelayer-sandbox.com/v3/payment-links';
const TRUELAYER_TEST_SIGNATURE_URL = 'https://api.truelayer-sandbox.com/test-signature';
const ADMIN_API_BASE_URL = process.env.ADMIN_API_BASE_URL || '';

type CreatePaymentLinkRequest = {
  amount: string | number;
  currency?: string;
  email?: string;
  name?: string;
  iban?: string;
  reference?: string;
  invoice_id?: string;
  admin_invoice_id?: string;
  selectedBank?: string;
};

const TRUELAYER_TEST_IBAN = 'GB29NWBK60161331926819';

async function postToAdmin(path: string, payload: unknown) {
  if (!ADMIN_API_BASE_URL) {
    console.warn('[CreatePaymentLink] ADMIN_API_BASE_URL not set');
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
      console.error('[CreatePaymentLink] ADMIN_SYNC_ERROR', {
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
    console.error('[CreatePaymentLink] ADMIN_FETCH_FAILED', error);
    return null;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function toMinorAmount(amount: string | number): number {
  const amountText = String(amount).replace(/[^\d.,-]/g, '').replace(',', '.');
  const parsed = Number(amountText);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  return Math.round(parsed * 100);
}

function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return false;
  }

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;

  for (const char of rearranged) {
    const converted = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of converted) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1;
}

function getValidatedPrivateKeyPem(): string {
  const privateKeyPem = requiredEnv('TRUELAYER_PRIVATE_KEY').replace(/\\n/g, '\n');

  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) {
    throw new Error('TRUELAYER_PRIVATE_KEY must be a PKCS#8 private key');
  }

  const key = createPrivateKey(privateKeyPem);
  const jwk = key.export({ format: 'jwk' }) as { kty?: string; crv?: string };

  if (jwk.kty !== 'EC' || jwk.crv !== 'P-521') {
    throw new Error('TRUELAYER_PRIVATE_KEY must be an EC P-521 (secp521r1) key in PKCS#8 format');
  }

  return privateKeyPem;
}

async function buildTlSignature(params: {
  kid: string;
  privateKeyPem: string;
  method: string;
  path: string;
  idempotencyKey: string;
  body: string;
}): Promise<string> {
  const normalizedMethod = params.method.toUpperCase();
  const normalizedPath = params.path.replace(/\/+$/, '') || '/';
  const signingPayload = [
    `${normalizedMethod} ${normalizedPath}`,
    `Idempotency-Key: ${params.idempotencyKey}`,
    params.body,
  ].join('\n');

  const privateKey = await importPKCS8(params.privateKeyPem, 'ES512');
  const jws = await new CompactSign(new TextEncoder().encode(signingPayload))
    .setProtectedHeader({
      alg: 'ES512',
      kid: params.kid,
      tl_version: '2',
      tl_headers: 'Idempotency-Key',
    })
    .sign(privateKey);

  const [protectedHeader, , signature] = jws.split('.');
  return `${protectedHeader}..${signature}`;
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const tokenRequestBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'payments',
  });

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

  if (!tokenRes.ok) {
    throw new Error(
      JSON.stringify({
        stage: 'token',
        error: 'Failed to obtain TrueLayer access token',
        upstreamStatus: tokenRes.status || null,
        upstreamBody: parsedTokenBody || rawTokenBody || null,
      }),
    );
  }

  const accessToken = ((parsedTokenBody as { access_token?: string } | null)?.access_token ?? '').trim();
  if (!accessToken) {
    throw new Error(
      JSON.stringify({
        stage: 'token',
        error: 'Failed to obtain TrueLayer access token',
        upstreamStatus: tokenRes.status || null,
        upstreamBody: parsedTokenBody || rawTokenBody || null,
      }),
    );
  }

  return accessToken;
}

async function optionallyValidateSignature(opts: {
  enabled: boolean;
  accessToken: string;
  kid: string;
  privateKeyPem: string;
}): Promise<void> {
  if (!opts.enabled) {
    return;
  }

  const testBody = JSON.stringify({ nonce: randomUUID() });
  const testIdempotencyKey = randomUUID();
  const testSignature = await buildTlSignature({
    kid: opts.kid,
    privateKeyPem: opts.privateKeyPem,
    method: 'POST',
    path: '/test-signature',
    idempotencyKey: testIdempotencyKey,
    body: testBody,
  });

  const testRes = await fetch(TRUELAYER_TEST_SIGNATURE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
      'Tl-Signature': testSignature,
      'Idempotency-Key': testIdempotencyKey,
    },
    body: testBody,
    cache: 'no-store',
  });

  if (testRes.status !== 204) {
    const upstreamBody = await testRes.text();
    throw new Error(
      JSON.stringify({
        stage: 'test_signature',
        error: 'TrueLayer /test-signature validation failed',
        upstreamStatus: testRes.status || null,
        upstreamBody: upstreamBody || null,
      }),
    );
  }

  console.log('[CreatePaymentLink] /test-signature validation passed with 204 No Content');
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
    const userName = body.name?.trim() || 'Customer';
    const userEmail = body.email?.trim() || 'support@hexabee.local';

    if (!beneficiaryName || !beneficiaryReference) {
      throw new Error('Invalid beneficiary. Missing beneficiary name or reference');
    }

    const beneficiaryAccountIdentifier =
      currency === 'GBP'
        ? {
            type: 'sort_code_account_number' as const,
            sort_code: '601613',
            account_number: '31926819',
          }
        : (() => {
            const incomingIban = body.iban?.trim();
            const envIban = process.env.TRUELAYER_MERCHANT_IBAN?.trim();
            const rawIban = incomingIban || envIban || TRUELAYER_TEST_IBAN;
            const normalizedIban = normalizeIban(rawIban);
            const beneficiaryIban = isValidIban(normalizedIban) ? normalizedIban : TRUELAYER_TEST_IBAN;

            if (beneficiaryIban !== normalizedIban) {
              console.warn('[CreatePaymentLink] Invalid or truncated IBAN detected, using test IBAN fallback');
            }

            return {
              type: 'iban' as const,
              iban: beneficiaryIban,
            };
          })();

    const beneficiary = {
      type: 'external_account',
      account_holder_name: beneficiaryName,
      account_identifier: beneficiaryAccountIdentifier,
      reference: beneficiaryReference,
    };
    console.log('[CreatePaymentLink] Final beneficiary object:', JSON.stringify(beneficiary));

    const clientId = requiredEnv('TRUELAYER_CLIENT_ID');
    const clientSecret = requiredEnv('TRUELAYER_CLIENT_SECRET');
    const kid = requiredEnv('TRUELAYER_KID');
    const privateKeyPem = getValidatedPrivateKeyPem();

    const accessToken = await getAccessToken(clientId, clientSecret);

    await optionallyValidateSignature({
      enabled: process.env.TRUELAYER_VALIDATE_SIGNATURE === 'true',
      accessToken,
      kid,
      privateKeyPem,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://hexabee-merchant.vercel.app';
    const payload = {
      type: 'single_payment',
      payment_configuration: {
        amount_in_minor: amountInMinor,
        currency,
        payment_method: {
          type: 'bank_transfer',
          provider_selection: {
            type: 'user_selected',
          },
          beneficiary: {
            ...beneficiary,
          },
        },
        user: {
          name: userName,
          email: userEmail,
        },
      },
      reference: beneficiaryReference,
      return_uri: `${appUrl}/pay/success`,
    };

    const paymentRequestBody = JSON.stringify(payload);
    console.log('[CreatePaymentLink] Final payment link request body:', paymentRequestBody);
    const idempotencyKey = randomUUID();
    const tlSignature = await buildTlSignature({
      kid,
      privateKeyPem,
      method: 'POST',
      path: '/v3/payment-links',
      idempotencyKey,
      body: paymentRequestBody,
    });

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
    console.log('[CreatePaymentLink] Payment link response status:', paymentRes.status);
    console.log('[CreatePaymentLink] Payment link response body:', rawPaymentBody);
    let parsedPaymentBody: unknown = null;
    try {
      parsedPaymentBody = rawPaymentBody ? JSON.parse(rawPaymentBody) : null;
    } catch {
      parsedPaymentBody = null;
    }

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
      uri?: string;
    };
    const paymentId = responseData.id;
    const paymentLink = responseData.uri;

    if (paymentRes.status !== 201 || !paymentId || !paymentLink) {
      return NextResponse.json(
        {
          stage: 'payment_link',
          error: 'Payment ID or payment link URI missing in TrueLayer response',
          upstreamStatus: paymentRes.status || null,
          upstreamBody: parsedPaymentBody || rawPaymentBody || null,
        },
        { status: 502 },
      );
    }

    const adminInvoiceId = (body as Record<string, unknown>).admin_invoice_id
      || (body as Record<string, unknown>).invoice_id
      || body.reference
      || null;

    if (adminInvoiceId) {
      await postToAdmin('/api/plugin/payments', {
        email: userEmail,
        invoice_id: adminInvoiceId,
        provider: 'truelayer',
        provider_payment_id: paymentId,
        gross_amount: amountInMinor / 100,
        fee_amount: 0,
        net_amount: amountInMinor / 100,
        currency,
        status: 'created',
        payment_url: paymentLink,
      });

      await postToAdmin('/api/plugin/events', {
        email: userEmail,
        event_type: 'payment_created',
        event_data: {
          provider: 'truelayer',
          truelayer_payment_id: paymentId,
          payment_link: paymentLink,
          reference: beneficiaryReference,
          amount_in_minor: amountInMinor,
          currency,
        },
      });
    } else {
      console.warn('[CreatePaymentLink] Missing invoice id, skipping backend sync');
    }

    return NextResponse.json({
      paymentId,
      payment_link: paymentLink,
    });
  } catch (error) {
    const message = (error as { message?: string }).message || 'Unexpected create-payment-link error';
    try {
      const parsed = JSON.parse(message) as {
        stage?: string;
        error?: string;
        upstreamStatus?: number;
        upstreamBody?: unknown;
      };
      if (parsed?.stage && parsed?.error) {
        return NextResponse.json(parsed, { status: parsed.upstreamStatus || 500 });
      }
    } catch {
      // no-op: use default error response below
    }

    console.error('❌ Create payment link unexpected error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
