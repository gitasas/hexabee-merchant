import type { ImportedInvoice } from './invoice-import';
import type { InvoiceLine } from './invoice-pdf';

/**
 * One invoice typed by hand, turned into the shape the rest of issuing uses.
 *
 * ⚠️ **It produces an `ImportedInvoice`, which is the whole point.** Issuing
 * already allocates the number, renders the document and writes the ledger row
 * (`app/api/merchant/invoices/import/issue`); the only thing that route cannot
 * do is start from anything but a spreadsheet. So this builds the same object
 * a sheet row produces, and every rule downstream - the generator, the payable,
 * the purpose, the QR, reminders, SMS and the Montonio reference - applies
 * unchanged. A second issuing path would be the one-rule-written-twice trap in
 * the one place where the two copies would disagree about money.
 *
 * Asked for after the Inga Motuzaitė demo: a lecturer invoicing a handful of
 * people has no spreadsheet to import, and uploading a PDF she would first have
 * to make elsewhere defeats the point.
 */

export type ManualLineInput = {
  description: string;
  /** As typed: "54.60" or "54,60". Negative is allowed - a discount line. */
  amount: string;
  /** Optional, printed only when it multiplies out - see `invoice-pdf.ts`. */
  qty?: string;
  unit?: string;
  unitPrice?: string;
};

export type ManualInvoiceInput = {
  payerName: string;
  /** The buyer's own details, printed on the document when a company. */
  companyCode?: string;
  vatCode?: string;
  address?: string;
  payerEmail?: string;
  payerEmailCc?: string;
  payerPhone?: string;
  /** What the payment is for, when the merchant wants it on the statement. */
  subjectName?: string;
  reference?: string;
  dueDate?: string;
  lines: ManualLineInput[];
};

export type ManualBuildResult =
  | { ok: true; invoice: ImportedInvoice }
  | { ok: false; error: string; field?: string };

/**
 * Money as the merchant typed it, in integer cents.
 *
 * ⚠️ Accepts a comma, because a Lithuanian keyboard produces one and a form
 * that silently reads "54,60" as 54 would invoice a customer for a hundredth
 * of what they owe. Rejects anything else outright rather than coercing - the
 * importer's own rule, where `Number('')` being a finite 0 once turned an
 * unreadable total into a nil invoice.
 */
export function moneyToCents(raw: string): number | null {
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s || !/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

function qtyToNumber(raw: string | undefined): number | null {
  if (raw === undefined || String(raw).trim() === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What one typed line comes to, in integer cents, or null when it says nothing.
 *
 * ⚠️ **Exported so the screen and the server cannot disagree (2026-11-09).**
 * The form had its own little parser for the running total, and it reproduced
 * the exact trap this codebase already records for the spreadsheet reader:
 * `Number('')` is a finite **0**. An empty quantity beside a price of 10,00
 * therefore read as 0 x 10 = 0, the line counted as usable, and the issue
 * button lit up for an invoice the server would then refuse. Found by
 * exploratory testing, not by any check.
 *
 * The rule: a typed amount wins, otherwise quantity times price, and
 * otherwise nothing - never zero.
 */
export function lineAmountCents(line: ManualLineInput): number | null {
  const typed = (line.amount ?? '').trim();
  if (typed !== '') return moneyToCents(typed);
  const qty = qtyToNumber(line.qty);
  const unitPrice = line.unitPrice ? moneyToCents(line.unitPrice) : null;
  if (qty === null || unitPrice === null) return null;
  return Math.round(qty * unitPrice);
}


export function buildManualInvoice(input: ManualInvoiceInput): ManualBuildResult {
  const payerName = (input.payerName ?? '').trim();
  if (!payerName) return { ok: false, error: 'no_payer_name', field: 'payerName' };

  const rawLines = (input.lines ?? []).filter(
    l => (l?.description ?? '').trim() !== '' || (l?.amount ?? '').trim() !== ''
  );
  if (!rawLines.length) return { ok: false, error: 'no_lines' };

  const lines: InvoiceLine[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const l = rawLines[i];
    const description = (l.description ?? '').trim();
    if (!description) return { ok: false, error: 'line_no_description', field: `lines.${i}` };
    const unitPrice = l.unitPrice ? moneyToCents(l.unitPrice) : null;
    const qty = qtyToNumber(l.qty);
    // ⚠️ The typed amount wins; the multiplication only fills a blank - this
    // merchant's own data contains a hand override where 21 x 4,80 was
    // written as 54,60. One implementation, shared with the screen.
    const amount = lineAmountCents(l);
    if (amount === null) return { ok: false, error: 'line_bad_amount', field: `lines.${i}` };
    lines.push({
      description,
      amount,
      qty,
      unit: (l.unit ?? '').trim() || null,
      unitPrice: unitPrice ?? null,
    });
  }

  const linesTotal = lines.reduce((s, l) => s + l.amount, 0);
  const subjectName = (input.subjectName ?? '').trim();

  return {
    ok: true,
    invoice: {
      // ⚠️ There is no sheet, and these fields exist for the failure list on
      // the import screen. Zero reads as "not from a row" everywhere they are
      // shown, which is what this is.
      sheetRow: 0,
      sheetRows: [],
      payerName,
      payerEmail: (input.payerEmail ?? '').trim() || null,
      payerEmailCc: (input.payerEmailCc ?? '').trim() || null,
      payerPhone: (input.payerPhone ?? '').trim() || null,
      subjectName: subjectName || null,
      subjectNames: subjectName ? [subjectName] : [],
      reference: (input.reference ?? '').trim() || null,
      dueDate: (input.dueDate ?? '').trim() || null,
      lines,
      // ⚠️ **NULL, and that is not a gap.** `statedTotal` is the merchant's
      // own independent total, and the importer refuses a row whose lines do
      // not sum to it - a cross-check that exists because a spreadsheet is
      // read rather than written. Here the lines ARE the merchant's statement,
      // typed on the screen in front of them, so there is nothing independent
      // to check against and inventing one would only check our own addition.
      statedTotal: null,
      // Unknown, exactly as the batch leaves it: the generator then omits the
      // block rather than telling a payer their balance is 0,00.
      openingBalance: null,
      balanceIsAdvance: false,
      advanceRemaining: null,
      linesTotal,
    },
  };
}
