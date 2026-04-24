import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const providerPaymentId = searchParams.get('providerPaymentId');

  if (!providerPaymentId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'providerPaymentId is required.',
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    providerPaymentId,
    status: 'executed',
  });
}
