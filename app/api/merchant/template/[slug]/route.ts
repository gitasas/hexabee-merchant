import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const row = await queryOne<{ patterns: unknown }>(
    `SELECT mt.patterns
     FROM merchant_templates mt
     JOIN merchants m ON m.id = mt.merchant_id
     WHERE m.slug = $1 AND m.is_active = true
     ORDER BY mt.created_at DESC
     LIMIT 1`,
    [slug.toLowerCase()]
  );

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(row.patterns);
}
