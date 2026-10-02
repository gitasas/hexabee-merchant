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
export const TEMPLATE_TOKENS = ['name', 'invoice', 'amount', 'due'] as const;
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
};

export const DEFAULT_TEMPLATE: Record<'en' | 'lt', { subject: string; body: string }> = {
  en: {
    subject: 'Invoice {invoice}',
    body: `Hello,

please find attached invoice {invoice} for {amount}.

You can pay it with the link below - choose your bank and confirm; nothing needs to be copied by hand.

Thank you.`,
  },
  lt: {
    subject: 'Sąskaita {invoice}',
    body: `Sveiki,

siunčiame sąskaitą {invoice}, suma {amount}.

Apmokėti galite paspaudę žemiau esančią nuorodą - pasirinksite savo banką ir patvirtinsite, nieko perrašinėti nereikia.

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
