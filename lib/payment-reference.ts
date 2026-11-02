/**
 * What goes into Montonio's STRUCTURED payment reference - the field Lithuanian
 * state institutions use ("įmokos kodas"), as opposed to `paymentDescription`,
 * which is the free-text purpose.
 *
 * Asked for by Kauno Valdorfo mokykla (Mindaugas Jukna, 2026-10-30): their
 * invoices print "Mokant pavedimu, registracijos numerį 1107 prašome nurodyti
 * mokėtojo kodo laukelyje", and until now that number reached the bank only
 * inside the purpose text, where their accounting cannot match on it
 * automatically.
 *
 * ⚠️ **This is the one field in the whole Montonio payload that can make the
 * BANK refuse the payment.** Montonio's own documentation:
 *
 *   "Structured payment reference number. This is a standardized reference
 *    number used for accounting purposes and will be validated by banks."
 *   "Banks validate this number strictly and payments will start failing if
 *    this number is not formatted correctly."
 *
 * So the rule is deliberately narrow, and it is narrow because of measured
 * evidence rather than caution. Running the committed detector over four of
 * that school's real invoices returns codes of two different shapes:
 *
 *   VAL25485  -> "1107 Vilija Juknaitė"
 *   VAL24535  -> "1070 Jonas Darašas"
 *   VAL24654  -> "1031 Arminas Kustinskis"
 *   NUOM-2691 -> "AA-017A Raimondas Gabrilavičius"      <- letters and a hyphen
 *
 * Passing every code through would therefore work for most parents and
 * silently break the payment for the ones whose code carries letters - the
 * worst shape of failure, because it happens in front of the payer and only
 * for some of them. `AA-017A` is refused here instead.
 *
 * **Nothing is ever taken away from the purpose.** The code and the name stay
 * in `paymentDescription` in every case, including when this returns null, so
 * a merchant whose codes are not numeric is exactly where they were before
 * this existed and their bookkeeper still sees the code on the statement.
 */

/** Digits only, 1-20 of them: anything else is refused rather than guessed. */
const NUMERIC_CODE = /^[0-9]{1,20}$/;

/**
 * ⚠️ Banks with no structured-reference field at all, where sending one is the
 * risky direction rather than the safe one.
 *
 * Gytis, 2026-11-02: *"Jei mokejimas per Revolut tai mokejimo kodo nera kur
 * deti, nes tokio lauko revolut neduoda ivesti is viso."* Montonio's own docs
 * single out the same three as the international banks on this rail, the ones
 * that need `preferredCountry` set because they share a code across countries.
 *
 * Matched as a case-insensitive substring of Montonio's provider code, because
 * their exact code list is behind `GET /payment-methods` and is not reproduced
 * here. That is deliberate in both directions: a miss leaves us exactly where
 * we were before this file existed, and a hit only drops a field that is
 * additive - the code stays in the purpose either way.
 */
const NO_REFERENCE_FIELD = ['revolut', 'n26', 'wise'];

/**
 * The structured reference for a payment, or null when there is none to send.
 *
 * `purpose` is `merchant_invoices.payment_purpose` as the ledger holds it -
 * "1107 Vilija Juknaitė", "Už Vladą Buivį, Sofiją Buivytę", "Z2410 Brigita
 * Sprindienė". The code, when there is one, is its FIRST token: that is how
 * `detectRegistrationPurpose` and `detectPlotPurpose` compose the line, number
 * first precisely because the number is what the merchant's accounting matches
 * on.
 *
 * Returns null unless the merchant was switched on AND that first token is
 * digits only. Both halves matter:
 *
 * - `enabled` is `merchants.send_payment_reference`, off unless an operator
 *   turned it on. The extraction rule is general, so a merchant who never
 *   asked for any of this must not start sending a bank-validated field.
 * - A purpose beginning with a word ("Už ...") has no code at all, and one
 *   beginning with "Z2410" or "AA-017A" has one this field cannot carry.
 */
export function montonioReference(
  purpose: string | null | undefined,
  enabled: boolean | null | undefined,
  provider?: string | null
): string | null {
  if (enabled !== true) return null;
  const bank = (provider ?? '').toLowerCase();
  if (bank && NO_REFERENCE_FIELD.some(p => bank.includes(p))) return null;
  const first = (purpose ?? '').trim().split(/\s+/)[0] ?? '';
  return NUMERIC_CODE.test(first) ? first : null;
}
