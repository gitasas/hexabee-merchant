// Public checkout origin used to build merchant payment links.
// NEXT_PUBLIC_CHECKOUT_URL may be unset in some deploys — fall back to the
// canonical checkout domain instead of rendering "undefined/pay/...".
export const CHECKOUT_URL =
  process.env.NEXT_PUBLIC_CHECKOUT_URL ?? 'https://checkout.hexabee.buzz';
