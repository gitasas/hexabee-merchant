import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';

// Montonio sends no shared header — the JWT signature is the only thing
// authenticating this endpoint. Verification is therefore not optional, and
// accessKey is checked so a token signed for a different store is rejected.
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

export async function GET() {
  return NextResponse.json({ ok: true, service: 'montonio-webhook' });
}

export async function POST(request: NextRequest) {
  let orderToken: string | undefined;
  try {
    const body = await request.json();
    orderToken = body?.orderToken;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!orderToken) {
    console.warn('[Montonio webhook] no orderToken in body');
    return NextResponse.json({ error: 'Missing orderToken' }, { status: 400 });
  }

  const secret = process.env.MONTONIO_SECRET_KEY;
  if (!secret) {
    console.error('[Montonio webhook] MONTONIO_SECRET_KEY is not set');
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
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

  const expectedAccessKey = process.env.MONTONIO_ACCESS_KEY;
  if (expectedAccessKey && claims.accessKey !== expectedAccessKey) {
    console.warn('[Montonio webhook] token signed for another store', claims.accessKey);
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

  if (claims.paymentStatus === 'PAID' && claims.merchantReference) {
    // merchantReference is merchant_payments.id — we generated it when creating
    // the order, which is why this matches on the primary key rather than on
    // provider_payment_id as the Stripe handler does.
    const updated = await query<{ merchant_id: string; reference: string | null }>(
      'UPDATE merchant_payments SET status = $1 WHERE id = $2 RETURNING merchant_id, reference',
      ['paid', claims.merchantReference]
    );

    if (updated.length === 0) {
      // Not an error worth failing the webhook over: Montonio retries, and a
      // missing row means the order was created outside this app (a probe, or
      // another environment sharing the sandbox store).
      console.warn('[Montonio webhook] no payment row for', claims.merchantReference);
    }

    // Same best-effort ledger match as the Stripe handler, including the
    // 'issued' guard so a re-delivered webhook cannot re-pay a closed invoice.
    try {
      const merchantId = updated[0]?.merchant_id ?? null;
      const reference = (updated[0]?.reference ?? '').trim();
      if (merchantId && reference) {
        await query(
          `UPDATE merchant_invoices SET status = 'paid', paid_at = NOW()
           WHERE merchant_id = $1 AND status = 'issued' AND invoice_number = $2`,
          [merchantId, reference]
        );
      }
    } catch (err) {
      console.error('[Montonio webhook] invoice-ledger match failed', String(err));
    }
  }

  return NextResponse.json({ received: true });
}
