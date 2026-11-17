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
//
// `sentByAccounting` (2026-11-17, `merchants.invoices_sent_by_accounting`):
// the merchant's own answer to "does your accounting program email the
// invoices itself?". When TRUE, invoices imported from Rivilė that carry an
// address arrive as already delivered, so nobody can send the payer a second
// copy from HexaBee. NULL is "not answered" and behaves as "HexaBee sends".
// Each field is written only when the request carries it, so saving one can
// never reset the other.

type Row = { accounting_system: string | null; invoices_sent_by_accounting?: boolean | null };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let row: Row | null = null;
  let sentReady = true;
  try {
    row = await queryOne<Row>(
      'SELECT accounting_system, invoices_sent_by_accounting FROM merchants WHERE id = $1', [session.id]);
  } catch (err) {
    if (!/invoices_sent_by_accounting/.test(String(err))) {
      // Column arrives by backend migration; until then nothing is chosen.
      if (!/accounting_system/.test(String(err))) throw err;
      return NextResponse.json({ system: null, sentByAccounting: null, notReady: true });
    }
    sentReady = false;
    row = await queryOne<Row>('SELECT accounting_system FROM merchants WHERE id = $1', [session.id]);
  }
  const v = row?.accounting_system ?? null;
  return NextResponse.json({
    system: (ACCOUNTING_SYSTEMS as readonly string[]).includes(v ?? '') ? v : null,
    sentByAccounting: sentReady ? (row?.invoices_sent_by_accounting ?? null) : null,
    sentReady,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 });

  if ('system' in payload) {
    const system = payload.system as AccountingSystem | null;
    if (system !== null && !(ACCOUNTING_SYSTEMS as readonly string[]).includes(system)) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 });
    }
    try {
      await query('UPDATE merchants SET accounting_system = $1 WHERE id = $2', [system, session.id]);
    } catch (err) {
      if (!/accounting_system/.test(String(err))) throw err;
      return NextResponse.json({ error: 'not_ready' }, { status: 503 });
    }
  }

  if ('sentByAccounting' in payload) {
    const sent = payload.sentByAccounting;
    if (sent !== true && sent !== false) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    try {
      await query('UPDATE merchants SET invoices_sent_by_accounting = $1 WHERE id = $2', [sent, session.id]);
    } catch (err) {
      if (!/invoices_sent_by_accounting/.test(String(err))) throw err;
      return NextResponse.json({ error: 'not_ready' }, { status: 503 });
    }
  }

  return NextResponse.json({ ok: true });
}
