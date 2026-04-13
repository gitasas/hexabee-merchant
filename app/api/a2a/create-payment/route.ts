import { NextResponse } from 'next/server';
import { createA2APayment } from '@/lib/a2a/provider';
import { A2ACreatePaymentRequest } from '@/lib/a2a/types';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as A2ACreatePaymentRequest;
    const result = await createA2APayment(payload);

    return NextResponse.json(result, {
      status: result.ok ? 200 : 200,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        provider: 'none',
        status: 'not_configured',
        message: 'Bank payment option is being configured.',
      },
      { status: 200 },
    );
  }
}
