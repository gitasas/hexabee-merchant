/**
 * One question, asked in one place: does this ledger invoice still want money?
 *
 * Until 2026-10-02 the answer was assumed - a row had an amount, so it was
 * payable. Baltijos licėjus' invoices showed that is not true. They apply the
 * parent's prepayment on the face of the invoice, so a document can read
 * "Bendra suma 1043,40" and then "Mokėti: 0,00", or even "Mokėti: -45,30" when
 * the parent has overpaid and the school owes them the difference.
 *
 * Such a row must still exist - the parent is entitled to the statement, and
 * the merchant to the record - but nothing may chase it, charge it, or count it
 * as outstanding. It must also never be marked `paid`: nobody paid anything,
 * and `paid` would put it in the dashboard's takings and in HexaBee's monthly
 * invoice to the merchant.
 *
 * Derived from the amount rather than stored in a column of its own, so it
 * cannot drift away from the number it describes. Import it; do not re-derive
 * it, or this becomes the seventh place that restates a rule.
 */
export function isPayable(amount: number | string | null | undefined): boolean {
  if (amount === null || amount === undefined || amount === '') return false;
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(',', '.'));
  return Number.isFinite(n) && n > 0;
}

/**
 * True when we know the amount and it leaves nothing to pay - i.e. the invoice
 * was read successfully and settles to zero or to a credit.
 *
 * Deliberately NOT the negation of `isPayable`: a row whose amount could not be
 * read at all is also "not payable", but that is a failure to be shown to the
 * merchant, not a balance to be reported to the payer. The two must stay
 * distinguishable, the same way "could not be read" and "no recipient yet" had
 * to be split on the Invoices page.
 */
export function isSettledToNothing(amount: number | string | null | undefined): boolean {
  if (amount === null || amount === undefined || amount === '') return false;
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(',', '.'));
  return Number.isFinite(n) && n <= 0;
}
