#!/usr/bin/env node
/**
 * Does the importer refuse what it cannot be sure of?
 *
 *     npm run verify:invoice-import
 *
 * `lib/xlsx-read.ts` and `lib/invoice-import.ts` turn a merchant's own
 * spreadsheet into invoices, and almost everything that can go wrong here is
 * silent: a column read one place to the left, a subtotal counted twice, a
 * blank recipient filled in from somewhere. The expensive ones are not even
 * errors - they are plausible numbers on a document that reaches a parent.
 *
 * So the cases below are shapes taken from the real sheet rather than invented
 * ones, held in `scripts/fixtures/invoice-import.xlsx` (regenerate with
 * `python3 scripts/fixtures/make-invoice-import-fixture.py`, which explains
 * every row). The real file itself is one merchant's and holds 53 families'
 * names, so it is not in this repository and this check does not need it.
 *
 * Exit codes:
 *     0  every case matches
 *     1  a case disagrees, or the fixture could not be read at all
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileLib } from './compile-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'invoice-import.xlsx');

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL  ${msg}`); };
const eq = (label, got, want) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const compiled = compileLib(
  ['lib/xlsx-read.ts', 'lib/invoice-import.ts', 'lib/invoice-pdf.ts',
   'lib/invoice-issue.ts', 'lib/lt-name-case.ts'],
  '.verify-invoice-import'
);
try {
  const x = await compiled.load('xlsx-read.js');
  const imp = await compiled.load('invoice-import.js');

  // ── Column letters both ways ─────────────────────────────────────────────
  for (const [n, col] of [[1, 'A'], [26, 'Z'], [27, 'AA'], [28, 'AB'], [52, 'AZ'], [702, 'ZZ']]) {
    eq(`indexToCol(${n})`, x.indexToCol(n), col);
    eq(`colToIndex(${col})`, x.colToIndex(col), n);
  }
  console.log('columns: 12 checked');

  // ── Money, with the float noise that is in the source data ───────────────
  const CENTS = [
    [null, 0], ['', 0], [0, 0],
    [119.2, 11920],
    // ⚠️ Exactly what the merchant's file stores for 109,20.
    [109.20000000000002, 10920],
    [4.8, 480],
    [-45.3, -4530],
    // A number typed as text, European and plain.
    ['119,20', 11920], ['1.043,40', 104340], ['1043.40', 104340], ['1 043,40', 104340],
    // Not a number: `undefined`, which the caller turns into a refusal rather
    // than into a zero. A column read one place to the left lands here.
    ['Komentaras', undefined], ['-', undefined], ['n/a', undefined],
  ];
  for (const [cell, want] of CENTS) eq(`toCents(${JSON.stringify(cell)})`, imp.toCents(cell), want);
  console.log(`money: ${CENTS.length} checked`);

  // ── Dates: a column the mapping says is a date ───────────────────────────
  const DATES = [
    [null, null], ['', null],
    ['2026-11-14', '2026-11-14'],
    ['2026.11.14', '2026-11-14'],
    ['2026.1.4', '2026-01-04'],
    [46340, '2026-11-14'],            // Excel serial, computed from the 25569 epoch
    ['kitą mėnesį', undefined],       // refused, not guessed
    [0, undefined],
  ];
  for (const [cell, want] of DATES) eq(`toIsoDate(${JSON.stringify(cell)})`, imp.toIsoDate(cell), want);
  console.log(`dates: ${DATES.length} checked`);

  // ── The fixture, through the real reader and the real mapping ────────────
  const buf = readFileSync(FIXTURE);
  eq('sheet names', JSON.stringify(x.readXlsxSheetNames(buf)),
     JSON.stringify(['2026m. rugsėjo mėn.', 'Lapas1']));

  const sheet = x.readXlsxSheet(buf, '2026m. rugsėjo mėn.');
  // ⚠️ One formula with no cached result, and it must be known BY REFERENCE,
  // not merely counted. openpyxl writes `<f>...</f><v></v>` for it, and
  // `Number('')` is 0 - so before this was fixed an unreadable total read as
  // zero. If an amount column and the total column were both uncached they
  // would agree at zero and a parent who owed money would get a nil invoice.
  eq('unreadable cells found', sheet.unreadable.size, 1);
  eq('unreadable cell named', [...sheet.unreadable][0], 'N15');

  // The header is row 5 and row 4 holds the unit rates. Anything that guessed
  // would read 4,8 / 3 / 2,6 as a pupil.
  const headers = imp.readHeaders(sheet, 5);
  eq('header B', headers.find(h => h.col === 'B')?.label, 'Vardas, pavardė');
  eq('header N', headers.find(h => h.col === 'N')?.label, 'Iš viso mokėti');
  eq('header count', headers.length, 14);

  const UNMERGED = { ...imp.BALTIJOS_LICEJUS_MAPPING, mergeByPayer: false };
  const r = imp.buildInvoices(sheet, UNMERGED);
  eq('sheetName', r.sheetName, '2026m. rugsėjo mėn.');
  eq('unreadable carried through', JSON.stringify(r.unreadable), JSON.stringify(['N15']));

  const byRow = new Map(r.ready.map(i => [i.sheetRow, i]));
  const refusedByRow = new Map(r.refused.map(f => [f.sheetRow, f]));

  // Ordinary row: 100,80 + 63,00 - 54,60 + 10,00 = 119,20.
  const a = byRow.get(7);
  if (!a) fail('row 7 should be ready'); else {
    eq('row 7 total', a.linesTotal, 11920);
    eq('row 7 agrees with the sheet', a.statedTotal, 11920);
    eq('row 7 subject', a.subjectName, 'Augustas Červonikovas');
    eq('row 7 payer', a.payerName, 'Gintarė Sakalauskė');
    eq('row 7 lines', a.lines.length, 4);
    eq('row 7 discount is negative', a.lines[2].amount, -5460);
    // ⚠️ The subtotal column ("Iš viso už maistą", L) is mapped to ignore.
    // Counting it would double the food charges and nothing would complain.
    eq('row 7 has no subtotal line', a.lines.some(l => l.amount === 10920), false);
  }

  // Unmerged: two children of one parent are two invoices.
  eq('both children present', [byRow.get(7), byRow.get(8)].filter(Boolean).length, 2);
  eq('same payer on both', byRow.get(8)?.payerName, 'Gintarė Sakalauskė');

  // A line described by another column (the comments column).
  eq('row 9 "Kita" takes its description from O',
     byRow.get(9)?.lines.find(l => l.amount === 5000)?.description,
     '2 papildomos pamokos po 25 eur.');

  // ⚠️ The hand override, and the real finding: 21 lunches would be 100,80 but
  // 54,60 is typed in, and the amounts still sum to the merchant's own total.
  // So this row is ISSUED - the amounts are authoritative. Recomputing from
  // 21 × 4,80 would have billed this family 76,20 instead of 30,00.
  const leonas = byRow.get(10);
  if (!leonas) fail('row 10 (the hand override) should be ready'); else {
    eq('row 10 total', leonas.linesTotal, 3000);
    eq('row 10 agrees with the sheet', leonas.statedTotal, 3000);
  }

  // ⚠️ Float noise resolves to the same cents on both sides of the check.
  // Asserted on the SUBTOTAL the noise is actually in (109.20000000000002 in
  // the food column) rather than on the row total, so adding another line to
  // the fixture cannot quietly turn this into a test of nothing.
  const noisy = byRow.get(11);
  eq('row 11 agrees with the sheet', noisy?.linesTotal, noisy?.statedTotal);
  eq('row 11 food lines sum to the noisy figure',
     (noisy?.lines ?? []).filter(l => /Pietūs|Pavakariai|nuolaida/.test(l.description))
       .reduce((s, l) => s + l.amount, 0),
     10920);

  // No email and no phone: refused, never filled in from memory.
  eq('row 12 refused', refusedByRow.get(12)?.reason, 'no_recipient');
  eq('row 12 not issued', byRow.has(12), false);

  // Settles to nothing. Issued, because the payer is entitled to the
  // statement - the pay link is what gets left off, elsewhere.
  const zero = byRow.get(14);
  if (!zero) fail('row 14 (settles to nothing) should be ready'); else {
    eq('row 14 total', zero.linesTotal, 0);
  }

  // ⚠️ The unreadable formula total: refused for being unreadable, which is a
  // different statement from "the total is missing" and a very different one
  // from "the total is zero".
  eq('row 15 refused', refusedByRow.get(15)?.reason, 'unreadable_cell');
  if (!/N15/.test(refusedByRow.get(15)?.detail ?? '')) {
    fail('row 15 detail must name the cell, so the merchant can go and fix it');
  }

  // A genuine disagreement between the lines and the merchant's own total.
  const mismatch = refusedByRow.get(16);
  eq('row 16 refused', mismatch?.reason, 'total_mismatch');
  if (mismatch && !/100\.80/.test(mismatch.detail)) {
    fail(`row 16 detail should name both figures, got: ${mismatch.detail}`);
  }

  // Blank rows are skipped, not refused: a failure list full of noise is a
  // failure list nobody reads, which is the whole point of having one.
  eq('ready count', r.ready.length, 6);
  eq('refused count', r.refused.length, 3);

  // ⚠️ A column total and a price list sit below the data, with no name on
  // them. On the real sheet that shape produced EIGHT refusals - noise in the
  // one list the merchant has to read - so they are set aside instead. Not
  // silently: they come back in `ignored`, carrying what was on the row, and
  // the preview says how many.
  eq('ignored count', r.ignored.length, 3);
  if (!r.ignored.some(i => /557/.test(i.detail))) {
    fail('an ignored row must carry what was on it, so nothing is lost silently');
  }
  eq('nothing named was ignored',
     r.ignored.some(i => [7, 8, 9, 10, 11, 12, 14, 15, 16].includes(i.sheetRow)), false);
  // Two: row 13, blank in the middle of the data, and row 17, blank between
  // the data and the price list below it. Row 6 is blank too but sits ABOVE
  // firstDataRow, so the loop never reaches it - worth pinning, because a
  // mapping with the wrong firstDataRow shows up here as an extra skipped row
  // rather than as an error anywhere.
  eq('skipped', r.skipped, 2);
  console.log(`fixture: ready ${r.ready.length}, refused ${r.refused.length}, skipped ${r.skipped}`);

  // ── The suggested mapping, against the merchant's REAL headings ─────────
  //
  // A draft the merchant corrects, never a stored answer - but a draft that
  // gets the dangerous one wrong is worse than none, so the dangerous one is
  // pinned: "Iš viso už maistą" is a SUBTOTAL of three other columns and must
  // come back `ignore`, while "Iš viso mokėti" is the payable. Both begin
  // "Iš viso".
  const REAL_HEADERS = [
    { col: 'B', label: 'Vardas, pavardė' },
    { col: 'C', label: 'Klasė' },
    { col: 'D', label: 'Tėveliai' },
    { col: 'E', label: 'Tėvelių el paštas' },
    { col: 'F', label: 'Pietūs ir pavakariai vnt ' },
    { col: 'G', label: 'Tik pietūs vnt.' },
    { col: 'H', label: 'Pietūs 4.80  Eur.' },
    { col: 'I', label: 'Pavakariai 3 Eur.' },
    { col: 'J', label: 'Taikoma nuolaida -2,6 Eur' },
    { col: 'K', label: 'Kita' },
    { col: 'L', label: 'Iš viso už maistą' },
    { col: 'M', label: 'Užimtumas po pamokų' },
    { col: 'N', label: 'Iš viso mokėti' },
    { col: 'O', label: 'Komentarai' },
  ];
  // ⚠️ With the data, because two of this merchant's four money columns
  // ("Kita", "Užimtumas po pamokų") name no currency in their heading. Heading
  // text alone suggests `ignore` for both and the mapping misses half the
  // invoice - caught by this check, not by reading the code.
  const sug = imp.suggestMapping(REAL_HEADERS, sheet.grid.slice(6));
  const WANT_ROLE = {
    B: 'subject_name', C: 'ignore', D: 'payer_name', E: 'payer_email',
    F: 'ignore', G: 'ignore', H: 'line_amount', I: 'line_amount',
    J: 'line_discount', L: 'ignore', N: 'total_check', O: 'ignore',
    // Found from the data, not the heading - neither says Eur.
    K: 'line_amount', M: 'line_amount',
  };
  for (const [col, role] of Object.entries(WANT_ROLE)) {
    eq(`suggest ${col} (${REAL_HEADERS.find(h => h.col === col)?.label.trim()})`, sug[col]?.role, role);
  }
  // The rate is lifted out of the heading, and the description loses it.
  eq('suggested rate for H', sug.H?.unitPrice, 480);
  eq('suggested description for H', sug.H?.description, 'Pietūs');
  eq('suggested rate for I', sug.I?.unitPrice, 300);
  eq('suggested description for I', sug.I?.description, 'Pavakariai');
  // ⚠️ No rate where the heading states none - an invented one would print.
  eq('no rate invented for M', sug.M?.unitPrice, undefined);
  // "Kita" takes its description from the comments column.
  eq('K reads its description from the comments', sug.K?.descriptionFrom, 'O');
  console.log(`suggestion: ${Object.keys(WANT_ROLE).length + 5} checked against the real headings`);

  // ── One invoice per payer, which is what the merchant actually wanted ────
  //
  // ⚠️ This reverses the original reading. Their sheet has one row per pupil
  // and their old documents are per pupil, so two invoices looked right -
  // but Gintarė asked for them together, because a parent pays for both
  // children at once. Their own invoice already agreed: BL2606014 carries
  // `Už Vladą Buivį, Sofiją Buivytę`. Ten of their 46 payers have two
  // children.
  const merged = imp.buildInvoices(sheet, { ...imp.BALTIJOS_LICEJUS_MAPPING, mergeByPayer: true });
  eq('merged drops one invoice', merged.ready.length, r.ready.length - 1);
  const pair = merged.ready.find(i => i.sheetRows.length > 1);
  if (!pair) fail('the two children of one parent did not merge'); else {
    eq('merged rows', JSON.stringify(pair.sheetRows), JSON.stringify([7, 8]));
    // ⚠️ The sum of the merchant's OWN totals - the totals check is preserved
    // by construction, because each row passed it before merging.
    eq('merged total', pair.linesTotal, 11920 + 17380);
    eq('merged stated total', pair.statedTotal, 11920 + 17380);
    eq('both children named', JSON.stringify(pair.subjectNames),
       JSON.stringify(['Augustas Červonikovas', 'Lilija Červonikovaitė']));
    // Each line says which child it is for - a parent seeing "Pietūs" twice
    // could not tell them apart, and that is the whole point of one document.
    if (!pair.lines.every(l => /^(Augustas Červonikovas|Lilija Červonikovaitė): /.test(l.description))) {
      fail(`merged lines are not labelled by child: ${pair.lines.map(l => l.description).join(' | ')}`);
    }
  }
  // A single-child invoice is NOT labelled - repeating one name on every line
  // reads worse, and there is nothing to disambiguate.
  const single = merged.ready.find(i => i.sheetRows.length === 1 && i.lines.length);
  if (single && single.lines.some(l => l.description.includes(': '))) {
    fail('a single-subject invoice should not have its lines prefixed');
  }
  // ⚠️ A blank address must NOT merge into one that has an address: two
  // different parents can share a name, and two invoices is the safe
  // direction where a wrong merge is not.
  eq('row 12 (no recipient) is still refused', merged.refused.some(f => f.sheetRow === 12), true);
  console.log(`merge: ${r.ready.length} invoices become ${merged.ready.length}`);

  // ── Phase 2 is refused loudly, not half-done ─────────────────────────────
  let threw = false;
  try { imp.buildInvoices(sheet, { ...imp.BALTIJOS_LICEJUS_MAPPING, mode: 'row_per_line' }); }
  catch { threw = true; }
  if (!threw) fail('row_per_line is not built - it must throw rather than return something');

  // ── A sheet that is not there is an error, not an empty result ───────────
  threw = false;
  try { x.readXlsxSheet(buf, 'Spalio mėn.'); } catch { threw = true; }
  if (!threw) fail('a missing sheet name must throw - returning nothing reads as "no invoices"');
  console.log('refusals: 2 checked');

  // ── End to end: the importer's output into the real generator ───────────
  const pdf = await compiled.load('invoice-pdf.js');
  const first = byRow.get(7);
  const rendered = await pdf.renderInvoicePdf({
    number: 'BL2611001', issueDate: '2026-11-03', currency: 'EUR',
    seller: { name: 'UAB „Baltijos licėjus"' },
    buyer: { name: first.payerName, email: first.payerEmail },
    lines: first.lines, vat: { kind: 'none' }, openingBalance: null, lang: 'lt',
  });
  // ⚠️ The number on the document must be the number on the ledger row. One
  // calculation, asserted across the two modules that would otherwise each
  // have their own.
  eq('document agrees with the import', rendered.payable, first.linesTotal);
  eq('unicode font registered', rendered.unicode, true);
  console.log(`end to end: ${(rendered.payable / 100).toFixed(2)} EUR, ${rendered.bytes.length} bytes`);

  // ── The preview and the issued document must never disagree ─────────────
  //
  // ⚠️ The preview shows the merchant a figure and they approve it; the issue
  // step prints a document and writes that figure onto the ledger row, which
  // is what the pay link charges. `lib/invoice-issue.ts` exists so both go
  // through one construction - this is the assertion that it does, and the
  // VAT case is the one where the two could plausibly drift, because there
  // the payable is NOT the sum of the lines.
  const issue = await compiled.load('invoice-issue.js');
  const nameCase = await compiled.load('lt-name-case.js');

  // Both names declined, as their own invoice writes it.
  eq('purpose for two children', nameCase.paymentPurposeForAll(['Vladas Buivys', 'Sofija Buivytė']),
     'Už Vladą Buivį, Sofiją Buivytę');
  eq('a repeated name is printed once',
     nameCase.paymentPurposeForAll(['Rytis Černiauskas', 'Rytis Černiauskas']), 'Už Rytį Černiauską');
  eq('no names, no purpose', nameCase.paymentPurposeForAll([]), '');
  if (pair) {
    const doc = issue.toInvoiceDoc(pair, {
      business_name: 'X', company_code: null, iban: null, invoice_address: null,
      invoice_bank_name: null, is_vat_payer: false, invoice_vat_code: null,
      invoice_vat_rate: null, invoice_amounts_include_vat: null,
      invoice_number_prefix: 'BL', invoice_number_format: null,
      invoice_import_mapping: null, blockers: [],
    }, {
      number: 'BL2611001', issueDate: '2026-11-03', dueDate: null, currency: 'EUR',
      openingBalance: null, amountInWords: false, issuedBy: null, note: null, lang: 'lt',
    });
    eq('merged purpose', doc.paymentPurpose, 'Už Augustą Červonikovą, Liliją Červonikovaitę');
    // A merged invoice and the two it replaces must be different keys.
    if (issue.issueKeyFor('b', pair) === issue.issueKeyFor('b', byRow.get(7))) {
      fail('a merged invoice shares a key with one of the invoices it replaces');
    }
  }
  const CTX = {
    number: 'BL2611007', issueDate: '2026-11-03', dueDate: '2026-11-17',
    currency: 'EUR', openingBalance: null, amountInWords: true,
    issuedBy: 'Direktorė Monika Valčiukaitė-Vaitkienė', note: null, lang: 'lt',
  };
  const LETTERHEADS = [
    ['not VAT-registered', { is_vat_payer: false }],
    // A registered payer printing 0 %, which is Kauno Valdorfo mokykla.
    ['registered at 0 %', { is_vat_payer: true, invoice_vat_code: 'LT100020653718', invoice_vat_rate: 0 }],
    // Net figures: the payable is MORE than the lines.
    ['21 % on net figures', { is_vat_payer: true, invoice_vat_code: 'LT1', invoice_vat_rate: 21, invoice_amounts_include_vat: false }],
    // Gross figures: the payable equals the lines, and the VAT is backed out.
    ['21 % inside the figures', { is_vat_payer: true, invoice_vat_code: 'LT1', invoice_vat_rate: 21, invoice_amounts_include_vat: true }],
  ];
  for (const [label, vat] of LETTERHEADS) {
    const settings = {
      business_name: 'UAB „Baltijos licėjus"', company_code: '302951833', iban: 'LT00',
      invoice_address: 'Margių Sodų 9-oji g. 2', invoice_bank_name: 'AB Artea bankas',
      invoice_vat_code: null, invoice_vat_rate: null, invoice_amounts_include_vat: null,
      invoice_number_prefix: 'BL', invoice_number_format: null, invoice_import_mapping: null,
      blockers: [], ...vat,
    };
    const doc = issue.toInvoiceDoc(first, settings, CTX);
    const previewed = pdf.computePayable(doc).payable;
    const printed = await pdf.renderInvoicePdf(doc);
    if (previewed !== printed.payable) {
      fail(`${label}: preview says ${previewed} and the document says ${printed.payable}`);
    }
    // ⚠️ And the purpose is declined, on every letterhead - it is the parent's
    // bank statement, not a detail.
    if (doc.paymentPurpose !== 'Už Augustą Červonikovą') {
      fail(`${label}: payment purpose is ${JSON.stringify(doc.paymentPurpose)}`);
    }
  }
  console.log(`preview vs document: ${LETTERHEADS.length} letterheads agree`);

  // ── The key that stops a spreadsheet being issued twice ─────────────────
  eq('issue key', issue.issueKeyFor('2026m. rugsėjo mėn.', first),
     '2026m. rugsėjo mėn.|Augustas Červonikovas');
  // A different month is a different batch, so the same pupil is issuable again.
  if (issue.issueKeyFor('2026m. spalio mėn.', first) === issue.issueKeyFor('2026m. rugsėjo mėn.', first)) {
    fail('a different sheet name must give a different key, or next month is blocked');
  }
  // Two children of one parent are two invoices, so two keys.
  if (issue.issueKeyFor('b', byRow.get(7)) === issue.issueKeyFor('b', byRow.get(8))) {
    fail('two children of one parent must not share a key');
  }
  console.log('issue keys: 3 checked');
} finally {
  compiled.cleanup();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall pass');
