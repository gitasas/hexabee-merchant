import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * Receipt data for a payment that did not go through Stripe.
 *
 * /payment-success was written against a Stripe session, so this returns the
 * same shape from merchant_payments rather than giving the Montonio rail its own
 * success screen. A payer who has just paid should see the same page and get the
 * same receipt whichever rail carried the money.
 */
type Row = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  amount: string | null;
  currency: string | null;
  reference: string | null;
  status: string;
  created_at: string;
  payer_fee: string | null;
  business_name: string | null;
  company_code: string | null;
  merchant_slug: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params;

  // merchant_payments.id is a uuid column: anything else throws in Postgres.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const row = await queryOne<Row>(
      `SELECT p.id, p.provider, p.provider_payment_id, p.amount, p.currency, p.reference,
              p.status, p.created_at, p.payer_fee,
              m.business_name, m.company_code, m.slug AS merchant_slug
       FROM merchant_payments p
       JOIN merchants m ON m.id = p.merchant_id
       WHERE p.id = $1`,
      [paymentId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const amountTotal = row.amount != null ? Math.round(Number(row.amount) * 100) : null;
    // What the payer was charged on top of the invoice. Rows written before the
    // column existed have null here, and the receipt then shows the total only
    // rather than guess at a split.
    const payerFee = row.payer_fee != null ? Math.round(Number(row.payer_fee) * 100) : null;

    return NextResponse.json({
      id: row.provider_payment_id ?? row.id,
      amount_total: amountTotal,
      currency: row.currency,
      payment_status: row.status === 'paid' ? 'paid' : row.status,
      created: Math.floor(new Date(row.created_at).getTime() / 1000),
      // The payer's accountant needs a document for the fee, and the fee is
      // collected by the merchant, not by HexaBee — the whole charged amount lands
      // in the merchant's account. The receipt therefore itemises the invoice
      // and the fee, and names the merchant (with company code) as the recipient
      // of both.
      payer_fee: payerFee,
      invoice_amount: amountTotal != null && payerFee != null ? amountTotal - payerFee : null,
      metadata: {
        reference: row.reference ?? '',
        merchant: row.business_name ?? '',
        merchant_company_code: row.company_code ?? '',
        method: row.provider,
        // So a payer who cancelled at the bank has somewhere to go back to.
        merchant_slug: row.merchant_slug ?? '',
      },
      customer_details: null,
    });
  } catch (err) {
    console.error('[receipt] lookup failed', String(err));
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
