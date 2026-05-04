// TEMPORARY — delete after debugging
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await query(
    'SELECT id, provider, amount, currency, status, created_at FROM merchant_payments ORDER BY created_at DESC'
  );

  return NextResponse.json({ count: rows.length, rows });
}
