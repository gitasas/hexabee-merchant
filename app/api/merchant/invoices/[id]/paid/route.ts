import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Close a ledger invoice that was settled outside HexaBee, or reopen one closed
 * by mistake.
 *
 * An ordinary bank transfer into the merchant's own account never reaches us, so
 * nothing flipped the row and the dunning loop kept chasing a customer who had
 * already paid. The merchant reconciles their bank anyway; this is the one click
 * that tells us what they already know.
 *
 * It writes ONLY merchant_invoices. No merchant_payments row is created, on
 * purpose: HexaBee's monthly invoice is built from merchant_payments, and this
 * is a payment we did not process and must never bill 0.39 EUR for. That is also
 * why paid_source records how the row was closed.
 */

async function loadOwned(id: string, merchantId: string) {
  const rows = await query<{ id: string; status: string; paid_source: string | null }>(
    `SELECT id, status, paid_source FROM merchant_invoices WHERE id = $1 AND merchant_id = $2`,
    [id, merchantId]
  );
  return rows[0] ?? null;
}

function missingColumn(err: unknown): boolean {
  return /paid_source|payer_claimed_at|claim_token/.test(String(err));
}

// The backend owns the migration. If this app ships first the columns are not
// there yet, and a bare 500 would read to the merchant as "the button is broken"
// with nothing explaining why.
const NOT_MIGRATED = NextResponse.json(
  { error: 'This is being set up. Please try again shortly.' },
  { status: 503 }
);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const invoice = await loadOwned(id, session.id);
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    if (invoice.status === 'paid') {
      return NextResponse.json({ error: 'Invoice is already paid' }, { status: 409 });
    }

    // Scoped by merchant_id as well as id: the session must never be able to
    // close another merchant's invoice by guessing a uuid.
    const rows = await query<{ id: string; paid_at: string }>(
      `UPDATE merchant_invoices
          SET status = 'paid', paid_at = NOW(), paid_source = 'manual'
        WHERE id = $1 AND merchant_id = $2 AND status <> 'paid'
        RETURNING id, paid_at`,
      [id, session.id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    return NextResponse.json({ success: true, paid_at: rows[0].paid_at, paid_source: 'manual' });
  } catch (err) {
    if (missingColumn(err)) {
      console.warn('[merchant/invoices/paid] paid_source column missing - backend deploy pending');
      return NOT_MIGRATED;
    }
    console.error('[merchant/invoices/paid] update failed', String(err));
    return NextResponse.json({ error: 'Could not update the invoice' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const invoice = await loadOwned(id, session.id);
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    // Only a manual tick can be undone. A row closed by a Stripe or Montonio
    // webhook records real money that really arrived, and letting the portal
    // reopen it would put the ledger at odds with the payment and start the
    // reminders again for an invoice the payer has a receipt for.
    if (invoice.paid_source !== 'manual') {
      return NextResponse.json(
        { error: 'This invoice was paid through HexaBee and cannot be reopened' },
        { status: 409 }
      );
    }

    // reminders_sent is deliberately left alone: those emails really were sent,
    // and resetting the count would let the loop chase three more times.
    const rows = await query<{ id: string }>(
      `UPDATE merchant_invoices
          SET status = 'issued', paid_at = NULL, paid_source = NULL
        WHERE id = $1 AND merchant_id = $2 AND paid_source = 'manual'
        RETURNING id`,
      [id, session.id]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (missingColumn(err)) {
      console.warn('[merchant/invoices/paid] paid_source column missing - backend deploy pending');
      return NOT_MIGRATED;
    }
    console.error('[merchant/invoices/paid] reopen failed', String(err));
    return NextResponse.json({ error: 'Could not update the invoice' }, { status: 500 });
  }
}
