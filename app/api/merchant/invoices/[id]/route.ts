import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

/**
 * Delete one ledger row.
 *
 * The backend refuses a paid one: it records money that arrived and is what a
 * payment was reconciled against, so removing it would let the same invoice be
 * ingested and chased again at a customer who has already paid.
 *
 * Ownership is enforced on the other side too, against the merchant_id sent
 * from here - a session proves who is asking, not what they may delete.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !internalToken) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  try {
    const url = new URL(
      `${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-invoices/${encodeURIComponent(id)}`
    );
    // The backend reads merchant_id as a query parameter: a DELETE with a body
    // is accepted by some servers and dropped by others, and this one does not
    // need to find out which.
    url.searchParams.set('merchant_id', session.id);

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-Internal-Token': internalToken },
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `Ledger service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/invoices/delete] proxy failed', String(err));
    return NextResponse.json({ error: 'Ledger service unreachable' }, { status: 502 });
  }
}
