/**
 * Where a ledger row came from, and what that means for sending it.
 *
 * ⚠️ **The old shape of this question was `!inv.sent_at` alone, and it was
 * wrong in front of a merchant.** An invoice the merchant had emailed
 * themselves and BCC'd to us carries no `sent_at` - because HexaBee never sent
 * it, and never will - so it sat under "Neišsiųsta" on the Invoices page while
 * the customer already had it in their inbox. Reported during a demo.
 *
 * `source = 'issued'` (2026-10-29, INVOICE_ISSUING.md) makes the same question
 * sharper still: HexaBee now produces the document for merchants whose
 * accounting cannot put a payment link in the email. An issued row that has
 * not gone out IS work waiting to be done, exactly like an uploaded one, while
 * a BCC row never is.
 *
 * Add another way for a row to arrive and change `InvoiceSource` here. The
 * `Record<InvoiceSource, …>` tables below then fail the build until every
 * surface says what it means, instead of one of them quietly guessing - which
 * is the trap `paid-source.ts` was written for after `'centas'` had already
 * reported two merchants' bank transfers as payments HexaBee had processed.
 */

export type InvoiceSource = 'bcc' | 'upload' | 'issued';

/**
 * One of ours, or `null` for anything else.
 *
 * ⚠️ **`null` here means "not a source this repository writes", which is NOT
 * the same fact as "the column was not served".** Collapsing the two was a
 * real bug in the first version of this file, caught by
 * `npm run verify:invoice-source`: an unrecognised value read as "column
 * absent", which `awaitingSend` treats as still waiting - so the portal would
 * have offered a send that `SENDABLE_SOURCES` refuses. The two cases are told
 * apart in `awaitingSend` below, not here.
 */
export function invoiceSourceKey(value: string | null | undefined): InvoiceSource | null {
  if (value === 'bcc') return 'bcc';
  if (value === 'upload') return 'upload';
  if (value === 'issued') return 'issued';
  return null;
}

/**
 * Was the column served at all?
 *
 * The merchant app can deploy ahead of a backend migration, so
 * `/api/merchant/invoices` serves `source` as `NULL::text` rather than failing
 * the whole ledger query. Guessing `'bcc'` for those rows would empty the "not
 * sent yet" group and silently lose a month of real work; guessing `'upload'`
 * would put every BCC row back into it. So they keep the old, safe answer.
 */
function columnAbsent(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Is HexaBee the one that delivers this invoice to the payer?
 *
 * ⚠️ This must agree with `SENDABLE_SOURCES` in
 * `hexabee-backend/app/invoice_sender.py`, which is what actually refuses a
 * send. A screen offering to send what the backend will decline is the worse
 * half of the disagreement: the merchant presses the button and nothing
 * happens, with no reason given.
 */
const SENDS_FROM_HEXABEE: Record<InvoiceSource, boolean> = {
  // The merchant emailed this invoice to that very payer and copied us. Sending
  // it would be a second copy of a document the customer already holds.
  bcc: false,
  upload: true,
  issued: true,
};

/**
 * Is this row still waiting for HexaBee to send it?
 *
 * Three answers, not two, and the middle one is the whole reason this function
 * is not a one-liner:
 *
 * - **The column was not served** (see `columnAbsent`): treated as waiting,
 *   which is what every row did before `source` existed. Over-reporting work
 *   is recoverable; hiding it is not.
 * - **A value nothing here writes**: NOT waiting. `SENDABLE_SOURCES` in
 *   `hexabee-backend/app/invoice_sender.py` refuses it, so listing it would
 *   offer a button that does nothing with no reason shown.
 * - **One of ours**: whatever `SENDS_FROM_HEXABEE` says.
 */
export function awaitingSend(
  inv: { sent_at: string | null; sms_sent_at: string | null; source: string | null }
): boolean {
  if (inv.sent_at || inv.sms_sent_at) return false;
  if (columnAbsent(inv.source)) return true;
  const key = invoiceSourceKey(inv.source);
  if (key === null) return false;
  return SENDS_FROM_HEXABEE[key];
}

/**
 * Did HexaBee produce this document? Decides whether the merchant may
 * regenerate or renumber it - we own what we issued, and we must never offer
 * to rewrite a document the merchant's own accounting is the author of.
 */
export function issuedByHexabee(value: string | null | undefined): boolean {
  return invoiceSourceKey(value) === 'issued';
}
