// TEMPORARY — delete after debugging
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const isLive = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ?? false;
  const keyPrefix = process.env.STRIPE_SECRET_KEY?.slice(0, 12) ?? 'not set';

  const merchant = await queryOne<{
    id: string;
    slug: string;
    stripe_account_id: string | null;
    stripe_account_id_live: string | null;
  }>(
    "SELECT id, slug, stripe_account_id, stripe_account_id_live FROM merchants WHERE slug = 'hexabee'"
  );

  return NextResponse.json({
    isLive,
    keyPrefix,
    merchant: merchant ?? null,
  });
}
