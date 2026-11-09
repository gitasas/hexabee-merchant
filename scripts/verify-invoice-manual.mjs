#!/usr/bin/env node
/**
 * One invoice typed by hand - does it become exactly what the batch produces?
 *
 *     npm run verify:invoice-manual
 *
 * The manual form reuses every rule issuing already has by producing the same
 * `ImportedInvoice` a spreadsheet row produces. So what has to be pinned is the
 * handful of things only this path does: reading money a person typed, refusing
 * what it cannot be sure of, and handing the generator an object that computes
 * the same payable the document prints.
 *
 * ⚠️ The dangerous case is the comma. A Lithuanian keyboard produces "54,60",
 * and `parseFloat` reads that as 54 - so a naive reader would invoice a
 * customer 54,00 for a 54,60 service and nobody would notice until the books
 * did not balance. That mutation is the one this check exists to fail on.
 *
 * Exit codes: 0 all pass, 1 a case disagrees.
 */

import { compileLib } from './compile-lib.mjs';

let failures = 0;
const fail = (m) => { failures += 1; console.error(`FAIL  ${m}`); };
const eq = (label, got, want) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const compiled = compileLib(
  ['lib/invoice-manual.ts', 'lib/invoice-import.ts', 'lib/invoice-pdf.ts',
   'lib/invoice-issue.ts', 'lib/xlsx-read.ts', 'lib/lt-name-case.ts'],
  '.verify-invoice-manual'
);
try {
  const man = await compiled.load('invoice-manual.js');
  const pdf = await compiled.load('invoice-pdf.js');
  const issue = await compiled.load('invoice-issue.js');

  // ── Money as a person types it ───────────────────────────────────────────
  const MONEY = [
    ['54.60', 5460], ['54,60', 5460], ['0', 0], ['0,00', 0],
    ['-2.60', -260], ['-2,60', -260], [' 1 234,50 ', 123450],
    ['12', 1200], ['12,5', 1250],
    // Refused rather than coerced - the importer's own rule.
    ['', null], ['abc', null], ['1.234', null], ['1,2,3', null], ['--5', null],
  ];
  for (const [raw, want] of MONEY) eq(`moneyToCents(${JSON.stringify(raw)})`, man.moneyToCents(raw), want);
  console.log(`money: ${MONEY.length} checked`);

  // ── What it refuses, and where ───────────────────────────────────────────
  const REFUSALS = [
    ['no payer name', { payerName: '  ', lines: [{ description: 'x', amount: '1' }] }, 'no_payer_name'],
    ['no lines at all', { payerName: 'Inga', lines: [] }, 'no_lines'],
    ['only blank lines', { payerName: 'Inga', lines: [{ description: '', amount: '' }] }, 'no_lines'],
    ['line with no description', { payerName: 'Inga', lines: [{ description: '', amount: '10' }] }, 'line_no_description'],
    ['line with unreadable amount', { payerName: 'Inga', lines: [{ description: 'x', amount: 'du eurai' }] }, 'line_bad_amount'],
  ];
  for (const [label, input, want] of REFUSALS) {
    const r = man.buildManualInvoice(input);
    eq(label, r.ok === false ? r.error : 'ACCEPTED', want);
  }
  console.log(`refusals: ${REFUSALS.length} checked`);

  // ── A real one, end to end through the document ──────────────────────────
  const built = man.buildManualInvoice({
    payerName: 'Inga Motuzaitė',
    payerEmail: 'inga.motuzaite@example.lt',
    subjectName: 'Rytis Černiauskas',
    dueDate: '2026-11-20',
    lines: [
      { description: 'Stovyklos dalyvio mokestis', amount: '180,00' },
      { description: 'Taikoma nuolaida', amount: '-20,00' },
    ],
  });
  eq('a typed invoice is accepted', built.ok, true);
  eq('lines are kept in order', built.invoice.lines[0].description, 'Stovyklos dalyvio mokestis');
  eq('a negative line survives', built.invoice.lines[1].amount, -2000);
  eq('the lines total is the sum', built.invoice.linesTotal, 16000);
  // ⚠️ No independent total exists here - the lines ARE the statement.
  eq('statedTotal is null, not an invented echo', built.invoice.statedTotal, null);
  eq('the balance stays unknown', built.invoice.openingBalance, null);

  const SETTINGS = {
    business_name: 'AUKIM, VšĮ', company_code: '300000000', iban: 'LT00',
    invoice_address: 'Vilnius', invoice_bank_name: 'AB Šiaulių bankas',
    is_vat_payer: false, invoice_vat_code: null, invoice_vat_rate: null,
    invoice_amounts_include_vat: null, invoice_number_prefix: 'AUK',
    invoice_number_format: null, invoice_import_mapping: null, blockers: [],
  };
  const CTX = {
    number: 'AUK2611001', issueDate: '2026-11-09', dueDate: '2026-11-20',
    currency: 'EUR', openingBalance: null, amountInWords: false,
    issuedBy: null, note: null, lang: 'lt',
  };
  const doc = issue.toInvoiceDoc(built.invoice, SETTINGS, CTX);
  const totals = pdf.computePayable(doc);
  // ⚠️ The whole reason this path reuses `ImportedInvoice`: the figure the
  // ledger stores is the figure the document prints, computed once.
  eq('the payable equals the typed lines', totals.payable, 16000);
  eq('the document carries the due date', doc.dueDate, '2026-11-20');
  eq('the buyer is the person typed', doc.buyer.name, 'Inga Motuzaitė');
  // The purpose is composed and declined by the same rule the batch uses.
  eq('the purpose names the subject', doc.paymentPurpose, 'Už Rytį Černiauską');
  console.log('document: 8 checked');

  // ⚠️ A zero invoice is a statement, not a failure - the same rule the rest
  // of the product applies. It must build; what must never happen is a pay
  // link on it, and that is decided downstream by `isPayable`.
  const zero = man.buildManualInvoice({
    payerName: 'Inga', dueDate: '2026-11-20',
    lines: [{ description: 'Sumokėta avansu', amount: '0' }],
  });
  eq('a zero invoice still builds', zero.ok, true);
  eq('and its payable is zero', pdf.computePayable(issue.toInvoiceDoc(zero.invoice, SETTINGS, CTX)).payable, 0);
  console.log('zero: 2 checked');
} finally {
  compiled.cleanup();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall pass');
