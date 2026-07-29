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
  reminders_enabled: boolean | null;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const merchant = await queryOne<MerchantRow>(
    'SELECT id, email, business_name, iban, sort_code, account_number, slug, stripe_account_id, stripe_account_id_live, business_country, business_currency, fee_mode, reminders_enabled FROM merchants WHERE id = $1',
    [session.id]
  );

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = await queryOne<{ filename: string; created_at: string }>(
    'SELECT filename, created_at FROM merchant_templates WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1',
    [session.id]
  );

  return NextResponse.json({ ...merchant, template: template ?? null });
}

// Turn a business name into a URL-safe slug: lowercase, strip diacritics
// (Lithuanian ąčęėįšųūž → aceeisuuz and other Latin marks via NFKD), collapse
// non-alphanumerics to single hyphens, trim, cap at 40 chars.
const SLUG_EXTRAS: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l' };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ßæœøđðþł]/g, ch => SLUG_EXTRAS[ch])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

async function generateUniqueSlug(businessName: string, merchantId: string): Promise<string> {
  const base = slugify(businessName) || `merchant-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await query<{ slug: string }>(
    'SELECT slug FROM merchants WHERE (slug = $1 OR slug LIKE $2) AND id != $3',
    [base, `${base}-%`, merchantId]
  );
  const taken = new Set(rows.map(r => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { businessName, iban, sortCode, accountNumber, slug, businessCountry, businessCurrency, feeMode, remindersEnabled } = await req.json();

  if (feeMode !== undefined && feeMode !== 'merchant' && feeMode !== 'payer') {
    return NextResponse.json({ error: 'Invalid feeMode' }, { status: 400 });
  }

  if (remindersEnabled !== undefined && typeof remindersEnabled !== 'boolean') {
    return NextResponse.json({ error: 'Invalid remindersEnabled' }, { status: 400 });
  }

  if (businessName !== undefined && businessName !== null && typeof businessName !== 'string') {
    return NextResponse.json({ error: 'Invalid businessName' }, { status: 400 });
  }

  if (slug !== undefined && slug !== null && typeof slug !== 'string') {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
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

  // Auto-generate a slug from the business name when the merchant has none yet
  // (onboarding, or setting the name later in Settings). Never overwrites an
  // existing slug — COALESCE below keeps the current value when $5 is null.
  let autoSlug: string | null = null;
  let nameForSlug: string | null = null;
  if (!slug) {
    const current = await queryOne<{ slug: string | null; business_name: string | null }>(
      'SELECT slug, business_name FROM merchants WHERE id = $1',
      [session.id]
    );
    nameForSlug = (typeof businessName === 'string' && businessName.trim() ? businessName : current?.business_name) ?? null;
    if (current && !current.slug && nameForSlug) {
      autoSlug = await generateUniqueSlug(nameForSlug, session.id);
    }
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await query(
        `UPDATE merchants
         SET business_name = COALESCE($1, business_name),
             iban = $2,
             sort_code = $3,
             account_number = $4,
             slug = COALESCE($5, slug),
             business_country = COALESCE($6, business_country),
             business_currency = COALESCE($7, business_currency),
             fee_mode = COALESCE($8, fee_mode),
             reminders_enabled = COALESCE($9, reminders_enabled)
         WHERE id = $10`,
        [
          businessName ?? null,
          iban ?? null,
          sortCode ?? null,
          accountNumber ?? null,
          slug?.toLowerCase() ?? autoSlug,
          businessCountry ?? null,
          businessCurrency ?? null,
          feeMode ?? null,
          remindersEnabled ?? null,
          session.id,
        ]
      );
      break;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Raced on the unique slug index: regenerate for auto slugs, 409 for manual ones.
      if (autoSlug && nameForSlug && attempt < 3) {
        autoSlug = await generateUniqueSlug(nameForSlug, session.id);
        continue;
      }
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 });
    }
  }

  return NextResponse.json({ success: true });
}
