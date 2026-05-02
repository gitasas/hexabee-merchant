import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Bank payment provider not configured', code: 'BANK_PROVIDER_UNAVAILABLE' },
    { status: 503 }
  );
}
