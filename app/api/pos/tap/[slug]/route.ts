import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { montonioFee, visibleMethods } from '@/app/pay/methods';

// POS v2 — the customer's side. A static NFC sticker (or the QR on the till
// screen) points at /tap/<slug> forever; this route answers "what is this
// counter asking for right now?".
//
// Static is the point. Neopay's competing product needs a device that receives
// each amount; a sticker costs about a euro and never has to be programmed,
// because the amount lives here and not in the tag.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const merchant = await queryOne<{
      id: string;
      business_name: string;
      currency: string | null;
      sort_code: string | null;
      fee_mode: string | null;
      payment_rail: string | null;
      enabled_methods: string[] | null;
      montonio_access_key: string | null;
      montonio_secret_key: string | null;
      montonio_sandbox: boolean | null;
      stripe_account_id: string | null;
    }>(
      `SELECT id, business_name, currency, sort_code, fee_mode, payment_rail,
              enabled_methods, montonio_access_key, montonio_secret_key,
              montonio_sandbox, stripe_account_id
       FROM merchants WHERE slug = $1 AND is_active = true`,
      [String(slug).toLowerCase()]
    );
    if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Same rule as the pay page: a merchant part-way through onboarding must
    // not show a customer buttons that cannot complete a payment.
    const acceptingPayments =
      merchant.payment_rail === 'montonio'
        ? (!!merchant.montonio_access_key && !!merchant.montonio_secret_key) || !!merchant.montonio_sandbox
        : !!merchant.stripe_account_id;

    const currency = merchant.currency ?? (merchant.sort_code ? 'GBP' : 'EUR');

    const request = await queryOne<{
      id: string;
      amount: string;
      currency: string;
      reference: string | null;
      status: string;
    }>(
      `SELECT id, amount, currency, reference, status
       FROM pos_requests
       WHERE merchant_id = $1 AND status = 'open' AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [merchant.id]
    );

    const fee = montonioFee(merchant.payment_rail, merchant.fee_mode);
    const methods = visibleMethods(merchant.payment_rail, currency, merchant.enabled_methods);

    return NextResponse.json({
      business_name: merchant.business_name,
      payment_rail: merchant.payment_rail,
      fee_mode: merchant.fee_mode,
      currency,
      accepting_payments: acceptingPayments,
      methods,
      // Null when the counter has not entered an amount yet — the customer sees
      // "ask the cashier to enter the amount" rather than an empty form. Never
      // let them type it themselves: this screen exists precisely so they don't.
      request: request
        ? {
            id: request.id,
            amount: Number(request.amount),
            currency: request.currency,
            reference: request.reference,
            fee,
            total: Math.round((Number(request.amount) + fee) * 100) / 100,
          }
        : null,
    });
  } catch (err) {
    console.error('[POS] tap lookup failed', String(err));
    return NextResponse.json({ error: 'Could not read counter' }, { status: 500 });
  }
}
