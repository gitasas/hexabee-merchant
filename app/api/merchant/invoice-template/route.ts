import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

// The covering letter a merchant sends with an invoice.
//
// A route of its own rather than two more fields on /api/merchant/profile: that
// PUT already carries seventeen parameters and decides the payment rail, the
// slug and the fee mode along the way. Adding the letter there would mean every
// save of a text box re-evaluates all of it.
//
// Both columns arrive by backend migration, so a missing column is answered as
// "no template yet" rather than a 500 - this app can deploy before the backend.

type Row = {
  invoice_email_subject: string | null;
  invoice_email_body: string | null;
  attach_invoice_pdf: boolean | null;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const row = await queryOne<Row>(
      'SELECT invoice_email_subject, invoice_email_body, attach_invoice_pdf FROM merchants WHERE id = $1',
      [session.id]
    );
    return NextResponse.json({
      subject: row?.invoice_email_subject ?? null,
      body: row?.invoice_email_body ?? null,
      // Absent means the column is not there yet. True either way: attaching
      // the invoice is what the merchant does today, so it is what we do until
      // they say otherwise.
      attachPdf: row?.attach_invoice_pdf ?? true,
    });
  } catch (err) {
    if (!/invoice_email_(subject|body)|attach_invoice_pdf/.test(String(err))) throw err;
    console.warn('[merchant/invoice-template] columns missing - backend deploy pending');
    return NextResponse.json({ subject: null, body: null, attachPdf: true });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let subject: string | null = null;
  let body: string | null = null;
  let attachPdf: boolean | null = null;
  try {
    const payload = await req.json();
    subject = typeof payload?.subject === 'string' ? payload.subject.trim() : null;
    body = typeof payload?.body === 'string' ? payload.body.trim() : null;
    attachPdf = typeof payload?.attachPdf === 'boolean' ? payload.attachPdf : null;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (subject !== null && subject.length > 300) {
    return NextResponse.json({ error: 'subject_too_long' }, { status: 400 });
  }
  if (body !== null && body.length > 20000) {
    return NextResponse.json({ error: 'body_too_long' }, { status: 400 });
  }

  // An empty box means "go back to the default", not "send an empty letter", so
  // it is stored as NULL and the built-in template takes over again.
  try {
    await query(
      `UPDATE merchants
          SET invoice_email_subject = $1,
              invoice_email_body = $2,
              -- COALESCE, like every other merchant field: a save that does not
              -- mention the toggle must not reset it.
              attach_invoice_pdf = COALESCE($4, attach_invoice_pdf)
        WHERE id = $3`,
      [subject || null, body || null, session.id, attachPdf]
    );
  } catch (err) {
    if (!/invoice_email_(subject|body)|attach_invoice_pdf/.test(String(err))) throw err;
    return NextResponse.json({ error: 'not_ready' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, subject: subject || null, body: body || null, attachPdf });
}
