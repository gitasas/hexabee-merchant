import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { query, queryOne } from '@/lib/db';

// Montonio counterpart of /api/payment/stripe. Same division of labour: this
// route owns the merchant_payments row, the Node backend owns talking to the
// provider.
//
// One difference from the Stripe route, and it matters: the payment id is
// generated *before* calling the backend, because it is sent as Montonio's
// merchantReference. Montonio requires that reference unique per store, and it
// is what comes back on the webhook — so it has to be a value we own, not the
// invoice number, which repeats whenever an invoice is paid on a retry.

type MerchantRow = {
  id: string;
  montonio_access_key: string | null;
  montonio_secret_key: string | null;
  montonio_sandbox: boolean | null;
  payment_rail: string | null;
  fee_mode: string | null;
};

/**
 * What the payer is charged on top of the invoice, in EUR.
 *
 * Flat, and identical for every payment method — that uniformity is the legal
 * basis, not a pricing preference. PSD2 Article 62(4) bans payee charges for
 * instruments covered by the Interchange Fee Regulation (EEA consumer cards)
 * and by SEPA Regulation 260/2012 (credit transfers), so both Montonio methods
 * are caught. A flat platform fee for processing an invoice is a service fee;
 * the moment it varies by method it becomes a prohibited surcharge.
 *
 * Applied here rather than in the browser so the charge cannot be altered by a
 * crafted request, and so there is exactly one place that decides it.
 *
 * **The EUR 0.49 is two fees, and only one of them is negotiable:**
 *
 * - **EUR 0.39 — HexaBee's platform fee.** Always the payer's, on every payment,
 *   whatever the merchant's fee mode says. It is the price of processing the
 *   invoice, and it is the same number HexaBee invoices the merchant monthly in
 *   arrears, so the merchant is passing it straight through.
 * - **EUR 0.10 — the bank cost Montonio bills the merchant.** This is what
 *   `fee_mode` decides. `payer` puts it on the payer (merchant nets zero);
 *   `merchant` absorbs it (merchant nets −EUR 0.10 on a bank payment).
 *
 * So the payer is charged EUR 0.49 or EUR 0.39, never nothing. Both are flat and
 * identical across methods, so Art 62(4) is satisfied either way.
 *
 * On a card the merchant absorbs Montonio's card rate (~EUR 1.11 on EUR 100)
 * regardless — EUR 0.10 is the bank figure, and cards cannot be priced
 * separately without becoming a surcharge.
 */
const PLATFORM_FEE_EUR = 0.39;
const PROCESSING_FEE_EUR = 0.10;

/**
 * Whether the payer also covers the EUR 0.10 processing cost for *this* payment.
 *
 * A payment link carries its own choice, made when the link was created, and it
 * overrides the merchant default — that is the whole point of the per-link
 * setting. Resolved from the backend rather than from the request body: the
 * amount a payer is charged must not be decidable by the browser.
 *
 * When a link is named but cannot be read, fall back to *not* charging it.
 * Undercharging by ten cents is a rounding error; charging more than the button
 * the payer just pressed said is the one failure a checkout must never have.
 */
async function payerCoversProcessing(
  merchant: MerchantRow,
  merchantSlug: string,
  payLinkShortId: unknown
): Promise<boolean> {
  const merchantDefault = merchant.fee_mode === 'payer';
  if (typeof payLinkShortId !== 'string' || !payLinkShortId.trim()) return merchantDefault;

  const base = (process.env.ADMIN_API_BASE_URL || '').replace(/\/$/, '');
  if (!base) return false;

  try {
    const res = await fetch(
      `${base}/api/plugin/payment-links/${encodeURIComponent(payLinkShortId.trim())}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return false;
    const link = await res.json();
    // A link belonging to someone else tells us nothing about this payment.
    if (String(link?.merchant_slug ?? '').toLowerCase() !== merchantSlug.toLowerCase()) {
      return false;
    }
    // Links created before the per-link choice existed have no value stored.
    if (link?.fee_mode !== 'merchant' && link?.fee_mode !== 'payer') return merchantDefault;
    return link.fee_mode === 'payer';
  } catch {
    return false;
  }
}

// merchant_payments.provider holds the payment method type, not the PSP.
const METHOD_TO_PROVIDER: Record<string, string> = {
  paymentInitiation: 'montonio_bank',
  cardPayments: 'montonio_card',
};

export async function POST(req: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      console.error('BACKEND_URL is not set — cannot create payment');
      return NextResponse.json({ error: 'Payment backend not configured' }, { status: 500 });
    }

    const body = await req.json();
    const {
      merchantSlug,
      amount,
      currency,
      reference,
      method,
      preferred_country,
      preferred_provider,
      locale,
      return_url,
      preferred_method,
      payment_link_short_id,
    } = body;

    if (!merchantSlug) {
      return NextResponse.json({ error: 'Missing merchantSlug' }, { status: 400 });
    }

    const merchant = await queryOne<MerchantRow>(
      `SELECT id, montonio_access_key, montonio_secret_key, montonio_sandbox, payment_rail, fee_mode
       FROM merchants WHERE slug = $1 AND is_active = true`,
      [String(merchantSlug).toLowerCase()]
    );
    if (!merchant) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Whose store this payment settles into. The merchant's own, or — only
    // when the row is flagged for it, which only staging can do — HexaBee's
    // sandbox store, signalled to the backend by sending no keys at all.
    //
    // Never a silent fallback. A merchant with no keys and no flag gets a
    // refusal, not a payment into our account: the pay page already hides its
    // buttons for them, and this route must not honour a crafted request the
    // page would never make. In production that fallback would be HexaBee
    // holding a merchant's money.
    const hasOwnStore = !!merchant.montonio_access_key && !!merchant.montonio_secret_key;
    if (!hasOwnStore && !merchant.montonio_sandbox) {
      return NextResponse.json({ error: 'Bank payments are not set up for this business yet' }, { status: 409 });
    }

    const paymentId = randomUUID();
    const paymentMethod = method === 'cardPayments' ? 'cardPayments' : 'paymentInitiation';

    const invoiceAmount = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    // The payer settles the invoice plus the platform fee, plus the processing
    // cost when that is theirs too — in one bank payment that lands entirely in
    // the merchant's own account. HexaBee invoices the merchant its EUR 0.39
    // monthly either way; the merchant has already collected it here.
    const coversProcessing = await payerCoversProcessing(
      merchant,
      String(merchantSlug),
      payment_link_short_id
    );
    const feeCharged = PLATFORM_FEE_EUR + (coversProcessing ? PROCESSING_FEE_EUR : 0);
    const chargedAmount = Math.round((invoiceAmount + feeCharged) * 100) / 100;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.BACKEND_API_TOKEN) {
      headers['X-Backend-Token'] = process.env.BACKEND_API_TOKEN;
    }

    const res = await fetch(`${backendUrl}/create-montonio-payment`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: chargedAmount,
        currency: currency ?? 'EUR',
        merchant_reference: paymentId,
        // What the payer sees on their bank statement, so it must be the
        // invoice number rather than our internal id.
        payment_description: reference ?? undefined,
        method: paymentMethod,
        preferred_country,
        preferred_provider,
        locale,
        preferred_method,
        // Built here, not taken from the browser: the payer must come back to
        // the receipt page for *this* payment, and only this route knows its id.
        return_url: `${new URL(req.url).origin}/payment-success?payment_id=${paymentId}`,
        // The merchant's own Montonio store, or nothing for a sandbox-flagged
        // merchant, which the backend takes as its env sandbox store. The guard
        // above is what makes "nothing" safe to send.
        access_key: hasOwnStore ? merchant.montonio_access_key : undefined,
        secret_key: hasOwnStore ? merchant.montonio_secret_key : undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Only recorded once the provider accepted the order, so a failed create
    // never leaves an orphan row the webhook could never resolve.
    await query(
      `INSERT INTO merchant_payments (id, merchant_id, provider, provider_payment_id, amount, currency, reference, payment_link_short_id, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'initiated', NOW())`,
      [
        paymentId,
        merchant.id,
        METHOD_TO_PROVIDER[paymentMethod] ?? 'montonio_bank',
        data.order_uuid ?? null,
        // What the payer actually paid, which is also what reaches the merchant.
        // The fee inside it is EUR 0.49 or EUR 0.39 depending on the fee mode in
        // force at the time, so do not assume either when recovering the invoice
        // total from this column.
        chargedAmount,
        currency ?? 'EUR',
        reference ?? null,
        // Stripe carries this in session metadata and the Node backend reads it
        // back off the webhook. Montonio's token has no room for our own fields,
        // so the link is remembered on the row instead — without it a paid link
        // stayed at "0 uses" forever, and a max_uses limit never expired.
        typeof payment_link_short_id === 'string' && payment_link_short_id.trim()
          ? payment_link_short_id.trim()
          : null,
      ]
    );

    return NextResponse.json({
      ...data,
      invoice_amount: invoiceAmount,
      payer_fee: feeCharged,
      charged_amount: chargedAmount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payment creation failed' },
      { status: 500 }
    );
  }
}
