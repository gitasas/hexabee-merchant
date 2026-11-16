import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';
import { ACCOUNTING_SYSTEMS, type AccountingSystem } from '@/lib/accounting-system';

// Which accounting program the merchant keeps their books in (2026-11-16).
// It decides two things: whether Settings offers a key (only Centas and
// Rivilė have an API we read), and what the Invoices page's accounting export
// writes for the bookkeeper to import.
//
// Staff may set it: at both schools somebody other than the owner does the
// invoicing and knows the program. The keys themselves stay owner-only.
//
// NULL means nobody has answered, never "other" - the same trap as
// business_country DEFAULT 'GB'.

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const row = await queryOne<{ accounting_system: string | null }>(
      'SELECT accounting_system FROM merchants WHERE id = $1', [session.id]);
    const v = row?.accounting_system ?? null;
    return NextResponse.json({ system: (ACCOUNTING_SYSTEMS as readonly string[]).includes(v ?? '') ? v : null });
  } catch (err) {
    // Column arrives by backend migration; until then nothing is chosen.
    if (!/accounting_system/.test(String(err))) throw err;
    return NextResponse.json({ system: null, notReady: true });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await req.json().catch(() => null);
  const system = payload?.system as AccountingSystem | null;
  if (system !== null && !(ACCOUNTING_SYSTEMS as readonly string[]).includes(system)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  try {
    await query('UPDATE merchants SET accounting_system = $1 WHERE id = $2', [system, session.id]);
  } catch (err) {
    if (!/accounting_system/.test(String(err))) throw err;
    return NextResponse.json({ error: 'not_ready' }, { status: 503 });
  }
  return NextResponse.json({ system });
}
