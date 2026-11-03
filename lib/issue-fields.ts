/**
 * The fields behind the "what goes on the invoices HexaBee issues" card.
 *
 * ⚠️ **This card was owner-only until 2026-11-03, and that was wrong in
 * practice.** The reasoning recorded in the parent repo's `CLAUDE.md` was that
 * a letterhead is what a customer sees as the payee on an accounting document,
 * which is the same class of decision as the bank details. It reads well and it
 * cost real work: at both schools the **director owns the account while
 * somebody else does the invoicing** - Gintarė the administrator at Baltijos
 * licėjus, Asta the bookkeeper at Kauno Valdorfas - so filling in the school's
 * own address, its VAT code or its numbering needed the one person who never
 * opens the portal. Gytis's call: these are invoice details, staff enter them.
 *
 * **What that did NOT weaken.** The two decisions the owner rule exists for are
 * not on this form at all and are unchanged:
 *
 * - `business_name` - the payee a customer sees, and what the slug, pay link,
 *   QR and BCC address are built from.
 * - `iban` / `sort_code` / `account_number` - **where the money lands**. A
 *   phished staff password still cannot redirect a payout.
 *
 * Both live on `/api/merchant/profile` behind `ownerOnly`. What is here is what
 * the document *prints* and how it is *numbered* - a mistake shows up on the
 * preview the merchant approves before a single invoice is issued, and two of
 * the figures are refusal-checked against the merchant's own spreadsheet total
 * before anything is sent.
 *
 * ⚠️ **A field in neither this list nor the form is silently dropped**, because
 * the route sends on only the keys it knows - so a new input saves nothing at
 * all while the screen says "saved". `npm run verify:issue-fields` is what
 * notices: it reads the form itself and asserts every `lh.<field>` it touches
 * appears here.
 */

/** Everything the letterhead card may write. */
export const LETTERHEAD_FIELDS = [
  'invoice_address',
  'invoice_bank_name',
  'is_vat_payer',
  'invoice_vat_code',
  'invoice_vat_rate',
  'invoice_amounts_include_vat',
  'invoice_number_prefix',
  'invoice_number_format',
] as const;

/** This month's spreadsheet layout, saved from the issue screen. */
export const MAPPING_FIELD = 'invoice_import_mapping';

export type LetterheadField = (typeof LETTERHEAD_FIELDS)[number];

/** Every key the save endpoint will carry; anything else is dropped. */
export const SAVEABLE_FIELDS: readonly string[] = [
  ...LETTERHEAD_FIELDS,
  MAPPING_FIELD,
];
