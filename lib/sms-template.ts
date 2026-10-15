/**
 * The SMS a merchant sends to a customer who has no email address, and what it
 * costs them.
 *
 * Why this exists at all: SB „Žaluma" has plot owners reachable only by
 * telephone, and the payer inbox cannot serve them - it verifies by email,
 * which is exactly what they lack. So their link has to carry the reference
 * (`?r=`) and arrive by SMS.
 *
 * ⚠️ **The pricing rule is the whole point of this file.** One Lithuanian
 * diacritic switches the message from GSM-7 to UCS-2 and the per-segment
 * budget drops from 160 characters to 70 - so a single `ė` can double what a
 * 700-recipient batch costs. Tele2 put it plainly: do not exceed 70 characters
 * when using Lithuanian letters. The merchant has to see that while typing,
 * which is why the count runs here in the browser rather than on the server.
 *
 * Which means this is a **second implementation of one rule**, mirroring
 * `segments()` in `hexabee-backend/app/sms_sender.py`. That is the trap this
 * codebase keeps paying for, so two things guard it: the backend's
 * `scripts/check_sms.py` pins the boundaries with real cases, and
 * `/api/merchant/sms/preview` returns the server's own answer when the
 * merchant stops typing, so a disagreement shows up on screen instead of on a
 * bill.
 */

/** Fixed and language-independent, like the email template's tokens: a saved
 *  template must not stop working because the portal was switched to English. */
export const SMS_TOKENS = ['name', 'invoice', 'amount', 'due', 'link'] as const;

/**
 * ⚠️ No Lithuanian diacritics in the Lithuanian default, deliberately.
 *
 * With them the budget is 70 characters and the pay link alone is about 50,
 * which leaves no room for a sentence. Without them it is 160 and the whole
 * message is one segment - €18 rather than €36 across 700 plots.
 *
 * Gytis's decision (2026-10-15): do not shorten the link, and let the merchant
 * write what they want - if it runs long they pay for the extra segments. So
 * this is a starting point, not a constraint, and the editor prices whatever
 * they type.
 *
 * Must stay identical to DEFAULT_TEMPLATE in sms_sender.py: the merchant
 * proofreads this text and the backend sends it.
 */
export const SMS_DEFAULT_TEMPLATE: Record<'lt' | 'en', string> = {
  lt: '{invoice}: {amount}. Apmoketi: {link}',
  en: 'Invoice {invoice}: {amount}. Pay: {link}',
};

/** Tele2's own maxima from their OpenAPI spec - 480 latin, 210 non-latin.
 *  Both work out to three segments, which is a useful check on the maths. */
const MAX_UNITS_GSM = 480;
const MAX_UNITS_UNICODE = 210;

// GSM 03.38 default alphabet. Lithuanian ąčęėįšųūž are NOT in it, which is the
// entire reason this file exists.
const GSM7 = new Set(
  ('@£$¥èéùìòÇ\nØø\rÅå_ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿' +
    'abcdefghijklmnopqrstuvwxyzäöñüà' +
    'ΔΦΓΛΩΠΨΣΘΞ').split('')
);
// Real GSM-7 characters that cost two septets each rather than one.
const GSM7_EXT = new Set('^{}\\[~]|€'.split(''));

export type SmsCost = {
  encoding: 'gsm7' | 'unicode';
  chars: number;
  /** Billable units - not the same as characters once an extension character
   *  or an emoji is involved. */
  units: number;
  segments: number;
  /** Units available in a single-segment message: 160 or 70. */
  limit: number;
  /** Past what Tele2 will accept at all, so the send would be refused. */
  overLimit: boolean;
};

/**
 * What the network will bill for this text.
 *
 * Mirrors `segments()` in sms_sender.py, including the multipart sizes: a
 * concatenated message spends 7 bits per part on the UDH, so the per-part
 * budget falls from 160 to 153 (and from 70 to 67). That is why 161 characters
 * is two segments and not "one and a bit".
 */
export function smsSegments(text: string): SmsCost {
  const body = String(text ?? '');
  const chars = Array.from(body);
  const unicodeNeeded = chars.some((ch) => !GSM7.has(ch) && !GSM7_EXT.has(ch));

  let units: number;
  let single: number;
  let multi: number;

  if (unicodeNeeded) {
    // UCS-2: anything outside the BMP (emoji) takes two units.
    units = chars.reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0);
    single = 70;
    multi = 67;
  } else {
    units = chars.reduce((n, ch) => n + (GSM7_EXT.has(ch) ? 2 : 1), 0);
    single = 160;
    multi = 153;
  }

  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);

  return {
    encoding: unicodeNeeded ? 'unicode' : 'gsm7',
    // Code points rather than UTF-16 units, so an emoji counts as one
    // character to the reader even though it costs two.
    chars: chars.length,
    units,
    segments,
    limit: single,
    overLimit: units > (unicodeNeeded ? MAX_UNITS_UNICODE : MAX_UNITS_GSM),
  };
}

/** Replace the known tokens and leave anything else exactly as typed, so a
 *  merchant who writes {nuoroda} sees their own mistake in the preview rather
 *  than a hole in the message. Matches `render()` in sms_sender.py. */
export function renderSmsTemplate(text: string, vars: Partial<Record<(typeof SMS_TOKENS)[number], string>>): string {
  let out = String(text ?? '');
  for (const token of SMS_TOKENS) {
    out = out.split(`{${token}}`).join(vars[token] ?? '');
  }
  return out;
}

/**
 * Stand-ins the same LENGTH as the real values, for pricing a template before
 * any invoice exists.
 *
 * The link matters most: at ~50 characters it is the majority of the message,
 * so a preview that used a short placeholder would quote one segment where the
 * real send costs two. `{link}` is six characters and the thing it becomes is
 * fifty.
 */
export function smsSampleVars(slug: string | null | undefined, checkoutUrl: string) {
  return {
    name: 'Vardas Pavardyte',
    invoice: 'INV000001',
    amount: '60.00 EUR',
    due: '2026-10-31',
    link: `${checkoutUrl.replace(/\/$/, '')}/pay/${slug || 'merchant'}?r=INV000001`,
  };
}

/** Tele2's stated per-account ceiling. Not a limit we impose - one we cannot
 *  read back, so it is shown next to a count we keep ourselves. */
export const SMS_MONTHLY_LIMIT = 10000;

/** Tele2 self-service rate, excl. VAT. Displayed as an estimate and labelled as
 *  one: the API price was asked for and has not been answered. */
export const SMS_PRICE_PER_SEGMENT = 0.026;
