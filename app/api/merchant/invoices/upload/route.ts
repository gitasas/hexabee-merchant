import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * One invoice from a batch the merchant is uploading in the portal.
 *
 * One file per request on purpose. Every PDF goes through the scanner and, for
 * the ones whose text is unusable, through the model as an image - sixty of
 * those in a single request would pass any serverless time limit long before
 * it finished, and the merchant would be left with a spinner and no idea which
 * invoices made it. The browser sends them one at a time and shows each result
 * as it lands.
 *
 * The work itself belongs to the Python backend: it runs the same scanner and
 * the same field interpretation as the BCC path, so an invoice arriving by
 * either route becomes the same row. This route only proves who is asking.
 */
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !internalToken) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, filename: file.name, reason: 'too_large' },
      { status: 200 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-invoices/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
      body: JSON.stringify({
        merchant_id: session.id,
        filename: file.name,
        file: buffer.toString('base64'),
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[invoices/upload] backend returned', res.status, body);
      return NextResponse.json(
        { ok: false, filename: file.name, reason: 'backend_error' },
        { status: 200 }
      );
    }
    return NextResponse.json(body ?? { ok: false, filename: file.name, reason: 'backend_error' });
  } catch (err) {
    // One failed file must not look like a failed batch: the browser shows this
    // row as unread and carries on with the rest.
    console.error('[invoices/upload] proxy failed', String(err));
    return NextResponse.json(
      { ok: false, filename: file.name, reason: 'unreachable' },
      { status: 200 }
    );
  }
}
