import { NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

type PaymentRow = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  amount: string;
  currency: string;
  reference: string | null;
  status: string;
  created_at: string;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payments = await query<PaymentRow>(
    `SELECT id, provider, provider_payment_id, amount, currency, reference, status, created_at
     FROM merchant_payments
     WHERE merchant_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [session.id]
  );

  const total = payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  return NextResponse.json({ payments, total });
}
