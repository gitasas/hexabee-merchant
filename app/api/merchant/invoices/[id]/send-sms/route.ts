import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';

// Message one invoice by SMS, because the merchant is pointing at that row.
//
// This is both "send it again" and "chase this debtor", on purpose. At 70
// characters the difference between an invoice and a reminder is cosmetic, and
// a second template would be two things to keep in step for no gain - so
// `kind` records which it was while the words stay the merchant's own.
//
// The backend waives only `sms_sent_at` and keeps the checks that protect the
// recipient: a usable Lithuanian mobile number, an invoice number, and an
// amount above zero. An invoice settling to nothing is never messaged - by
// email the payer still gets their statement, but an SMS saying "0.00 EUR, pay
// here" costs the merchant money and links to a page with no button on it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let kind = 'invoice';
  try {
    const body = await req.json();
    if (body?.kind === 'reminder') kind = 'reminder';
  } catch { /* an ordinary send is the default */ }

  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !internalToken) {
    return NextResponse.json(
      { error: 'Server misconfigured: ADMIN_API_BASE_URL / INTERNAL_SERVICE_TOKEN not set' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/plugin/merchant-invoices/${encodeURIComponent(id)}/send-sms`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
        body: JSON.stringify({ merchant_id: session.id, kind }),
      }
    );
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: `SMS service returned ${res.status}` };
    }
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error('[merchant/invoices/send-sms-one] proxy failed', String(err));
    return NextResponse.json({ error: 'SMS service unreachable' }, { status: 502 });
  }
}
