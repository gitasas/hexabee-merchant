// TEMPORARY — delete after debugging
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST() {
  const result = await query<{ id: string }>(
    `DELETE FROM merchant_payments
     WHERE id NOT IN (
       'ffe9264d-150f-4b2f-8325-5f57d92b90a4',
       'ba244118-f71a-4423-acc5-3af4be20148f'
     )
     RETURNING id`
  );

  return NextResponse.json({ deleted: result.length });
}
