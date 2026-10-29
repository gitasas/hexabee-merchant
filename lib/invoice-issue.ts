/**
 * One imported spreadsheet row plus the merchant's letterhead, as an invoice.
 *
 * ⚠️ **Here so that the preview and the issue cannot disagree.** The preview
 * screen shows the merchant a total per row and a total for the batch; the
 * issue step renders the document and writes that figure onto the ledger row,
 * which is what the pay link then charges. Two places building the document
 * would be two chances to differ, and the one that differs is the one the payer
 * sees - the `/payment-success` "Paskirtis" disagreement of 2026-10-05, except
 * about money.
 *
 * So both routes call `toInvoiceDoc`, and the payable always comes from
 * `computePayable` inside `invoice-pdf.ts`. Nothing re-adds anything.
 */

import type { ImportedInvoice } from './invoice-import';
import type { InvoiceDoc, InvoiceVat } from './invoice-pdf';
import { paymentPurposeForAll } from './lt-name-case';

/** The merchant's letterhead, as `/api/plugin/merchant-invoice-settings` returns it. */
export type IssueSettings = {
  business_name: string | null;
  company_code: string | null;
  iban: string | null;
  invoice_address: string | null;
  invoice_bank_name: string | null;
  is_vat_payer: boolean | null;
  invoice_vat_code: string | null;
  invoice_vat_rate: number | null;
  invoice_amounts_include_vat: boolean | null;
  invoice_number_prefix: string | null;
  invoice_number_format: string | null;
  invoice_import_mapping: unknown;
  blockers: string[];
};

/**
 * ⚠️ Three facts, never collapsed - see the migration in
 * `hexabee-backend/app/main.py`. `is_vat_payer` NULL means nobody asked;
 * a VAT code does not imply a rate (Kauno Valdorfo mokykla carry one and print
 * 0.00 % on every line); and with a real rate, whether the merchant's figures
 * already include it decides what the payer is charged.
 *
 * The blockers list from the backend is what stops an unanswered merchant
 * reaching this at all, so anything arriving here is answered.
 */
export function vatFrom(settings: IssueSettings): InvoiceVat {
  if (!settings.is_vat_payer) return { kind: 'none' };
  return {
    kind: 'registered',
    rate: settings.invoice_vat_rate ?? 0,
    amountsIncludeVat: settings.invoice_amounts_include_vat,
  };
}

/**
 * The merchant's own label for a batch, which is the sheet name, plus the
 * person the invoice is about.
 *
 * ⚠️ This is the only thing stopping a re-imported spreadsheet from issuing
 * every invoice a second time under fresh numbers. The sheet name is the label
 * on purpose: the merchant already changes it every month, and their tuition
 * sheet and their monthly-fees sheet have different ones, so somebody receiving
 * one of each in the same month is not blocked.
 */
export function issueKeyFor(batch: string, row: ImportedInvoice): string {
  // Every subject on the invoice, so a merged one and the two single invoices
  // it replaces are different keys rather than one silently standing in for
  // the other. ⚠️ Turning `mergeByPayer` on between two runs of the same batch
  // therefore lets both shapes exist - the preview shows the earlier ones as
  // already issued, which is the visible outcome rather than a silent one.
  const who = (row.subjectNames.length ? row.subjectNames.join(' + ') : row.payerName || `row ${row.sheetRow}`)
    .replace(/\s+/g, ' ')
    .trim();
  return `${batch.trim()}|${who}`.slice(0, 200);
}

export type IssueContext = {
  /** From the backend's allocator. Empty in a preview, where none is burned. */
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  /**
   * Integer cents carried over, or **null for unknown** - which is what it is
   * until the merchant's accounting can be read. The generator then omits the
   * balance block entirely rather than printing 0,00, and reports
   * `balanceKnown: false` so a caller can refuse to send.
   */
  openingBalance: number | null;
  /** Spell the total out in words, as their own invoices do. */
  amountInWords: boolean;
  issuedBy: string | null;
  note: string | null;
  lang: 'lt' | 'en';
};

export function toInvoiceDoc(
  row: ImportedInvoice,
  settings: IssueSettings,
  ctx: IssueContext
): InvoiceDoc {
  return {
    number: ctx.number,
    issueDate: ctx.issueDate,
    dueDate: ctx.dueDate,
    currency: ctx.currency,
    seller: {
      // The company section, not a copy of it (Gytis, 2026-10-29).
      name: settings.business_name ?? '',
      companyCode: settings.company_code,
      vatCode: settings.is_vat_payer ? settings.invoice_vat_code : null,
      address: settings.invoice_address,
      bankName: settings.invoice_bank_name,
      accountNumber: settings.iban,
    },
    buyer: {
      name: row.payerName,
      email: row.payerEmail,
      reference: row.reference,
    },
    lines: row.lines,
    vat: vatFrom(settings),
    openingBalance: ctx.openingBalance,
    // ⚠️ Composed by us, so its grammar is ours: the spreadsheet column is
    // nominative and their invoices are accusative. Every name on the invoice
    // goes in, which is what their own document does - BL2606014 reads
    // "Už Vladą Buivį, Sofiją Buivytę".
    paymentPurpose: row.subjectNames.length ? paymentPurposeForAll(row.subjectNames) || null : null,
    note: ctx.note,
    issuedBy: ctx.issuedBy,
    amountInWords: ctx.amountInWords,
    lang: ctx.lang,
  };
}
