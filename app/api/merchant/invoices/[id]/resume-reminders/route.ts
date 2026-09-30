import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Resume reminders on an invoice the payer claimed to have already paid.
 *
 * The claim is the payer's word and it stops the automatic dunning loop. If the
 * merchant checks their bank and the money is not there, they must be able to
 * start chasing again - otherwise one false click silences an unpaid invoice for
 * good, and a customer who wanted to stall would only have to press a button.
 *
 * It clears the claim AND restarts the reminder count, because clearing alone is
 * not enough: a payer who claims after the allowance is spent would leave the
 * loop finished either way. The merchant is explicitly overruling the payer here,
 * so a fresh cycle is exactly what they asked for.
 *
 * last_reminder_at is deliberately kept, so the next reminder waits the normal
 * interval instead of firing within the hour. Chasing again is the merchant's
 * decision; ambushing the customer the same afternoon is not.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const rows = await query<{ id: string; status: string }>(
      `SELECT id, status FROM merchant_invoices WHERE id = $1 AND merchant_id = $2`,
      [id, session.id]
    );
    const invoice = rows[0];
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    if (invoice.status === 'paid') {
      return NextResponse.json({ error: 'Invoice is already paid' }, { status: 409 });
    }

    // The claim token is retired with the claim. Without that, the payer could
    // reopen the old reminder and press the same link again, stopping the loop
    // for a second time from an email the merchant has already overruled. The
    // next reminder mints a fresh token, so they can still say "I paid" about
    // the chase that is actually running - once per reminder, which is the point.
    const updated = await query<{ id: string }>(
      `UPDATE merchant_invoices
          SET payer_claimed_at = NULL, reminders_sent = 0, claim_token = NULL
        WHERE id = $1 AND merchant_id = $2 AND status <> 'paid'
        RETURNING id`,
      [id, session.id]
    );
    if (updated.length === 0) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    return NextResponse.json({ success: true, reminders_sent: 0 });
  } catch (err) {
    if (/payer_claimed_at|claim_token/.test(String(err))) {
      console.warn('[merchant/invoices/resume-reminders] payer_claimed_at column missing - backend deploy pending');
      return NextResponse.json(
        { error: 'This is being set up. Please try again shortly.' },
        { status: 503 }
      );
    }
    console.error('[merchant/invoices/resume-reminders] update failed', String(err));
    return NextResponse.json({ error: 'Could not update the invoice' }, { status: 500 });
  }
}
