import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { queryOne } from '@/lib/db';

// The invoice document itself, for the merchant who sent it.
//
// Asked for by Baltijos licėjus on 2026-10-14: when a parent rings about an
// invoice, their administrator has to find that one file in a separate folder.
// The row is already on the screen; the document should be one click from it.
//
// It only ever returns something for a merchant who switched `keep_invoice_pdf`
// on, because for everyone else the bytes are dropped the moment the invoice is
// sent. That is deliberate and it is a promise we have made in writing to
// another merchant - so this route reads the stored bytes and never tries to
// fetch the document back from anywhere else.

type Row = {
  invoice_number: string | null;
  pdf_filename: string | null;
  pdf_bytes: Buffer | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let row: Row | null = null;
  try {
    // Scoped by merchant_id, like every other /api/merchant route: the id is a
    // uuid, but guessing is not the only way an id travels between accounts.
    row = await queryOne<Row>(
      `SELECT invoice_number, pdf_filename, pdf_bytes
         FROM merchant_invoices
        WHERE id = $1 AND merchant_id = $2`,
      [id, session.id]
    );
  } catch (err) {
    if (!/pdf_bytes|pdf_filename/.test(String(err))) throw err;
    console.warn('[merchant/invoices/pdf] columns missing - backend deploy pending');
    return NextResponse.json({ error: 'not_ready' }, { status: 503 });
  }

  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Told apart on purpose. "We never had it" and "it is no longer kept" lead
  // the merchant to different places - the first to the setting, the second to
  // their own folder - and one generic 404 would send them hunting in the
  // wrong one.
  if (!row.pdf_bytes || row.pdf_bytes.length === 0) {
    return NextResponse.json({ error: 'no_pdf_stored' }, { status: 404 });
  }

  const name = (row.pdf_filename || `${row.invoice_number || 'saskaita'}.pdf`)
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 120);

  const body = new Uint8Array(row.pdf_bytes);
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/pdf',
      // inline so it opens in a tab rather than landing in Downloads - the
      // merchant is answering a question on the phone, not filing anything.
      'Content-Disposition': `inline; filename="${name}"`,
      'Content-Length': String(body.byteLength),
      // It is a customer's invoice. Nothing between here and the browser has
      // any business keeping a copy.
      'Cache-Control': 'private, no-store',
    },
  });
}
