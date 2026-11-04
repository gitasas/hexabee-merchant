import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Download every issued invoice as one ZIP.
 *
 * ⚠️ **This exists because Centas cannot take the document.**
 * `/documents/create` accepts the figures and carries **no PDF field at all** -
 * the only `pdf_base64` in their specification is on `/purchase/import`, which
 * is company-to-company exchange and needs the receiver to be a Centas user. A
 * school's parents are not. So the bookkeeper gets the documents this way.
 *
 * The backend reports which invoices it could not include, and the manifest
 * inside the ZIP names them. That matters more than the files: a bookkeeper
 * handed 44 documents when 46 were issued, with nothing saying so, reconciles
 * the difference as a mistake of her own.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const base = process.env.ADMIN_API_BASE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const batch = req.nextUrl.searchParams.get('batch');
  const url = new URL(`${base.replace(/\/$/, '')}/api/plugin/merchant-invoices/export-pdfs`);
  url.searchParams.set('merchant_id', session.id);
  if (batch) url.searchParams.set('batch', batch);

  try {
    const res = await fetch(url, {
      headers: { 'X-Internal-Token': token },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The backend's own English never reaches the portal - the status is
      // what the caller maps to a dictionary key. See CLAUDE.md.
      console.error('[export-pdfs] backend refused', res.status, data);
      return NextResponse.json({ error: 'upstream' }, { status: res.status === 404 ? 404 : 502 });
    }

    const zip = Buffer.from(String(data.zip_base64 || ''), 'base64');
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${String(data.filename || 'saskaitos.zip').replace(/"/g, '')}"`,
        // So the page can say "44 of 46" without opening the archive.
        'X-Invoice-Total': String(data.total ?? ''),
        'X-Invoice-Included': String(data.included ?? ''),
        'X-Invoice-Missing': String(data.missing ?? ''),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[export-pdfs] backend unreachable', String(err));
    return NextResponse.json({ error: 'upstream' }, { status: 502 });
  }
}
