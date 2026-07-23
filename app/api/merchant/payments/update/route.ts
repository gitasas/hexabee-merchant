import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id, status, providerPaymentId } = await req.json();
    if (!id || !status) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const rows = await query<{ id: string }>(
      `UPDATE merchant_payments
       SET status = $1, provider_payment_id = COALESCE($2, provider_payment_id)
       WHERE id = $3 AND merchant_id = $4
       RETURNING id`,
      [status, providerPaymentId ?? null, id, session.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('PAYMENT_UPDATE_ERROR', err);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
