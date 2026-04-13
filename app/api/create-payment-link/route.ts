import { NextResponse } from 'next/server';

/**
 * @deprecated TrueLayer-specific payment link endpoint is no longer used by the live payment flow.
 * Use /api/a2a/create-payment for provider-agnostic A2A behavior.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      status: 'deprecated',
      message: 'This endpoint is deprecated. Use /api/a2a/create-payment.',
    },
    { status: 410 },
  );
}
