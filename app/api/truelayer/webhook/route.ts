import { NextResponse } from 'next/server';

/**
 * @deprecated TrueLayer webhook route is no longer part of the active provider-agnostic A2A flow.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      status: 'deprecated',
      message: 'TrueLayer webhook route is deprecated and unused.',
    },
    { status: 410 },
  );
}
