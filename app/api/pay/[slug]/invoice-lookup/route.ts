import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { isSettledToNothing } from '@/lib/invoice-amount';

type InvoiceLookupRow = {
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
};

// Public lookup: given a merchant slug and an invoice reference, report whether
// a matching BCC-ingested invoice exists. Returns ONLY invoice_number, amount,
// currency and status — nothing merchant- or payer-identifying.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const ref = (req.nextUrl.searchParams.get('ref') ?? '').trim();

  if (!ref) return NextResponse.json({ found: false });

  try {
    const merchant = await queryOne<{ id: string }>(
      'SELECT id FROM merchants WHERE slug = $1 AND is_active = true',
      [slug.toLowerCase()]
    );
    if (!merchant) return NextResponse.json({ found: false });

    const invoice = await queryOne<InvoiceLookupRow>(
      `SELECT invoice_number, amount, currency, status
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
    });
  } catch (err) {
    // merchant_invoices may not exist yet in this environment — behave as "not found"
    console.error('[invoice-lookup] query failed (table missing?)', String(err));
    return NextResponse.json({ found: false });
  }
}
