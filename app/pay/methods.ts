/**
 * The payment-method catalogue and the rules for which of it a payer sees.
 *
 * Shared by /pay/[slug] (invoice, POS and payment-link screens) and by
 * /pay-preview, which the Gmail extension sends payers to. Until 2026-09-11 the
 * preview kept its own copy and had drifted: it filtered nothing by the
 * merchant's toggles, knew no wallet row, and showed "Pay" with no total on a
 * rail that adds a flat fee. A payer reaching checkout from Gmail saw a
 * different — and wrong — set of choices from one reaching it by link.
 *
 * Displayed fees mirror calculateHexabeeFee in the payments backend (index.js):
 * iDEAL/bank transfer/Pay by Bank = 1% (min 50 minor units); BNPL
 * (Klarna/Afterpay/Billie) = 6.9% + 30 minor units; everything else
 * = 2% + 20 (GBP) / 2.9% + 25 (other).
 */

export type PayMethod = {
  id: string;
  name: string;
  icon: string;
  description: string;
  fee: string;
  type: 'stripe' | 'stripe_bank' | 'bank_soon' | 'montonio';
};

// ── The Baltic rail ──────────────────────────────────────────────────────────

/**
 * Every method carries the same fee, and that is the point: PSD2 Art 62(4) bans
 * payee charges on IFR cards and SEPA credit transfers alike, so a fee that
 * varied by method would be a prohibited surcharge. The amount is applied
 * server-side in /api/payment/montonio — this file only displays it, and must
 * display exactly what that route will charge.
 *
 * Two fees, not one: the payer always pays HexaBee's EUR 0.39 platform fee, and
 * `fee_mode` decides only whether they also cover the EUR 0.10 bank cost. So the
 * total is EUR 0.49 or EUR 0.39 — never nothing.
 */
export const PLATFORM_FEE_EUR = 0.39;
export const PROCESSING_FEE_EUR = 0.10;

/**
 * What this rail adds to the payer's total. A payment link's own choice wins
 * over the merchant default; a link made before that choice existed has none,
 * and falls back to the merchant setting. Zero off the Montonio rail.
 */
export function montonioFee(rail: string | null | undefined, ...feeModes: (string | null | undefined)[]): number {
  if (rail !== 'montonio') return 0;
  const mode = feeModes.find(m => m === 'merchant' || m === 'payer');
  return mode === 'payer' ? PLATFORM_FEE_EUR + PROCESSING_FEE_EUR : PLATFORM_FEE_EUR;
}

export const MONTONIO_METHODS: PayMethod[] = [
  { id: 'montonio_bank', name: 'Bank payment', icon: '🏦', description: 'Pay directly from your bank account', fee: '€0.49', type: 'montonio' },
  { id: 'montonio_wallet', name: 'Apple Pay / Google Pay', icon: '📱', description: 'One tap, no card details to type', fee: '€0.49', type: 'montonio' },
  { id: 'montonio_card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '€0.49', type: 'montonio' },
];

/**
 * A wallet payment on this rail *is* a card payment — same Montonio method, same
 * card cost to the merchant. It is a separate row only because it saves the payer
 * typing card details, which is the friction that has cost real deals.
 *
 * `preferredMethod` decides which side of Montonio's page opens first. Their API
 * cannot hide the card form: both stay reachable whatever we send.
 */
export const MONTONIO_PREFERRED: Record<string, 'wallet' | 'card'> = {
  montonio_wallet: 'wallet',
  montonio_card: 'card',
};

export const MONTONIO_METHOD_MAP: Record<string, string> = {
  montonio_bank: 'paymentInitiation',
  montonio_card: 'cardPayments',
  montonio_wallet: 'cardPayments',
};

/**
 * Which Montonio methods this merchant offers.
 *
 * Neither id stored is not the same as both switched off — it means the merchant
 * has never opened the setting, so both are shown. Once they choose, the choice
 * is honoured: cards cost them Montonio's card rate while the bank cost hides
 * under the platform fee, so declining cards is a real decision, not a formality.
 */
export function montonioVisible(all: PayMethod[], enabled: string[]): PayMethod[] {
  const hasChoice = enabled.some(e => e === 'montonio_bank' || e === 'montonio_card');
  if (!hasChoice) return all;
  const cardsOn = enabled.includes('montonio_card');
  const chosen = all.filter(m =>
    m.id === 'montonio_wallet' ? cardsOn : enabled.includes(m.id)
  );
  return chosen.length ? chosen : all;
}

// ── The Stripe rail ──────────────────────────────────────────────────────────

export const GBP_METHODS: PayMethod[] = [
  { id: 'pay_by_bank', name: 'Pay By Bank', icon: '🏦', description: 'Instant bank transfer', fee: '1% (min £0.50)', type: 'stripe_bank' },
  { id: 'bacs', name: 'Bacs Direct Debit', icon: '🔁', description: 'UK direct debit', fee: '2% + £0.20', type: 'stripe_bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + £0.20', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + £0.20', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + £0.20', type: 'stripe' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '6.9% + £0.30', type: 'stripe' },
  { id: 'afterpay', name: 'Afterpay / Clearpay', icon: '📦', description: 'Pay in 4 instalments', fee: '6.9% + £0.30', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '1% (min £0.50)', type: 'stripe_bank' },
];

export const EUR_METHODS: PayMethod[] = [
  { id: 'sepa', name: 'SEPA Direct Debit', icon: '🔁', description: 'EU direct debit', fee: '2.9% + €0.25', type: 'stripe_bank' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '1% (min €0.50)', type: 'stripe_bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2.9% + €0.25', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2.9% + €0.25', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2.9% + €0.25', type: 'stripe' },
  { id: 'ideal', name: 'iDEAL', icon: '🇳🇱', description: 'Netherlands instant bank payment', fee: '1% (min €0.50)', type: 'stripe_bank' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '6.9% + €0.30', type: 'stripe' },
  { id: 'billie', name: 'Billie', icon: '🏢', description: 'B2B buy now pay later', fee: '6.9% + €0.30', type: 'stripe' },
];

export const OTHER_METHODS: PayMethod[] = [
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2.9% + 0.25', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2.9% + 0.25', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2.9% + 0.25', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '1% (min 0.50)', type: 'stripe_bank' },
];

/** What a merchant who has never opened the payment-methods page offers. */
export const DEFAULT_ENABLED = ['cards', 'apple_pay', 'google_pay', 'revolut_pay', 'bacs', 'bank_transfer', 'klarna', 'afterpay'];

export function methodsForCurrency(cur: string, rail?: string | null): PayMethod[] {
  if (rail === 'montonio') return MONTONIO_METHODS;
  const c = cur.toUpperCase();
  if (c === 'GBP') return GBP_METHODS;
  if (c === 'EUR') return EUR_METHODS;
  return OTHER_METHODS;
}

/**
 * The methods a payer may actually pick: the rail's catalogue for this
 * currency, cut down to what the merchant has switched on. One function so
 * every checkout surface answers the same way.
 */
export function visibleMethods(
  rail: string | null | undefined,
  currency: string,
  enabled: string[] | null | undefined
): PayMethod[] {
  const all = methodsForCurrency(currency, rail);
  const on = enabled ?? DEFAULT_ENABLED;
  if (rail === 'montonio') return montonioVisible(all, on);
  return all.filter(m =>
    on.some(e => e === m.id || (m.id === 'card' && (e === 'cards' || e === 'cartes_bancaires')))
  );
}

// ── Fee gross-up (payer covers the HexaBee fee) ───────────────────────────────
// Mirrors the backend's calculateHexabeeFee (index.js):
//   ideal/bank_transfer/pay_by_bank → fee = max(round(gross * 1%), 50 minor units)
//   klarna/afterpay/billie (BNPL) → fee = round(gross * 6.9%) + 30
//   GBP                  → fee = round(gross * 2%) + 20
//   other currencies     → fee = round(gross * 2.9%) + 25
// Gross-up solves gross − fee(gross) = net (ceil, so the merchant never nets less).
export const PCT_MIN_METHODS = new Set(['ideal', 'bank_transfer', 'pay_by_bank']); // 1%, min 50 minor units
export const BNPL_METHODS = new Set(['klarna', 'afterpay', 'billie']); // 6.9% + 30

export function grossUpMinor(netMinor: number, currency: string, methodId: string): number {
  if (PCT_MIN_METHODS.has(methodId)) {
    // Below the 50-minor-unit floor the fee is effectively flat 50; above it,
    // solve gross − gross*1% = net.
    return Math.max(Math.ceil(netMinor / 0.99), netMinor + 50);
  }
  if (BNPL_METHODS.has(methodId)) {
    return Math.ceil((netMinor + 30) / (1 - 0.069));
  }
  if (currency.toUpperCase() === 'GBP') {
    return Math.ceil((netMinor + 20) / (1 - 0.02));
  }
  return Math.ceil((netMinor + 25) / (1 - 0.029));
}

export function grossUpAmountStr(amountStr: string, currency: string, methodId: string): string {
  const netMinor = Math.round(Number(amountStr) * 100);
  return (grossUpMinor(netMinor, currency, methodId) / 100).toFixed(2);
}
