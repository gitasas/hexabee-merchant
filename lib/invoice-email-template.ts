/**
 * The letter a merchant sends with an invoice: what it says, and what we fill in.
 *
 * Today the merchant writes this by hand in Outlook, once per parent, every
 * month. The template is how that text moves into HexaBee without losing the
 * part that matters - their own words. We supply the link, the attachment and
 * the numbers; they supply the message.
 *
 * Shared by the Settings editor and the send path, so what a merchant proofreads
 * is exactly what goes out.
 */

/**
 * The tokens are fixed and language-independent on purpose.
 *
 * A merchant who switches the portal between Lithuanian and English must not
 * find that their saved template stopped working, and a template is data that
 * outlives whichever language it was written in. The legend beside the editor is
 * translated; the tokens themselves are not.
 */
export const TEMPLATE_TOKENS = ['name', 'invoice', 'amount', 'due', 'breakdown'] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

export type TemplateVars = {
  /** The payer, as the invoice prints them. */
  name?: string | null;
  /** Invoice number. */
  invoice?: string | null;
  /** Already formatted with its currency, e.g. "1 680,20 EUR". */
  amount?: string | null;
  /** Already formatted, or empty when the invoice names no deadline. */
  due?: string | null;
  /**
   * What the invoice charges for, one line each, already formatted as plain
   * text. Empty when the scanner found nothing itemised - which is why a
   * template should put it on a line of its own rather than inside a sentence.
   */
  breakdown?: string | null;
};

/**
 * ⚠️ `bodyNothing` is the body for an invoice that settles to zero or to a
 * credit. Such a letter carries **no pay link** (`isPayable` decides), so the
 * ordinary body would tell the reader to press a button that is not in the
 * message. At Baltijos licėjus that is 24 letters in 78 (2026-10-12).
 *
 * It is a fallback, not a second editable template: a merchant who wrote their
 * own body keeps it in both cases, because those are their words. Keep this in
 * step with `DEFAULT_TEMPLATE` in `hexabee-backend/app/invoice_sender.py` - the
 * preview renders from here and the send renders from there, so a difference
 * means the merchant proofreads one letter and sends another.
 */
export const DEFAULT_TEMPLATE: Record<
  'en' | 'lt',
  { subject: string; body: string; bodyNothing: string }
> = {
  en: {
    subject: 'Invoice {invoice}',
    body: `Hello,

here is invoice {invoice} for {amount}.

{breakdown}

You can pay it with the link below - choose your bank and confirm; nothing needs to be copied by hand.

Thank you.`,
    bodyNothing: `Hello,

here is invoice {invoice}.

{breakdown}

There is nothing to pay on it - it is sent for your records.

Thank you.`,
  },
  lt: {
    subject: 'Sąskaita {invoice}',
    body: `Sveiki,

siunčiame sąskaitą {invoice}, suma {amount}.

{breakdown}

Apmokėti galite paspaudę žemiau esančią nuorodą - pasirinksite savo banką ir patvirtinsite, nieko perrašinėti nereikia.

Ačiū.`,
    bodyNothing: `Sveiki,

siunčiame sąskaitą {invoice}.

{breakdown}

Pagal ją mokėti nieko nereikia - siunčiame susipažinti.

Ačiū.`,
  },
};

/**
 * Replace the tokens, and nothing else.
 *
 * An unknown token is left exactly as typed rather than blanked: a merchant who
 * mistypes `{vardas}` should see their own mistake in the preview, not a hole
 * where a name should be. A token with no value becomes an empty string, which
 * is why the default template does not put `{due}` in a sentence that would read
 * strangely without it - plenty of invoices name no deadline.
 */
export function renderTemplate(text: string, vars: TemplateVars): string {
  return String(text ?? '').replace(/\{(\w+)\}/g, (whole, token: string) => {
    if (!(TEMPLATE_TOKENS as readonly string[]).includes(token)) return whole;
    const value = vars[token as TemplateToken];
    return value === null || value === undefined ? '' : String(value);
  });
}
