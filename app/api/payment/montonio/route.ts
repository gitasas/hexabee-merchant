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
 * **Charged only when the merchant has chosen `fee_mode = 'payer'.`** Uniformity
 * across methods is what Art 62(4) requires; it says nothing about whether the
 * payer is asked for the fee at all, so a merchant absorbing it is fine. This
 * rail ignored `fee_mode` until 2026-09-10 and added the fee to every payment,
 * including links whose merchant had explicitly said "I cover it".
 *
 * Whoever pays, HexaBee invoices the merchant EUR 0.39 monthly in arrears and
 * Montonio bills them separately — EUR 0.39 is never a payer-facing number.
 * Nothing is deducted per transaction on this rail.
 */
const PAYER_FLAT_FEE_EUR = 0.49;

/**
 * Who covers the flat fee for *this* payment.
 *
 * A payment link carries its own choice, made when the link was created, and it
 * overrides the merchant default — that is the whole point of the per-link
 * setting. Resolved from the backend rather than from the request body: the
 * amount a payer is charged must not be decidable by the browser.
 *
 * When a link is named but cannot be read, fall back to *not* charging the fee.
 * Undercharging by 49 cents is a rounding error; charging more than the button
 * the payer just pressed said is the one failure a checkout must never have.
 */
async function payerCoversFee(
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
      `SELECT id, montonio_access_key, montonio_secret_key, payment_rail, fee_mode
       FROM merchants WHERE slug = $1 AND is_active = true`,
      [String(merchantSlug).toLowerCase()]
    );
    if (!merchant) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const paymentId = randomUUID();
    const paymentMethod = method === 'cardPayments' ? 'cardPayments' : 'paymentInitiation';

    const invoiceAmount = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    // The payer settles the invoice plus the flat fee — when the fee is theirs
    // to pay — in one bank payment that lands entirely in the merchant's own
    // account. When the merchant covers it, the payer is charged the invoice and
    // nothing else; HexaBee's EUR 0.39 is invoiced to the merchant either way.
    const feeCharged = (await payerCoversFee(merchant, String(merchantSlug), payment_link_short_id))
      ? PAYER_FLAT_FEE_EUR
      : 0;
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
        // The merchant's own Montonio store. Omitted only for HexaBee's sandbox
        // store, which the backend falls back to; a live merchant always settles
        // into their own account, never ours.
        access_key: merchant.montonio_access_key ?? undefined,
        secret_key: merchant.montonio_secret_key ?? undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Only recorded once the provider accepted the order, so a failed create
    // never leaves an orphan row the webhook could never resolve.
    await query(
      `INSERT INTO merchant_payments (id, merchant_id, provider, provider_payment_id, amount, currency, reference, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'initiated', NOW())`,
      [
        paymentId,
        merchant.id,
        METHOD_TO_PROVIDER[paymentMethod] ?? 'montonio_bank',
        data.order_uuid ?? null,
        // What the payer actually paid, which is also what reaches the merchant.
        // Not always the invoice amount plus the fee: it is the invoice amount
        // exactly when the merchant covers the fee, so do not subtract EUR 0.49
        // from this column to recover the invoice total.
        chargedAmount,
        currency ?? 'EUR',
        reference ?? null,
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
