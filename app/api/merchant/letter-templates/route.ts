import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

// Saved covering letters the merchant picks from on the Invoices page
// (2026-11-12). A school sends its monthly invoices and its extra-services
// invoices from the same account with different words, and rewriting the
// letter in Settings before every batch was the complaint.
//
// A template is only a source to copy from: the letter that actually goes out
// is still `invoice_email_subject/body`, which the sender reads. So nothing on
// the sending side changes, and a deleted template cannot break a send.
//
// Staff may edit these - the letter has always been staff-editable. The list
// is replaced whole on PUT; it is short and edited by one screen.

export type LetterTemplate = { id: string; name: string; subject: string; body: string };

const MAX_TEMPLATES = 20;

function clean(raw: unknown): LetterTemplate[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_TEMPLATES) return null;
  const out: LetterTemplate[] = [];
  for (const it of raw) {
    const t = it as Partial<LetterTemplate>;
    const name = typeof t?.name === 'string' ? t.name.trim() : '';
    const id = typeof t?.id === 'string' ? t.id.trim() : '';
    const subject = typeof t?.subject === 'string' ? t.subject.trim() : '';
    const body = typeof t?.body === 'string' ? t.body.trim() : '';
    if (!id || !name || name.length > 80 || id.length > 64 || subject.length > 300 || body.length > 20000) return null;
    out.push({ id, name, subject, body });
  }
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const row = await queryOne<{ invoice_letter_templates: unknown }>(
      'SELECT invoice_letter_templates FROM merchants WHERE id = $1', [session.id]);
    return NextResponse.json({ templates: clean(row?.invoice_letter_templates) ?? [] });
  } catch (err) {
    // Column arrives by backend migration; until then there are simply none.
    if (!/invoice_letter_templates/.test(String(err))) throw err;
    return NextResponse.json({ templates: [], notReady: true });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await req.json().catch(() => null);
  const templates = clean(payload?.templates);
  if (!templates) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  try {
    await query('UPDATE merchants SET invoice_letter_templates = $1::jsonb WHERE id = $2',
      [JSON.stringify(templates), session.id]);
  } catch (err) {
    if (!/invoice_letter_templates/.test(String(err))) throw err;
    return NextResponse.json({ error: 'not_ready' }, { status: 503 });
  }
  return NextResponse.json({ ok: true, templates });
}
