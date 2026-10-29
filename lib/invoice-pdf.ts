/**
 * The invoice document HexaBee issues on a merchant's behalf.
 *
 * Merchant-agnostic on purpose: everything specific to a merchant arrives as
 * data, so the same generator serves a school billing parents, a camp billing
 * participants and anyone after them. Design and reasoning in
 * `INVOICE_ISSUING.md`; this file holds the four rules that cost money if they
 * are got wrong.
 *
 * **1. Money is integer cents, everywhere, and that is not fussiness.** The
 * merchant's own spreadsheet literally contains `109.20000000000002` - the
 * float noise is in the source data, not introduced by us - and an invoice that
 * adds up to a hundredth of a cent off is a document their accountant will
 * reject. Callers convert once, at the edge, and round there.
 *
 * **2. `amount` per line is authoritative; `unitPrice` is documentation.**
 * Measured on Baltijos licėjus' real September sheet: the amount columns sum to
 * the merchant's own stated total in all 54 rows, but `qty × rate` disagrees in
 * one of them - a hand override where 21 × 4,80 was written as 54,60.
 * Recomputing would have invoiced that family €76,20 instead of €30,00. So the
 * unit price is printed only when it multiplies out to the amount; otherwise
 * the line shows the quantity and the amount and no rate, because arithmetic
 * that does not add up on the page is worse than arithmetic left off it.
 *
 * **3. This file is the ONLY place that computes what the payer owes.** The
 * ledger row's `amount` and the figure printed on the document must come from
 * one calculation, or the pay link charges something the PDF does not say -
 * which is the `/payment-success` "Paskirtis" disagreement of 2026-10-05, in
 * the one place where it would be about money. `computePayable` is exported for
 * exactly that reason: the caller stores what the document says, never its own
 * sum.
 *
 * **4. Unknown is never rendered as zero.** `openingBalance === null` means we
 * could not read the carried-over balance (it lives in the merchant's
 * accounting, not in their spreadsheet). The balance block is then omitted
 * entirely and the result says `balanceKnown: false`, so the caller can refuse
 * to send rather than mail a parent in credit a link to pay again.
 */

import type { jsPDF as JsPdfType } from 'jspdf';

/** The family name the embedded Noto Sans registers under. */
const PDF_FONT = 'NotoSans';

export type InvoiceLine = {
  description: string;
  /** Printed beside the description ("21 vnt."). Documentation, not input. */
  qty?: number | null;
  unit?: string | null;
  /** Integer cents. Printed only when `qty × unitPrice` equals `amount`. */
  unitPrice?: number | null;
  /** Integer cents. ⚠️ Authoritative - see rule 2. May be zero or negative. */
  amount: number;
};

export type InvoiceSeller = {
  /** `merchants.business_name` - the payee the payer already sees. */
  name: string;
  companyCode?: string | null;
  /** NULL for a merchant who is not VAT-registered; the label is then omitted. */
  vatCode?: string | null;
  address?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
};

export type InvoiceBuyer = {
  name: string;
  address?: string | null;
  email?: string | null;
  /**
   * The payer's own number as their invoices print it ("Registracijos nr.:
   * 1031"). Not an invoice number and never a ledger key - see CLAUDE.md, where
   * a real production row was once stored under `1070`.
   */
  reference?: string | null;
};

export type InvoiceVat =
  /** Not VAT-registered: no VAT column, no VAT line, nothing implied. */
  | { kind: 'none' }
  /**
   * VAT-registered. ⚠️ `rate` 0 is an ANSWER, not a missing value: Kauno
   * Valdorfo mokykla carry a VAT code and print `PVM, % = 0.00` on every line.
   * `amountsIncludeVat` may only be omitted when the rate is 0, because with a
   * real rate it decides what the payer is charged - see `assertVatAnswerable`.
   */
  | { kind: 'registered'; rate: number; amountsIncludeVat?: boolean | null };

export type InvoiceDoc = {
  number: string;
  /** `YYYY-MM-DD`. The date on the document, never "today" at render time. */
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  seller: InvoiceSeller;
  buyer: InvoiceBuyer;
  lines: InvoiceLine[];
  vat: InvoiceVat;
  /**
   * Integer cents carried over from before this invoice, or **null for
   * unknown** - see rule 4. A credit is negative, which is the case that makes
   * this load-bearing: 24 of 78 of this merchant's October invoices owed
   * nothing.
   */
  openingBalance?: number | null;
  /** What the payer's bank statement should carry ("Už Rytį Černiauską"). */
  paymentPurpose?: string | null;
  /** Free text under the table - the merchant's own footer note. */
  note?: string | null;
  /** "Sąskaitą išrašė ..." plus a signature rule, as their document has it. */
  issuedBy?: string | null;
  /** Spell the total out in words. Off unless the merchant's invoice does it. */
  amountInWords?: boolean;
  lang?: 'lt' | 'en';
};

export type RenderedInvoice = {
  bytes: Uint8Array;
  /** Integer cents. ⚠️ Store THIS on the ledger row, never a second sum. */
  payable: number;
  /** Sum of the lines alone, before any carried-over balance. */
  linesTotal: number;
  vatAmount: number;
  /** False when `openingBalance` was null - the document states no debt. */
  balanceKnown: boolean;
  /** True when the embedded Unicode font registered; false means ASCII. */
  unicode: boolean;
};

// ── Money ───────────────────────────────────────────────────────────────────

/** Integer cents to "1 043,40". A non-breaking space groups thousands. */
function fmt(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${grouped},${frac}`;
}

/** Cents to a rate with up to four decimals, trailing zeros trimmed. */
function fmtRate(cents: number): string {
  const v = cents / 100;
  return v.toFixed(2).replace('.', ',');
}

/**
 * Is this line's unit price safe to print?
 *
 * Only when it multiplies out. See rule 2 - and note that `qty` is a decimal
 * in real data (`1.5` portions), so the product is rounded before comparing.
 */
export function unitPricePrintable(line: InvoiceLine): boolean {
  if (line.unitPrice == null || line.qty == null) return false;
  if (!Number.isFinite(line.unitPrice) || !Number.isFinite(line.qty)) return false;
  return Math.round(line.unitPrice * line.qty) === Math.round(line.amount);
}

/**
 * ⚠️ Refuse to render rather than guess what the payer is charged.
 *
 * With a real VAT rate, whether the merchant's figures already include it moves
 * the total by that rate in one direction or the other. That is the same class
 * of mistake as grossing a fee up twice, and it reaches the payer's bank app.
 */
export function assertVatAnswerable(vat: InvoiceVat): void {
  if (vat.kind !== 'registered') return;
  if (!Number.isFinite(vat.rate) || vat.rate < 0) {
    throw new Error('invoice-pdf: VAT rate must be a non-negative number');
  }
  if (vat.rate > 0 && (vat.amountsIncludeVat === null || vat.amountsIncludeVat === undefined)) {
    throw new Error(
      'invoice-pdf: amountsIncludeVat is unanswered and the VAT rate is not zero - ' +
        'rendering would decide what the payer is charged. Ask the merchant.'
    );
  }
}

/**
 * What the payer owes, and the only calculation of it.
 *
 * `lines` are the merchant's own authoritative amounts, so they are summed and
 * never re-derived. VAT is added only when the figures were stated net; when
 * they were stated gross the VAT is backed out for the document's own VAT line
 * and the total is unchanged - the payer pays what the merchant's sheet said
 * either way.
 */
export function computePayable(doc: InvoiceDoc): {
  linesTotal: number;
  net: number;
  vatAmount: number;
  gross: number;
  payable: number;
  balanceKnown: boolean;
} {
  assertVatAnswerable(doc.vat);
  const linesTotal = doc.lines.reduce((sum, l) => sum + Math.round(l.amount), 0);

  let net = linesTotal;
  let vatAmount = 0;
  if (doc.vat.kind === 'registered' && doc.vat.rate > 0) {
    const r = doc.vat.rate / 100;
    if (doc.vat.amountsIncludeVat) {
      net = Math.round(linesTotal / (1 + r));
      vatAmount = linesTotal - net;
    } else {
      vatAmount = Math.round(linesTotal * r);
    }
  }
  const gross = net + vatAmount;

  const balanceKnown = doc.openingBalance !== null && doc.openingBalance !== undefined;
  const payable = gross + (balanceKnown ? Math.round(doc.openingBalance as number) : 0);
  return { linesTotal, net, vatAmount, gross, payable, balanceKnown };
}

// ── The total in words (Lithuanian) ─────────────────────────────────────────

const ONES = ['', 'vienas', 'du', 'trys', 'keturi', 'penki', 'šeši', 'septyni', 'aštuoni', 'devyni'];
const TEENS = ['dešimt', 'vienuolika', 'dvylika', 'trylika', 'keturiolika', 'penkiolika',
  'šešiolika', 'septyniolika', 'aštuoniolika', 'devyniolika'];
const TENS = ['', '', 'dvidešimt', 'trisdešimt', 'keturiasdešimt', 'penkiasdešimt',
  'šešiasdešimt', 'septyniasdešimt', 'aštuoniasdešimt', 'devyniasdešimt'];

/**
 * ⚠️ The same three-way rule as `_lt_plural` in `reminders.py`: Lithuanian
 * numerals decline, and a wrong form on a document reads as carelessness on a
 * page about somebody's money.
 */
function ltForm(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 === 0 || (mod100 >= 11 && mod100 <= 19)) return many;
  return few;
}

function under1000(n: number): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) out.push(h === 1 ? 'šimtas' : `${ONES[h]} šimtai`);
  if (rest >= 10 && rest <= 19) out.push(TEENS[rest - 10]);
  else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t > 0) out.push(TENS[t]);
    if (o > 0) out.push(ONES[o]);
  }
  return out;
}

/**
 * "1043" to "vienas tūkstantis keturiasdešimt trys".
 *
 * Masculine forms throughout, because the euro is masculine in Lithuanian -
 * their own invoice reads "Vienas tūkstantis keturiasdešimt trys Eur".
 * Above 999 999 it returns null and the caller prints digits: a wrong word is
 * worse than no words, and nothing this product bills reaches a million.
 */
export function ltWholeInWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return null;
  if (n === 0) return 'nulis';
  const words: string[] = [];
  const thousands = Math.floor(n / 1000);
  if (thousands > 0) {
    if (thousands !== 1) words.push(...under1000(thousands));
    else words.push('vienas');
    words.push(ltForm(thousands, 'tūkstantis', 'tūkstančiai', 'tūkstančių'));
  }
  const rest = n % 1000;
  if (rest > 0) words.push(...under1000(rest));
  return words.join(' ');
}

/** "1 043,40" to "Vienas tūkstantis keturiasdešimt trys Eur 40 ct". */
export function amountInWordsLt(cents: number, currency: string): string | null {
  if (cents < 0) return null;
  const whole = Math.floor(Math.round(cents) / 100);
  const frac = Math.round(cents) % 100;
  const words = ltWholeInWords(whole);
  if (!words) return null;
  const unit = currency.toUpperCase() === 'EUR' ? 'Eur' : currency.toUpperCase();
  const capped = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capped} ${unit} ${frac.toString().padStart(2, '0')} ct`;
}

// ── Strings ─────────────────────────────────────────────────────────────────

const STRINGS = {
  lt: {
    title: 'SĄSKAITA FAKTŪRA',
    titleVat: 'PVM SĄSKAITA FAKTŪRA',
    number: 'Nr.',
    issueDate: 'Sąskaitos data',
    dueDate: 'Apmokėti iki',
    seller: 'Pardavėjas',
    buyer: 'Pirkėjas',
    companyCode: 'Įm. k.',
    vatCode: 'PVM k.',
    bank: 'Bankas',
    account: 'Banko sąskaitos numeris',
    colDesc: 'Prekė / paslauga',
    colQty: 'Kiekis',
    colPrice: 'Kaina',
    colVatPct: 'PVM, %',
    colVat: 'PVM',
    colSum: 'Suma',
    net: 'Suma be PVM',
    vat: 'PVM',
    gross: 'Bendra suma',
    balance: 'Pradinis įsiskolinimas',
    payable: 'IŠ VISO MOKĖTI',
    purpose: 'Mokėjimo paskirtis',
    issuedBy: 'Sąskaitą išrašė',
    nothingToPay: 'Šią sąskaitą apmokėti nereikia.',
  },
  en: {
    title: 'INVOICE',
    titleVat: 'VAT INVOICE',
    number: 'No.',
    issueDate: 'Invoice date',
    dueDate: 'Due date',
    seller: 'Seller',
    buyer: 'Buyer',
    companyCode: 'Company code',
    vatCode: 'VAT code',
    bank: 'Bank',
    account: 'Account number',
    colDesc: 'Description',
    colQty: 'Qty',
    colPrice: 'Price',
    colVatPct: 'VAT, %',
    colVat: 'VAT',
    colSum: 'Amount',
    net: 'Subtotal',
    vat: 'VAT',
    gross: 'Total',
    balance: 'Previous balance',
    payable: 'TOTAL DUE',
    purpose: 'Payment reference',
    issuedBy: 'Issued by',
    nothingToPay: 'Nothing to pay on this invoice.',
  },
} as const;

/** Characters the embedded subset covers. Anything else is dropped. */
function pdfSafe(value: string): string {
  return value.replace(/[^ -~ -ſ‐-―‘-„…€]/g, '');
}

const FOLD: Record<string, string> = {
  ą: 'a', č: 'c', ę: 'e', ė: 'e', į: 'i', š: 's', ų: 'u', ū: 'u', ž: 'z',
  Ą: 'A', Č: 'C', Ę: 'E', Ė: 'E', Į: 'I', Š: 'S', Ų: 'U', Ū: 'U', Ž: 'Z',
  '€': 'EUR', ' ': ' ',
};

/** The fallback if the embedded font ever fails to register - see the receipt. */
function asciiFold(value: string): string {
  return value
    .replace(/[ąčęėįšųūžĄČĘĖĮŠŲŪŽ€ ]/g, ch => FOLD[ch] ?? ch)
    .replace(/[^ -~]/g, '');
}

function unicodeFontWorks(doc: JsPdfType): boolean {
  try {
    for (const style of ['normal', 'bold']) {
      doc.setFont(PDF_FONT, style);
      if (!(doc.getTextWidth('Sąskaita €') > 0)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── The document ────────────────────────────────────────────────────────────

const M = 16;          // page margin, mm
const LINE = 4.6;      // body line height, mm

export async function renderInvoicePdf(invoice: InvoiceDoc): Promise<RenderedInvoice> {
  const totals = computePayable(invoice);
  const lang = invoice.lang ?? 'lt';
  const t = STRINGS[lang];
  const cur = invoice.currency.toUpperCase();
  const showVat = invoice.vat.kind === 'registered' && invoice.vat.rate > 0;
  const vatRate = invoice.vat.kind === 'registered' ? invoice.vat.rate : 0;

  const [{ jsPDF }, { NOTO_SANS_REGULAR_BASE64, NOTO_SANS_BOLD_BASE64 }] = await Promise.all([
    import('jspdf'),
    import('./pdf-font'),
  ]);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR_BASE64);
  doc.addFont('NotoSans-Regular.ttf', PDF_FONT, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', NOTO_SANS_BOLD_BASE64);
  doc.addFont('NotoSans-Bold.ttf', PDF_FONT, 'bold');

  // Never assume that worked. An invoice in folded ASCII is a defective-looking
  // document but still a document; a thrown error is a merchant who cannot
  // invoice at all. The reason is logged and reported in the result.
  const unicode = unicodeFontWorks(doc);
  const font = unicode ? PDF_FONT : 'helvetica';
  const s = unicode ? pdfSafe : asciiFold;
  if (!unicode) {
    console.error(
      '[invoice-pdf] the embedded Noto Sans did not register - falling back to ASCII. ' +
        'If lib/pdf-font.ts was regenerated, check its name table: see the header of that file.'
    );
  }

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const right = pageW - M;
  let y = M + 4;

  const put = (text: string, x: number, opts?: { align?: 'left' | 'right' | 'center' }) =>
    doc.text(s(text), x, y, opts);

  // Header: title and number left, dates right.
  doc.setFont(font, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(22, 24, 29);
  put(showVat || invoice.vat.kind === 'registered' ? t.titleVat : t.title, M);
  doc.setFontSize(11);
  put(`${t.issueDate}: ${invoice.issueDate}`, right, { align: 'right' });
  y += 6;
  doc.setFontSize(12);
  put(`${t.number} ${invoice.number}`, M);
  if (invoice.dueDate) {
    doc.setFont(font, 'normal');
    doc.setFontSize(11);
    put(`${t.dueDate}: ${invoice.dueDate}`, right, { align: 'right' });
  }
  y += 5;
  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(0.5);
  doc.line(M, y, right, y);
  y += 7;

  // Parties, side by side. Each block is built as lines first so the taller one
  // sets the height - a buyer with no address must not pull the table up.
  const sellerLines = [invoice.seller.name];
  if (invoice.seller.companyCode) sellerLines.push(`${t.companyCode} ${invoice.seller.companyCode}`);
  if (invoice.seller.vatCode) sellerLines.push(`${t.vatCode} ${invoice.seller.vatCode}`);
  if (invoice.seller.address) sellerLines.push(invoice.seller.address);
  if (invoice.seller.bankName) sellerLines.push(`${t.bank}: ${invoice.seller.bankName}`);
  if (invoice.seller.accountNumber) sellerLines.push(`${t.account}: ${invoice.seller.accountNumber}`);

  const buyerLines = [invoice.buyer.name];
  if (invoice.buyer.reference) buyerLines.push(invoice.buyer.reference);
  if (invoice.buyer.address) buyerLines.push(invoice.buyer.address);
  if (invoice.buyer.email) buyerLines.push(invoice.buyer.email);

  const colW = (right - M - 8) / 2;
  const bx = M + colW + 8;
  doc.setFontSize(8);
  doc.setTextColor(107, 112, 120);
  doc.setFont(font, 'bold');
  put(t.seller.toUpperCase(), M);
  put(t.buyer.toUpperCase(), bx);
  y += 5;
  doc.setFontSize(9.5);
  doc.setTextColor(22, 24, 29);

  const blockTop = y;
  for (const [i, text] of sellerLines.entries()) {
    doc.setFont(font, i === 0 ? 'bold' : 'normal');
    for (const wrapped of doc.splitTextToSize(s(text), colW) as string[]) {
      doc.text(wrapped, M, y);
      y += LINE;
    }
  }
  const sellerBottom = y;
  y = blockTop;
  for (const [i, text] of buyerLines.entries()) {
    doc.setFont(font, i === 0 ? 'bold' : 'normal');
    for (const wrapped of doc.splitTextToSize(s(text), colW) as string[]) {
      doc.text(wrapped, bx, y);
      y += LINE;
    }
  }
  y = Math.max(sellerBottom, y) + 7;

  // Line table. Columns are laid out from the right so the money stays aligned
  // whatever the description does.
  const xSum = right;
  const xVat = showVat ? xSum - 22 : xSum;
  const xVatPct = showVat ? xVat - 15 : xSum;
  const xPrice = (showVat ? xVatPct : xSum) - 22;
  const xQty = xPrice - 20;
  const descW = xQty - M - 6;

  doc.setFontSize(8);
  doc.setTextColor(107, 112, 120);
  doc.setFont(font, 'bold');
  put(t.colDesc.toUpperCase(), M);
  put(t.colQty.toUpperCase(), xQty, { align: 'right' });
  put(`${t.colPrice.toUpperCase()}, ${cur}`, xPrice, { align: 'right' });
  if (showVat) {
    put(t.colVatPct.toUpperCase(), xVatPct, { align: 'right' });
    put(`${t.colVat.toUpperCase()}, ${cur}`, xVat, { align: 'right' });
  }
  put(`${t.colSum.toUpperCase()}, ${cur}`, xSum, { align: 'right' });
  y += 2.5;
  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(0.4);
  doc.line(M, y, right, y);
  y += 5;

  doc.setFontSize(9.5);
  doc.setTextColor(22, 24, 29);
  doc.setFont(font, 'normal');
  for (const line of invoice.lines) {
    const wrapped = doc.splitTextToSize(s(line.description), descW) as string[];
    // Keep a row whole: break the page before it rather than through it.
    if (y + wrapped.length * LINE > pageH - M - 55) {
      doc.addPage();
      y = M + 4;
    }
    const rowTop = y;
    for (const part of wrapped) {
      doc.text(part, M, y);
      y += LINE;
    }
    const qtyText = line.qty == null ? '' : `${fmtRate(Math.round(line.qty * 100))}${line.unit ? ` ${line.unit}` : ''}`;
    if (qtyText) doc.text(s(qtyText), xQty, rowTop, { align: 'right' });
    // ⚠️ Rule 2: only when it multiplies out.
    if (unitPricePrintable(line)) {
      doc.text(fmt(line.unitPrice as number), xPrice, rowTop, { align: 'right' });
    }
    if (showVat) {
      doc.text(s(fmtRate(Math.round(vatRate * 100))), xVatPct, rowTop, { align: 'right' });
    }
    doc.text(fmt(line.amount), xSum, rowTop, { align: 'right' });
    y = Math.max(y, rowTop + LINE) + 1.2;
    doc.setDrawColor(227, 229, 233);
    doc.setLineWidth(0.2);
    doc.line(M, y - 0.6, right, y - 0.6);
  }

  // Totals, right-aligned in their own column.
  y += 5;
  const labelX = right - 42;
  const row = (label: string, value: string, bold = false) => {
    doc.setFont(font, bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 11.5 : 9.5);
    doc.text(s(label), labelX, y, { align: 'right' });
    doc.text(s(value), right, y, { align: 'right' });
    y += bold ? 6 : LINE + 0.6;
  };

  if (showVat) {
    row(`${t.net}, ${cur}`, fmt(totals.net));
    row(`${t.vat} ${fmtRate(Math.round(vatRate * 100))}%, ${cur}`, fmt(totals.vatAmount));
  }
  row(`${t.gross}, ${cur}`, fmt(totals.gross));
  // ⚠️ Rule 4: omitted entirely when unknown, never printed as 0,00.
  if (totals.balanceKnown && invoice.openingBalance !== 0) {
    row(`${t.balance}, ${cur}`, fmt(invoice.openingBalance as number));
  }
  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(0.5);
  doc.line(labelX - 20, y - 1, right, y - 1);
  y += 4;
  row(`${t.payable}, ${cur}`, fmt(totals.payable), true);

  // An invoice that settles to nothing or to a credit says so in words. The
  // same rule as `isSettledToNothing` elsewhere: the payer is entitled to the
  // statement, and it must not look like a demand.
  if (totals.payable <= 0) {
    doc.setFont(font, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(107, 112, 120);
    y += 2;
    put(t.nothingToPay, right, { align: 'right' });
    y += LINE;
    doc.setTextColor(22, 24, 29);
  }

  if (invoice.amountInWords && totals.payable > 0 && lang === 'lt') {
    const words = amountInWordsLt(totals.payable, cur);
    if (words) {
      y += 3;
      doc.setFont(font, 'normal');
      doc.setFontSize(9.5);
      put(words, right, { align: 'right' });
      y += LINE;
    }
  }

  if (invoice.paymentPurpose) {
    y += 6;
    doc.setFont(font, 'bold');
    doc.setFontSize(9.5);
    put(`${t.purpose}: ${invoice.paymentPurpose}`, M);
    y += LINE;
  }

  if (invoice.note) {
    y += 4;
    doc.setFont(font, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(107, 112, 120);
    for (const wrapped of doc.splitTextToSize(s(invoice.note), right - M) as string[]) {
      doc.text(wrapped, M, y);
      y += LINE - 0.6;
    }
    doc.setTextColor(22, 24, 29);
  }

  if (invoice.issuedBy) {
    y += 8;
    doc.setFont(font, 'normal');
    doc.setFontSize(9);
    put(`${t.issuedBy}: ${invoice.issuedBy}`, M);
    doc.text('_______________________', right, y, { align: 'right' });
  }

  const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  return {
    bytes,
    payable: totals.payable,
    linesTotal: totals.linesTotal,
    vatAmount: totals.vatAmount,
    balanceKnown: totals.balanceKnown,
    unicode,
  };
}
