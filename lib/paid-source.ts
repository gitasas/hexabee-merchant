/**
 * Who closed this invoice, and did a HexaBee payment stand behind it?
 *
 * ⚠️ **This exists because the old shape of the question was
 * `paid_source === 'manual' ? 'marked by hand' : 'HexaBee'`, and that answer
 * is wrong the moment a third way of closing a row exists.** The Centas
 * reader (`hexabee-backend/app/centas.py`, 2026-10-23) writes
 * `paid_source = 'centas'` for an invoice the merchant's own accounting says
 * was settled by an ordinary bank transfer. Under the old branch every one of
 * those rows reported **"HexaBee"** - in the merchant's accounting CSV, to
 * their accountant, claiming we had processed money we never touched.
 *
 * That is also the figure HexaBee's own monthly invoice rests on: €0.39 is
 * charged per payment **we** handled, read from `merchant_payments`, and a
 * Centas-closed row has no payment row at all. Reporting it as ours is an
 * accounting error in the one direction that overcharges a customer.
 *
 * Add another way of closing a row and change `PaidSource` here - the
 * compiler then names every surface that has to say something about it,
 * instead of each one quietly defaulting to "HexaBee". That is not theory:
 * adding `'rivile'` on 2026-10-26 did exactly that, and the two labels below
 * were the only places that needed touching.
 */

export type PaidSource = 'hexabee' | 'manual' | 'centas' | 'rivile';

/**
 * ⚠️ **NULL means `hexabee`, and that is deliberate rather than a fallback.**
 * Rows settled before this column existed could only have been closed by a
 * webhook - marking an invoice paid by hand did not exist yet - so a HexaBee
 * payment really does stand behind them. Any unrecognised value reads the
 * same way, because every writer of this column is in this repository and a
 * value from nowhere else is far more likely to be an old webhook row than a
 * new kind of settlement nobody wired up.
 */
export function paidSourceKey(value: string | null | undefined): PaidSource {
  if (value === 'manual') return 'manual';
  if (value === 'centas') return 'centas';
  if (value === 'rivile') return 'rivile';
  return 'hexabee';
}

/**
 * Did money actually move through HexaBee for this row? This is the question
 * the monthly invoice and the merchant's reconciliation both ask, and the only
 * one where getting it wrong costs somebody money.
 */
export function hexabeeProcessed(value: string | null | undefined): boolean {
  return paidSourceKey(value) === 'hexabee';
}

/**
 * Can the merchant reopen this row?
 *
 * Only a row they closed by hand. A webhook-settled row records money that
 * really arrived and the payer holds a receipt for it; a Centas-settled row
 * reflects their own accounting, so reopening it here would start the
 * reminders again for an invoice their bookkeeper has already closed - and the
 * next hourly pass would simply close it a second time.
 */
export function canReopen(value: string | null | undefined): boolean {
  return paidSourceKey(value) === 'manual';
}
