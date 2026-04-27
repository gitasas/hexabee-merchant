import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

const YAPILY_APP_ID = process.env.YAPILY_APPLICATION_ID ?? '';
const YAPILY_SECRET = process.env.YAPILY_SECRET ?? '';
const YAPILY_BASE = 'https://api.yapily.com';

function yapilyAuth() {
  return 'Basic ' + Buffer.from(`${YAPILY_APP_ID}:${YAPILY_SECRET}`).toString('base64');
}

export async function POST(req: NextRequest) {
  try {
    const { consentToken, amount, currency, reference, iban, payeeName, institutionId, idempotencyId } = await req.json();

    if (!consentToken || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const isSandbox = (institutionId ?? '').endsWith('-sandbox');

    const body = {
      type: 'DOMESTIC_PAYMENT',
      reference: reference ?? 'Invoice payment',
      paymentIdempotencyId: idempotencyId || randomUUID().replace(/-/g, '').slice(0, 35),
      amount: {
        amount: Number(amount),
        currency: isSandbox ? 'GBP' : (currency ?? 'EUR'),
      },
      payee: {
        name: payeeName && payeeName !== '-' ? payeeName : 'Invoice recipient',
        accountIdentifications: isSandbox
          ? [
              { type: 'SORT_CODE', identification: '040004' },
              { type: 'ACCOUNT_NUMBER', identification: '12345678' },
            ]
          : [{ type: 'IBAN', identification: iban }],
      },
    };

    const res = await fetch(`${YAPILY_BASE}/payments`, {
      method: 'POST',
      headers: {
        Authorization: yapilyAuth(),
        'Consent': consentToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      const yapError = data.error ?? data;
      const errorMsg = yapError.message ?? yapError.institutionError?.errorMessage ?? JSON.stringify(yapError);
      console.error('YAPILY_EXECUTE_ERROR', JSON.stringify(data, null, 2));
      return NextResponse.json(
        { error: errorMsg, details: data },
        { status: res.status }
      );
    }

    console.log('YAPILY_EXECUTE_OK', JSON.stringify(data?.data, null, 2));
    return NextResponse.json({
      status: data.data?.status,
      paymentId: data.data?.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payment execution failed' },
      { status: 500 }
    );
  }
}
