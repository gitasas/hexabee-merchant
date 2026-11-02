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
// as a monthly sequence - so it exposes the amount and the paid status of a
// guessed reference to anyone who enumerates them. That is the price of a
// `?r=` link working with nothing typed, and it is financial data about an
// invoice the payer already holds.
//
// ⚠️ **`payment_purpose` IS returned here, and that was decided twice
// (2026-10-05, re-confirmed 2026-11-02 after being removed for a day).** For a
// school it names the children ("Už Vladą Buivį, Sofiją Buivytę") or pairs a
// pupil's registration number with their name, and references are guessable -
// a school's run as a monthly sequence - so an enumerator reaches it. It was
// removed on 2026-11-02 for exactly that reason and **put back the same day**,
// because removing it breaks the payment:
//
//   The field above it on the pay page is labelled "payment purpose", and the
//   invoice itself instructs the payer to quote a reference. With nothing
//   saying the purpose is already composed, the payer sees only an invoice
//   number in a field the invoice told them to fill differently - so they stop
//   and do not pay. An invoice that goes unpaid is a worse outcome than
//   disclosing, to someone who guessed a reference, a line that is already
//   printed on the invoice that payer holds. Gytis's call; this trade is his.
//
// So the deliberate position is: the amount, the status and the purpose of a
// guessed reference are all reachable here. If that stops being acceptable,
// the thing to change is **enumeration** - rate-limit this route, or make
// references unguessable - never the condition below, and never a half-masked
// purpose, which reassures nobody and discloses anyway.
//
// `merchants.use_invoice_payment_purpose` is still the gate, and it is the
// same condition `/api/payment/montonio` applies before reading that column.
// Telling a payer "your bank will show X" when the payment will in fact carry
// the invoice number is a promise the product then breaks.
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
      // What the payer's bank statement will actually say - the one thing that
      // tells them the "payment purpose" their invoice asked for is already
      // composed, so they can press pay. NULL unless this merchant's payments
      // really carry it; see the warning at the top of this file.
      payment_purpose:
        merchant.use_invoice_payment_purpose === true ? invoice.payment_purpose : null,
    });
  } catch (err) {
    // merchant_invoices may not exist yet in this environment - behave as "not found"
    console.error('[invoice-lookup] query failed (table missing?)', String(err));
    return NextResponse.json({ found: false });
  }
}
