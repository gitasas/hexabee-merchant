import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { query, queryOne } from '@/lib/db';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { merchantSlug, amount, currency, reference, payment_method_type } = body;

    const res = await fetch(`${BACKEND_URL}/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    if (merchantSlug) {
      const merchant = await queryOne<{ id: string }>(
        'SELECT id FROM merchants WHERE slug = $1 AND is_active = true',
        [merchantSlug]
      );
      if (merchant) {
        await query(
          `INSERT INTO merchant_payments (id, merchant_id, provider, provider_payment_id, amount, currency, reference, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'initiated', NOW())`,
          [randomUUID(), merchant.id, payment_method_type ?? 'stripe', data.session_id ?? null, amount ?? null, currency ?? 'EUR', reference ?? null]
        );
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payment creation failed' },
      { status: 500 }
    );
  }
}
