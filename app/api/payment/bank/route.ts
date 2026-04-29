import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { query, queryOne } from '@/lib/db';

const YAPILY_APP_ID = process.env.YAPILY_APPLICATION_ID ?? '';
const YAPILY_SECRET = process.env.YAPILY_SECRET ?? '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const YAPILY_BASE = 'https://api.yapily.com';

function yapilyAuth() {
  return 'Basic ' + Buffer.from(`${YAPILY_APP_ID}:${YAPILY_SECRET}`).toString('base64');
}

export async function POST(req: NextRequest) {
  try {
    const { amount, currency, reference, iban, payeeName, institutionId, email, adminInvoiceId, merchantSlug } =
      await req.json();

    if (!amount || !institutionId || !iban) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const idempotencyId = randomUUID().replace(/-/g, '').slice(0, 35);
    const safeReference = (reference ?? 'Invoice payment').replace(/[^a-zA-Z0-9 \-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 35);

    // Create merchant_payment record if coming from merchant slug
    let merchantPaymentId: string | null = null;
    if (merchantSlug) {
      const merchant = await queryOne<{ id: string }>(
        'SELECT id FROM merchants WHERE slug = $1 AND is_active = true',
        [merchantSlug]
      );
      if (merchant) {
        merchantPaymentId = randomUUID();
        await query(
          `INSERT INTO merchant_payments (id, merchant_id, provider, amount, currency, reference, status, created_at)
           VALUES ($1, $2, 'bank', $3, $4, $5, 'initiated', NOW())`,
          [merchantPaymentId, merchant.id, amount ?? null, currency ?? 'EUR', safeReference]
        );
      }
    }

    const callbackParams = new URLSearchParams({
      amount: String(amount),
      currency: currency ?? 'EUR',
      reference: safeReference,
      iban,
      payeeName: payeeName ?? '',
      email: email ?? '',
      adminInvoiceId: adminInvoiceId ?? '',
      institutionId,
      idempotencyId,
      ...(merchantPaymentId ? { merchantPaymentId } : {}),
    });

    const callbackUrl = `${APP_URL}/payment-bank-callback?${callbackParams.toString()}`;

    const isUkSandbox = institutionId === 'modelo-sandbox';
    const paymentCurrency = isUkSandbox ? 'GBP' : (currency ?? 'EUR');
    const accountIdentifications = isUkSandbox
      ? [
          { type: 'SORT_CODE', identification: '040004' },
          { type: 'ACCOUNT_NUMBER', identification: '12345678' },
        ]
      : [{ type: 'IBAN', identification: iban }];

    const body = {
      applicationUserId: institutionId === 'deutsche-bank' ? '6154033403' : (email ?? 'hexabee-user'),
      institutionId,
      callback: callbackUrl,
      paymentRequest: {
        type: 'DOMESTIC_PAYMENT',
        reference: safeReference,
        paymentIdempotencyId: idempotencyId,
        amount: {
          amount: Number(amount),
          currency: paymentCurrency,
        },
        payee: {
          name: payeeName && payeeName !== '-' ? payeeName : 'Invoice recipient',
          accountIdentifications,
        },
      },
    };

    const res = await fetch(`${YAPILY_BASE}/payment-auth-requests`, {
      method: 'POST',
      headers: { Authorization: yapilyAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message ?? 'Yapily request failed', details: data },
        { status: res.status }
      );
    }

    return NextResponse.json({
      authorisationUrl: data.data?.authorisationUrl,
      paymentRequestId: data.data?.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Bank payment initiation failed' },
      { status: 500 }
    );
  }
}
