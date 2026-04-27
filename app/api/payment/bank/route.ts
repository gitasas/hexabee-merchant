import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

const YAPILY_APP_ID = process.env.YAPILY_APPLICATION_ID ?? '';
const YAPILY_SECRET = process.env.YAPILY_SECRET ?? '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const YAPILY_BASE = 'https://api.yapily.com';

function yapilyAuth() {
  return 'Basic ' + Buffer.from(`${YAPILY_APP_ID}:${YAPILY_SECRET}`).toString('base64');
}

export async function POST(req: NextRequest) {
  try {
    const { amount, currency, reference, iban, payeeName, institutionId, email, adminInvoiceId } =
      await req.json();

    if (!amount || !institutionId || !iban) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const idempotencyId = randomUUID().replace(/-/g, '').slice(0, 35);
    // UK Open Banking doesn't allow slashes in reference
    const safeReference = (reference ?? 'Invoice payment').replace(/[^a-zA-Z0-9 \-]/g, '-').slice(0, 35);

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
    });

    const callbackUrl = `${APP_URL}/payment-bank-callback?${callbackParams.toString()}`;

    const body = {
      applicationUserId: email ?? 'hexabee-user',
      institutionId,
      callback: callbackUrl,
      paymentRequest: {
        type: 'DOMESTIC_PAYMENT',
        reference: safeReference,
        paymentIdempotencyId: idempotencyId,
        amount: {
          amount: Number(amount),
          currency: institutionId.endsWith('-sandbox') ? 'GBP' : (currency ?? 'EUR'),
        },
        payee: {
          name: payeeName && payeeName !== '-' ? payeeName : 'Invoice recipient',
          // Sandbox UK institutions require sort code + account number instead of IBAN
          accountIdentifications: institutionId.endsWith('-sandbox')
            ? [
                { type: 'SORT_CODE', identification: '040004' },
                { type: 'ACCOUNT_NUMBER', identification: '12345678' },
              ]
            : [{ type: 'IBAN', identification: iban }],
        },
      },
    };

    const res = await fetch(`${YAPILY_BASE}/payment-auth-requests`, {
      method: 'POST',
      headers: {
        Authorization: yapilyAuth(),
        'Content-Type': 'application/json',
      },
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
