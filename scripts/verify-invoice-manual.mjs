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
  // ── Quantity times price fills a BLANK amount, never overrides one ──────
  //
  // ⚠️ The override is real and measured: this merchant's own sheet has a row
  // where 21 x 4,80 was written as 54,60, and recomputing it would have
  // invoiced that family 76,20 instead of 30,00. A form is the one place
  // somebody might expect the multiplication to win, so it must not.
  const computed = man.buildManualInvoice({
    payerName: 'UAB Pavyzdys', dueDate: '2026-11-20',
    lines: [{ description: 'Konsultacija', amount: '', qty: '3', unitPrice: '40,00' }],
  });
  eq('a blank amount is filled from qty x price', computed.invoice.lines[0].amount, 12000);
  eq('and the quantity is kept', computed.invoice.lines[0].qty, 3);

  const override = man.buildManualInvoice({
    payerName: 'UAB Pavyzdys', dueDate: '2026-11-20',
    lines: [{ description: 'Pietūs', amount: '54,60', qty: '21', unitPrice: '4,80' }],
  });
  eq('a typed amount beats the multiplication', override.invoice.lines[0].amount, 5460);

  const neither = man.buildManualInvoice({
    payerName: 'UAB Pavyzdys', dueDate: '2026-11-20',
    lines: [{ description: 'Kažkas', amount: '', qty: '', unitPrice: '' }],
  });
  // No amount and nothing to compute one from is a blank line, not a zero.
  eq('a line with nothing at all is refused, not read as zero', neither.ok, false);

  // ⚠️ **An empty quantity is not zero**, and the form's own parser said it
  // was: Number('') is a finite 0, so a price of 10,00 beside a blank
  // quantity read as 0 x 10 = 0, the line counted as usable, and the issue
  // button lit up for an invoice the server then refused. The exact trap this
  // codebase already records for the spreadsheet reader, reintroduced in a
  // second copy of the rule - which is why there is now only one.
  const EMPTY_QTY = [
    [{ description: 'Paslauga', amount: '', qty: '', unitPrice: '10,00' }, null, 'price but no quantity'],
    [{ description: 'Paslauga', amount: '', qty: '2', unitPrice: '' }, null, 'quantity but no price'],
    [{ description: 'Paslauga', amount: '', qty: '0', unitPrice: '10,00' }, null, 'a quantity of zero is not a line'],
    [{ description: 'Paslauga', amount: '0', qty: '', unitPrice: '10,00' }, 0, 'a typed zero IS an answer'],
    [{ description: 'Paslauga', amount: '', qty: '2', unitPrice: '10,00' }, 2000, 'both present'],
  ];
  for (const [line, want, label] of EMPTY_QTY) eq(label, man.lineAmountCents(line), want);
  console.log(`empty is not zero: ${EMPTY_QTY.length} checked`);
  console.log('qty x price: 4 checked');

  console.log('zero: 2 checked');
  // ── The buyer block a company invoice must carry ────────────────────────
  //
  // ⚠️ An invoice to a company has to print the buyer's own legal details
  // beside the seller's. The form could not ask for them at all until
  // 2026-11-09, so every invoice issued to a UAB was missing a requisite.
  // Rendered rather than inspected: the field being on the type proves
  // nothing about whether it reaches the page.
  const company = man.buildManualInvoice({
    payerName: 'UAB Pavyzdys', companyCode: '300123456', vatCode: 'LT100001234567',
    address: 'Gedimino pr. 1, Vilnius', payerEmail: 'info@pavyzdys.lt',
    dueDate: '2026-11-20',
    lines: [{ description: 'Konsultacija', amount: '200,00', qty: '', unit: '', unitPrice: '' }],
  });
  eq('a company customer is accepted', company.ok, true);
  const companyDoc = issue.toInvoiceDoc(company.invoice, SETTINGS, {
    ...CTX,
    buyerCompanyCode: '300123456',
    buyerVatCode: 'LT100001234567',
    buyerAddress: 'Gedimino pr. 1, Vilnius',
  });
  eq('the buyer carries its company code', companyDoc.buyer.companyCode, '300123456');
  eq('and its VAT code', companyDoc.buyer.vatCode, 'LT100001234567');
  const out = await pdf.renderInvoicePdf(companyDoc);
  // A real render, because a missing font or a thrown layout is silent
  // otherwise - the same reason verify:invoice-pdf renders.
  if (!(out.bytes?.length > 2000)) fail(`the document did not render: ${out.bytes?.length} bytes`);
  eq('and states the typed payable', out.payable, 20000);
  console.log(`company buyer: 5 checked, ${out.bytes.length} bytes rendered`);

} finally {
  compiled.cleanup();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall pass');
