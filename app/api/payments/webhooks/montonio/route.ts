import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt, jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

// Montonio sends no shared header — the JWT signature is the only thing
// authenticating this endpoint, so verification is not optional. Which secret
// verifies it depends on the store the token names; see resolveSecret below.
//
// It lives here rather than in the Node backend so that the ledger update sits
// next to the Stripe one. Two places writing merchant_invoices would diverge
// silently: an invoice would simply stop being marked paid, with nothing in the
// logs to say why.

export const runtime = 'nodejs';

type OrderTokenClaims = {
  uuid?: string;
  accessKey?: string;
  merchantReference?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  grandTotal?: number;
  currency?: string;
  paymentProviderName?: string;
};

// Montonio delivers the token as a query parameter (`?order-token=…`) with an
// empty POST body — not as `{ orderToken }` in JSON, which is what the docs
// example shows. Verified against a real sandbox delivery: User-Agent
// MontonioWebhooks/1.0, no body at all. Read both, and never let an empty or
// non-JSON body throw; a webhook that 500s is a payment that stays 'initiated'.
async function extractOrderToken(request: NextRequest): Promise<string | undefined> {
  const fromQuery =
    request.nextUrl.searchParams.get('order-token') ??
    request.nextUrl.searchParams.get('orderToken');
  if (fromQuery) return fromQuery;

  try {
    const text = await request.text();
    if (!text) return undefined;
    const body = JSON.parse(text);
    return body?.orderToken ?? body?.['order-token'];
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  // Montonio's return_url lands the payer here in some flows; treat it as the
  // same notification rather than a health check.
  const token =
    request.nextUrl.searchParams.get('order-token') ??
    request.nextUrl.searchParams.get('orderToken');
  if (!token) return NextResponse.json({ ok: true, service: 'montonio-webhook' });
  return handleOrderToken(token);
}

export async function POST(request: NextRequest) {
  const orderToken = await extractOrderToken(request);

  if (!orderToken) {
    console.warn('[Montonio webhook] no order token in query or body');
    return NextResponse.json({ error: 'Missing orderToken' }, { status: 400 });
  }

  return handleOrderToken(orderToken);
}

/**
 * Which secret verifies this token.
 *
 * Every merchant has their own Montonio store, so there is no single secret to
 * check against. The only thing naming the store is `accessKey` inside the token
 * — which cannot be trusted until the signature is verified, and the signature
 * cannot be verified until we know which secret to use. The way out is to read
 * the claim unverified, use it purely to *look up* a candidate secret, and let
 * the signature check be the thing that actually decides. An attacker choosing
 * their own accessKey only selects which secret they then fail to forge against.
 *
 * The env keys remain as a fallback for HexaBee's own sandbox store, which is
 * what the integration was built and tested against.
 */
async function resolveSecret(orderToken: string): Promise<string | null> {
  let accessKey: string | undefined;
  try {
    accessKey = (decodeJwt(orderToken) as OrderTokenClaims).accessKey;
  } catch {
    return null;
  }
  if (!accessKey) return null;

  if (process.env.MONTONIO_ACCESS_KEY && accessKey === process.env.MONTONIO_ACCESS_KEY) {
    return process.env.MONTONIO_SECRET_KEY ?? null;
  }

  try {
    const merchant = await queryOne<{ montonio_secret_key: string | null }>(
      'SELECT montonio_secret_key FROM merchants WHERE montonio_access_key = $1 AND is_active = true',
      [accessKey]
    );
    return merchant?.montonio_secret_key ?? null;
  } catch (err) {
    // The column may not exist yet in an environment that has not deployed the
    // backend migration; that is a misconfiguration, not a forged token.
    console.error('[Montonio webhook] merchant lookup failed', String(err));
    return null;
  }
}

/**
 * Tell cooperative-luck a payment link has been used once more.
 *
 * The Stripe rail does this from the Node backend, off `checkout.session
 * .completed` metadata. Nothing did it for Montonio, so a merchant who watched
 * a real payment come in still saw "0 uses" on the link, and a link with a
 * `max_uses` limit would never have expired.
 *
 * Best-effort by design: a counter that failed to move must not turn a settled
 * payment into a webhook Montonio keeps retrying.
 */
async function countPaymentLinkUse(shortId: string): Promise<void> {
  const base = (process.env.ADMIN_API_BASE_URL || '').replace(/\/$/, '');
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    console.warn('[Montonio webhook] cannot count link use — backend not configured');
    return;
  }
  try {
    const res = await fetch(
      `${base}/api/plugin/payment-links/${encodeURIComponent(shortId)}/increment`,
      { method: 'POST', headers: { 'X-Internal-Token': token } }
    );
    console.log('[Montonio webhook] payment link use counted', { shortId, ok: res.ok });
  } catch (err) {
    console.error('[Montonio webhook] payment link increment failed', String(err));
  }
}

async function handleOrderToken(orderToken: string) {
  const secret = await resolveSecret(orderToken);
  if (!secret) {
    console.warn('[Montonio webhook] no secret for this store — token not verifiable');
    return NextResponse.json({ error: 'Unknown store' }, { status: 401 });
  }

  let claims: OrderTokenClaims;
  try {
    const verified = await jwtVerify(orderToken, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    claims = verified.payload as OrderTokenClaims;
  } catch (err) {
    console.warn('[Montonio webhook] token rejected', String(err));
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  console.log('[Montonio webhook]', {
    uuid: claims.uuid,
    merchantReference: claims.merchantReference,
    paymentStatus: claims.paymentStatus,
    paymentMethod: claims.paymentMethod,
    grandTotal: claims.grandTotal,
    currency: claims.currency,
    provider: claims.paymentProviderName,
  });

  // merchant_payments.id is a uuid column, so a reference of any other shape
  // makes Postgres throw — which would 500 and have Montonio retry a token that
  // can never succeed. Anything not ours is acknowledged and dropped instead.
  const ref = claims.merchantReference ?? '';
  const isOurReference = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);

  if (claims.paymentStatus === 'PAID' && !isOurReference) {
    console.warn('[Montonio webhook] reference is not a HexaBee payment id', ref);
  }

  if (claims.paymentStatus === 'PAID' && isOurReference) {
    // merchantReference is merchant_payments.id — we generated it when creating
    // the order, which is why this matches on the primary key rather than on
    // provider_payment_id as the Stripe handler does.
    //
    // `status <> 'paid'` makes the flip itself the idempotency guard: Montonio
    // redelivers the same token until it expires, and the payment-link counter
    // below must move exactly once per payment, not once per delivery.
    type PaidRow = { merchant_id: string; reference: string | null; payment_link_short_id: string | null };
    const updated = await query<PaidRow>(
      `UPDATE merchant_payments SET status = 'paid'
       WHERE id = $1 AND status <> 'paid'
       RETURNING merchant_id, reference, payment_link_short_id`,
      [ref]
    );

    const firstTime = updated.length > 0;
    // A redelivery still has to reach the ledger match below: if that failed the
    // first time round, the retry is the only thing that fixes it.
    const row: PaidRow | null = firstTime
      ? updated[0]
      : await queryOne<PaidRow>(
          'SELECT merchant_id, reference, payment_link_short_id FROM merchant_payments WHERE id = $1',
          [ref]
        );

    if (!row) {
      // Not an error worth failing the webhook over: a missing row means the
      // order was created outside this app (a probe, or another environment
      // sharing the sandbox store).
      console.warn('[Montonio webhook] no payment row for', ref);
    }

    if (firstTime && row?.payment_link_short_id) {
      await countPaymentLinkUse(row.payment_link_short_id);
    }

    // Same best-effort ledger match as the Stripe handler, including the
    // 'issued' guard so a re-delivered webhook cannot re-pay a closed invoice.
    try {
      const merchantId = row?.merchant_id ?? null;
      const reference = (row?.reference ?? '').trim();
      if (merchantId && reference) {
        // Case-insensitive on purpose: the pay page's invoice-lookup matches
        // LOWER = LOWER, so a payer who types the reference in another case
        // still sees the invoice and pays it. An exact match here would leave
        // that invoice 'issued' and keep dunning someone who has already paid.
        await query(
          `UPDATE merchant_invoices SET status = 'paid', paid_at = NOW()
           WHERE merchant_id = $1 AND status = 'issued'
             AND LOWER(invoice_number) = LOWER($2)`,
          [merchantId, reference]
        );
      }
    } catch (err) {
      console.error('[Montonio webhook] invoice-ledger match failed', String(err));
    }
  }

  return NextResponse.json({ received: true });
}
