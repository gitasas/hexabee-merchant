import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

type MerchantRow = {
  id: string;
  email: string;
  business_name: string | null;
  iban: string | null;
  sort_code: string | null;
  account_number: string | null;
  slug: string | null;
  stripe_account_id: string | null;
  stripe_account_id_live: string | null;
  business_country: string | null;
  business_currency: string | null;
  fee_mode: string | null;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const merchant = await queryOne<MerchantRow>(
    'SELECT id, email, business_name, iban, sort_code, account_number, slug, stripe_account_id, stripe_account_id_live, business_country, business_currency, fee_mode FROM merchants WHERE id = $1',
    [session.id]
  );

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = await queryOne<{ filename: string; created_at: string }>(
    'SELECT filename, created_at FROM merchant_templates WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1',
    [session.id]
  );

  return NextResponse.json({ ...merchant, template: template ?? null });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { businessName, iban, sortCode, accountNumber, slug, businessCountry, businessCurrency, feeMode } = await req.json();

  if (feeMode !== undefined && feeMode !== 'merchant' && feeMode !== 'payer') {
    return NextResponse.json({ error: 'Invalid feeMode' }, { status: 400 });
  }

  if (slug) {
    const existing = await queryOne(
      'SELECT id FROM merchants WHERE slug = $1 AND id != $2',
      [slug.toLowerCase(), session.id]
    );
    if (existing) {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 });
    }
  }

  await query(
    `UPDATE merchants
     SET business_name = COALESCE($1, business_name),
         iban = $2,
         sort_code = $3,
         account_number = $4,
         slug = COALESCE($5, slug),
         business_country = COALESCE($6, business_country),
         business_currency = COALESCE($7, business_currency),
         fee_mode = COALESCE($8, fee_mode)
     WHERE id = $9`,
    [
      businessName ?? null,
      iban ?? null,
      sortCode ?? null,
      accountNumber ?? null,
      slug?.toLowerCase() ?? null,
      businessCountry ?? null,
      businessCurrency ?? null,
      feeMode ?? null,
      session.id,
    ]
  );

  return NextResponse.json({ success: true });
}
