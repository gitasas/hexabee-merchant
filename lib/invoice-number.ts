/**
 * The invoice number, read off a page of extracted PDF text.
 *
 * ⚠️ **This is one rule written twice.** `detectInvoiceNumber` in the parent
 * repo's `index.js` reads the same field for the BCC ledger and the batch
 * upload; this one reads it for the payer's PDF drop on `/pay/[slug]`. The
 * pair is what this project keeps getting wrong - the `maxOutputTokens`
 * ceiling, the payment purpose, the amount predicates - so the cases are
 * pinned on both sides: `npm run verify:invoice-number` here, and the same 19
 * cases in `scripts/check_invoice_number.js` there. Run both after touching
 * either.
 *
 * It lives in `lib/` rather than inside the route so a check can compile it
 * without pulling in `next/server` and pdf2json - the same reason
 * `lib/sms-template.ts` and `lib/invoice-amount.ts` are where they are.
 *
 * ## What was wrong here until 2026-10-28
 *
 * Three label regexes were tried in order and the FIRST match of the first one
 * that matched anything at all was the answer. Two faults followed, and the
 * second is the dangerous one:
 *
 *   - **A label the invoice does not spell out in full was not read at all.**
 *     The labels were `sąskaitos nr.`, `faktūros nr.`, `invoice no.`,
 *     `invoice nr.`, `PVM sąskaitos numeris` and `serija <x> nr.` - so a bare
 *     `Nr. DEMO-2026-0147` under a `SĄSKAITA` heading, an `Invoice:
 *     INV-2026-0088`, and `Invoice Number INV/2026/0088` (the word "number",
 *     in English) each came back null. Gemini goes first on this route, so the
 *     only symptom was that a perfectly clean invoice fell back to nothing
 *     whenever the model was unavailable or `GEMINI_API_KEY` was unset.
 *   - **A number belonging to somebody else became the answer.** The last
 *     pattern was `(?:^|\s)([A-Z]{0,4}\d{4,10})(?=\s)` - any run of four to
 *     ten digits anywhere on the page. `Telefono nr. 86012345` returned
 *     `86012345`; `Customer No. 44120` returned `44120`. On this route the
 *     number becomes the reference the payer pays against, and in the ledger
 *     it is the key a payment is matched on, so this is the same failure that
 *     once keyed a production row `1070` - a pupil's registration number -
 *     instead of `VAL24535` (2026-10-06). A plausible wrong key is worse than
 *     no key: no key sends the page to the model, a wrong one is believed.
 *
 * So the loose digit-run pattern is **gone**, not narrowed. An invoice that
 * prints its number with no label at all now reads null, which is the honest
 * answer - the model reads the page, and a payer sees an empty field rather
 * than a stranger's telephone number.
 */

// "Nr. VAL24535", "No. INV-2026-0088", "Invoice Number INV/2026/0088". The
// `nr`/`no`/`number` token eats its own full stop, or the capture keeps it and
// the ledger key carries a trailing period. `(?![\p{L}])` stops `no` matching
// inside a word.
const NUMBER_AFTER_NR_LABEL =
  /\b(?:numeris|number|nr|no)(?![\p{L}])\s*\.?\s*[:#]?\s*([\p{L}\p{N}][\p{L}\p{N}\/._-]*)/giu;

// A document label standing on its own: "Invoice: INV-2026-0088". The
// separator must be a colon, a hash or whitespace and never a hyphen - with a
// hyphen allowed, `inv` matches the prefix of the number itself and the
// capture keeps only "2026-0088".
const NUMBER_AFTER_DOC_LABEL =
  /\b(?:invoice|inv|s[aą]skait(?:a|os)|fakt[uū]r(?:a|os))(?:\s*[:#]\s*|\s+)([\p{L}\p{N}][\p{L}\p{N}\/._-]*)/giu;

// Labels that introduce a code naming the PAYER or the SELLER, never the
// document: a pupil's registration number, a customer number, a company
// registration number, a telephone number. Those lines sit in the buyer and
// seller blocks, which a reader that stopped at the first match never reached;
// this one walks the whole page, so it has to walk past them by name. Blocking
// one costs at most a model call; letting one through writes a reference no
// payment will ever match.
const NOT_A_DOCUMENT_NUMBER =
  /(?:^|[^\p{L}])(?:registracij|reg|mok[eė]tojo|kliento|moksleivio|mokinio|sutart|telefon|tel|mob|faks|fax|phone|[įi]mon[eė]s|customer|client|contract|pupil|student|vat|pvm)[\p{L}.]*\s*$/iu;

// Words the patterns above sometimes capture instead of the number: "Serija"
// out of "Serija VD Nr. 2026-05-127", "FAKTŪRA" out of "SĄSKAITA FAKTŪRA".
// `isPlausibleInvoiceNumber` already rejects every one of them, since none
// carries a digit; the list stays as the cheap explicit guard in front of it,
// so no label word can become a key even if that rule is ever loosened.
const LABEL_WORDS =
  /^(serija|series|nr|no|number|numeris|invoice|inv|saskaita|sąskaita|fakt|faktura|faktūra)$/i;

/**
 * The same test the ledger applies before it will accept a key: at least three
 * characters, at least one digit, and not a label word. Kept identical to
 * `isPlausibleInvoiceNumber` in `index.js` and `_usable_number` in
 * `inbound.py`.
 *
 * Judging what came back - rather than whether something came back - is what
 * lets the search keep looking instead of returning the first label word it
 * trips over.
 */
export function isPlausibleInvoiceNumber(value: string | null | undefined): boolean {
  if (!value || value === '-') return false;
  const v = String(value).trim();
  if (v.length < 3) return false;
  if (!/\d/.test(v)) return false;
  if (LABEL_WORDS.test(v)) return false;
  return true;
}

/**
 * Read the invoice number out of `text`, or return null.
 *
 * ⚠️ `text` is whatever `parsePdfBuffer` produced, which joins pdf2json's text
 * runs with a **space** - there are no newlines in production. Nothing here
 * may depend on a line break, which is why the check runs every case in both
 * shapes.
 *
 * Every match of every pattern is tried in document order and the first one
 * that passes `isPlausibleInvoiceNumber` wins. That is what makes the whole
 * "Serija" / "FAKTŪRA" family of label traps harmless, rather than one word at
 * a time.
 */
export function detectInvoiceNumber(text: string): string | null {
  if (!text) return null;

  const patterns: RegExp[] = [
    NUMBER_AFTER_NR_LABEL,
    NUMBER_AFTER_DOC_LABEL,
    /\b\d{4}\.\d{2}\.\d{2}\b/g,
    // The trailing groups matter: without them "INV-2026-0088" comes back as
    // "INV-2026", which has a digit and would therefore be believed.
    /\b[A-Z]{2,6}-\d{2,}(?:-\d+)*\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).trim();
      if (LABEL_WORDS.test(value)) continue;
      // Who the number belongs to is written to its left, so that is where it
      // has to be read from. 30 characters is enough for a label and its
      // separator and short enough not to reach the previous field.
      const index = match.index ?? 0;
      if (NOT_A_DOCUMENT_NUMBER.test(text.slice(Math.max(0, index - 30), index))) continue;
      if (!isPlausibleInvoiceNumber(value)) continue;
      return value;
    }
  }

  return null;
}
