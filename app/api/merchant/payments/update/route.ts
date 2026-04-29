import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { id, status, providerPaymentId } = await req.json();
    if (!id || !status) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    await query(
      `UPDATE merchant_payments
       SET status = $1, provider_payment_id = COALESCE($2, provider_payment_id)
       WHERE id = $3`,
      [status, providerPaymentId ?? null, id]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 });
  }
}
