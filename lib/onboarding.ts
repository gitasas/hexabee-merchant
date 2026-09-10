/**
 * Whether a merchant has finished setting up — meaning they can actually take a
 * payment, which depends on their rail.
 *
 * This used to be "has a Stripe account", checked separately in the portal
 * layout and in five pages. A Baltic merchant never has one: their payments run
 * through their own Montonio store. So every one of those checks bounced them
 * back to onboarding, from a screen that had just told them they were finished.
 *
 * One predicate, used by both the server layout and the client pages, because
 * six copies of a rule are six chances for it to drift.
 */
export type OnboardingFields = {
  business_name?: string | null;
  business_country?: string | null;
  stripe_account_id?: string | null;
  payment_rail?: string | null;
  montonio_configured?: boolean | null;
};

export function isOnboardingComplete(m: OnboardingFields | null | undefined): boolean {
  if (!m) return false;
  if (!m.business_name || !m.business_country) return false;

  return m.payment_rail === 'montonio'
    ? !!m.montonio_configured
    : !!m.stripe_account_id;
}
