import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { isSettledToNothing } from '@/lib/invoice-amount';

type InvoiceLookupRow = {
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  payment_purpose: string | null;
};

// Public lookup: given a merchant slug and an invoice reference, report whether
// a matching ledger invoice exists, so the pay page can show the payer what
// they are about to pay.
//
// ⚠️ This endpoint is public and invoice numbers are guessable - a school's run
// as a monthly sequence. It has always exposed the amount and the paid status
// of a guessed reference. Since 2026-10-05 it also returns `payment_purpose`,
// which for a school names the children ("Už Vladą Buivį, Sofiją Buivytę"), and
// that is a step up from financial data to personal data about a minor.
// Returned anyway, deliberately: the purpose is precisely what the payer must
// be able to check before paying, and it is already printed on the invoice they
// were emailed. If that trade stops being acceptable, the fix is to stop
// returning this field rather than to weaken the condition below.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const ref = (req.nextUrl.searchParams.get('ref') ?? '').trim();

  if (!ref) return NextResponse.json({ found: false });

  try {
    const merchant = await queryOne<{ id: string; use_invoice_payment_purpose: boolean | null }>(
      `SELECT id, use_invoice_payment_purpose
         FROM merchants WHERE slug = $1 AND is_active = true`,
      [slug.toLowerCase()]
    );
    if (!merchant) return NextResponse.json({ found: false });

    const invoice = await queryOne<InvoiceLookupRow>(
      `SELECT invoice_number, amount, currency, status, payment_purpose
       FROM merchant_invoices
       WHERE merchant_id = $1 AND LOWER(invoice_number) = LOWER($2)
       LIMIT 1`,
      [merchant.id, ref]
    );
    if (!invoice) return NextResponse.json({ found: false });

    return NextResponse.json({
      found: true,
      invoice_number: invoice.invoice_number,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      // An invoice can be read correctly and still owe nothing: a school that
      // applies a parent's prepayment prints "Mokėti: 0,00", or a negative when
      // the parent overpaid. The pay page has to be told, because the amount
      // alone looks like an ordinary invoice that happens to be cheap, and the
      // payer would be charged the 0,49 fee on top of nothing (2026-10-02).
      nothing_to_pay: isSettledToNothing(invoice.amount),
      // What the payer's bank statement will actually say. Returned ONLY when
      // this merchant's payments really carry it - the same condition
      // /api/payment/montonio applies before it reads this column. Telling a
      // payer "your bank will show X" when the payment will in fact carry the
      // invoice number is a promise the product then breaks, and the payer is
      // the one who finds out (2026-10-05).
      payment_purpose:
        merchant.use_invoice_payment_purpose === true ? invoice.payment_purpose : null,
    });
  } catch (err) {
    // merchant_invoices may not exist yet in this environment — behave as "not found"
    console.error('[invoice-lookup] query failed (table missing?)', String(err));
    return NextResponse.json({ found: false });
  }
}
