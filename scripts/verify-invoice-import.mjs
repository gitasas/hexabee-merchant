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
  // The two predicates the document itself applies, so this check asserts what
  // will actually be printed rather than only what reached the line.
  const pdf = await compiled.load('invoice-pdf.js');
  const issue = await compiled.load('invoice-issue.js');

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
  eq('header count', headers.length, 16);

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

    // ── The quantity and the rate reach the line ───────────────────────────
    //
    // ⚠️ This is the defect of 2026-11-03: both columns were blank on every
    // invoice HexaBee issued. The quantity column was marked `ignore`, so
    // nothing could attach it to a line, `qty` was always null, and
    // `unitPricePrintable` then refused the rate as well - only the amount
    // printed. Found by Gytis on a real document, not by any check here.
    const lunch = a.lines.find(l => l.description === 'Pietūs');
    eq('row 7 lunch qty', lunch?.qty, 21);
    eq('row 7 lunch unit', lunch?.unit, 'vnt.');
    eq('row 7 lunch rate', lunch?.unitPrice, 480);
    // 21 x 4,80 = 100,80, so it may print - the whole condition.
    eq('row 7 lunch multiplies out', pdf.unitPricePrintable(lunch), true);
    const snack = a.lines.find(l => l.description === 'Pavakariai');
    eq('row 7 snack qty', snack?.qty, 21);
    eq('row 7 snack multiplies out', pdf.unitPricePrintable(snack), true);
    // ⚠️ The discount too: 21 x 2,60 = -54,60. Their own invoice prints it.
    const disc = a.lines.find(l => l.amount === -5460);
    eq('row 7 discount qty', disc?.qty, 21);
    eq('row 7 discount multiplies out', pdf.unitPricePrintable(disc), true);
    // "Užimtumas po pamokų" has no rate anywhere, so no quantity is claimed
    // for it - an invented one would print.
    const act = a.lines.find(l => l.description === 'Užimtumas po pamokų');
    eq('row 7 activity has no rate', act?.unitPrice ?? null, null);
    eq('row 7 activity claims no qty', act?.qty ?? null, null);
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
  eq('ready count', r.ready.length, 7);
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
  eq('skipped', r.skipped, 1);
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
    // ⚠️ `ignore` until 2026-11-03, which is the whole defect: an ignored
    // column is indistinguishable from "Klasė", so nothing could attach it to
    // a line and every invoice printed no quantity and no unit price.
    F: 'quantity', G: 'quantity', H: 'line_amount', I: 'line_amount',
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

  // ── The opening balance: a parent who paid ahead ─────────────────────────
  //
  // Row 17 is their own BL2610001: Agnė Kalinauskaitė, five months of tuition
  // paid in advance. 530,00 charged, -2 650,00 carried in, -2 120,00 payable -
  // the school owes HER. Until 2026-11-03 nothing could supply that figure, so
  // `openingBalance` was always null, the block was omitted from every invoice
  // we issued, and the document demanded the full 530,00.
  // A plain letterhead and context - the VAT variants are exercised further
  // down; what is under test here is the balance, not the tax.
  const SETTINGS = {
    business_name: 'UAB „Baltijos licėjus"', company_code: '306640558', iban: 'LT02',
    invoice_address: 'Margių Sodų 2-oji g. 55', invoice_bank_name: 'AB Artea bankas',
    is_vat_payer: false, invoice_vat_code: null, invoice_vat_rate: null,
    invoice_amounts_include_vat: null, invoice_number_prefix: 'BL',
    invoice_number_format: null, invoice_import_mapping: null, blockers: [],
  };
  const BAL_CTX = {
    number: 'BL2610001', issueDate: '2026-10-09', dueDate: null, currency: 'EUR',
    openingBalance: null, amountInWords: false, issuedBy: null, note: null, lang: 'lt',
  };
  const bal = byRow.get(17);
  if (!bal) fail('row 17 (the opening balance) should be ready'); else {
    eq('balance: carried with the merchant\'s own sign', bal.openingBalance, -265000);
    // ⚠️ OUT of the lines. It is not something charged - it is what was owed.
    eq('balance: stays out of linesTotal', bal.linesTotal, 53000);
    // ⚠️ And the totals check compares against the PAYABLE. Comparing against
    // the lines would refuse every invoice that carries a balance.
    eq('balance: their own total is the payable', bal.statedTotal, -212000);
    const doc = issue.toInvoiceDoc(bal, SETTINGS, BAL_CTX);
    eq('balance: reaches the document', doc.openingBalance, -265000);
    const t = pdf.computePayable(doc);
    eq('balance: payable is lines + balance', t.payable, -212000);
    eq('balance: the document knows it', t.balanceKnown, true);
    // Nothing to pay, so no pay link and no reminder - the existing rule.
    eq('balance: not payable', t.payable > 0, false);
  }
  // A row with no balance column value is UNKNOWN, never zero: the generator
  // omits the block rather than telling a parent their balance is 0,00.
  const noBal = byRow.get(7);
  eq('no balance stated reads as unknown',
     noBal ? noBal.openingBalance : 'row 7 missing', null);
  eq('no balance: the block is omitted',
     pdf.computePayable(issue.toInvoiceDoc(noBal, SETTINGS, BAL_CTX)).balanceKnown, false);

  // ⚠️ "Likutis pabaigai" is the CLOSING balance - minus the payable - and
  // sits right beside the opening one. Read as the opening balance it would
  // double the correction and invert its sign; read as money it is the 5 830,00
  // failure measured on their half-year sheet, where a 530,00 invoice grew by
  // the receipts and the balance.
  const fixSug = imp.suggestMapping(headers, sheet.grid.slice(6));
  eq('opening balance found by its heading', fixSug.P?.role, 'opening_balance');
  eq('closing balance is not the opening one', fixSug.Q?.role, 'ignore');
  eq('closing balance is not money either', fixSug.Q?.role === 'line_amount', false);

  // ⚠️ **The headings, on their own.** The fixture's "Likutis pabaigai" turned
  // out NOT to exercise the `pabaig` guard at all - it carries no "pradin" and
  // no "permok", so the positive pattern rejects it anyway. Mutating the guard
  // away broke nothing, which is how an untested rule hides. "Permoka
  // pabaigai" is the shape that really needs it: a closing OVERPAYMENT, which
  // `permok` would otherwise claim as the opening balance and invert.
  const HEADINGS = [
    ['Pradinis likutis', 'opening_balance'],
    ['Pradinis įsiskolinimas', 'opening_balance'],
    ['Pradinė skola', 'opening_balance'],
    ['Permoka', 'opening_balance'],
    ['Opening balance', 'opening_balance'],
    // Closing figures are outputs, never inputs.
    ['Likutis pabaigai', 'ignore'],
    ['Permoka pabaigai', 'ignore'],
    ['Closing balance', 'ignore'],
    // And nothing here may quietly become a charge.
    ['Likutis', 'ignore'],
  ];
  for (const [label, want] of HEADINGS) {
    const got = imp.suggestMapping([{ col: 'A', label }])?.A?.role;
    eq(`heading "${label}"`, got, want);
  }
  console.log(`balance headings: ${HEADINGS.length} checked`);
  console.log('opening balance: 10 checked');

  // ── matchQuantity: it verifies, it does not choose ───────────────────────
  //
  // ⚠️ Column F is "Pietūs ir pavakariai vnt" and G is "Tik pietūs vnt.", so
  // the quantity behind the lunch charge depends on which one that pupil's
  // parent filled in. No mapping can express "F or G", which is why pinning
  // `qtyFrom: 'F'` printed a wrong count for every lunch-only child. The test
  // is whether the candidate multiplies out to the amount already on the sheet.
  const MQ = [
    ['the first candidate matches', 10080, 480, [{ qty: 21 }, { qty: null }], 21],
    ['the second one does',         10080, 480, [{ qty: null }, { qty: 21 }], 21],
    // Both filled and only one is right: the amount decides, not the order.
    ['the right one of two',        2880, 480, [{ qty: 21 }, { qty: 6 }], 6],
    ['neither multiplies out',      5460, 480, [{ qty: 21 }, { qty: 6 }], null],
    ['a discount, negative amount', -5460, 260, [{ qty: 21 }], 21],
    ['a fractional quantity',       585, 390, [{ qty: 1.5 }], 1.5],
    // ⚠️ With no rate there is nothing to verify against, so nothing is
    // claimed - an unverifiable quantity beside an amount is a guess.
    ['no rate, no claim',           10080, null, [{ qty: 21 }], null],
    ['a zero quantity',             0, 480, [{ qty: 0 }], null],
    ['a negative quantity',         -480, 480, [{ qty: -1 }], null],
    ['no candidates at all',        10080, 480, [], null],
  ];
  for (const [label, amount, rate, cands, want] of MQ) {
    eq(`matchQuantity (${label})`, imp.matchQuantity(amount, rate, cands)?.qty ?? null, want);
  }
  // The unit rides along with whichever column matched.
  eq('matchQuantity carries the unit',
     imp.matchQuantity(10080, 480, [{ qty: null, unit: 'val.' }, { qty: 21, unit: 'vnt.' }])?.unit,
     'vnt.');
  console.log(`matchQuantity: ${MQ.length + 1} checked`);

  eq('F takes its unit from its heading', sug.F?.unit, 'vnt.');

  // ── ⚠️ The SUGGESTED mapping end to end - the one a merchant actually has ──
  //
  // This is the assertion that reproduces the defect Gytis found on a real
  // document on 2026-11-03, and the reason the row-7 checks above did not:
  // `BALTIJOS_LICEJUS_MAPPING` carries `qtyFrom: 'F'` wired in BY HAND, so the
  // exemplar printed a quantity while every merchant using the suggester got
  // none. A check that only ever exercises the hand-written mapping cannot see
  // that, which is exactly what happened.
  const sugResult = imp.buildInvoices(sheet, {
    sheet: '2026m. rugsėjo mėn.', headerRow: 5, firstDataRow: 7,
    columns: sug, mergeByPayer: false,
  });
  const sugRow = sugResult.ready.find(i => i.sheetRow === 7);
  if (!sugRow) fail('row 7 should be ready under the suggested mapping'); else {
    eq('suggested: row 7 still totals 119,20', sugRow.linesTotal, 11920);
    const sl = sugRow.lines.find(l => l.description === 'Pietūs');
    eq('suggested: lunch qty', sl?.qty, 21);
    eq('suggested: lunch unit', sl?.unit, 'vnt.');
    eq('suggested: lunch rate', sl?.unitPrice, 480);
    eq('suggested: lunch prints its quantity', pdf.quantityPrintable(sl), true);
    eq('suggested: lunch prints its rate', pdf.unitPricePrintable(sl), true);
  }
  // ⚠️ And the hand override still prints neither. Leonas Bunikis' row has 21
  // lunches written as 54,60; no quantity multiplies out, so the document
  // shows the amount alone rather than arithmetic that does not add up.
  const override = sugResult.ready.find(i => i.sheetRow === 10);
  if (!override) fail('row 10 should be ready'); else {
    const ol = override.lines.find(l => l.amount === 5460);
    eq('suggested: the override claims no quantity', ol?.qty ?? null, null);
    eq('suggested: the override prints no quantity', pdf.quantityPrintable(ol), false);
    eq('suggested: the override prints no rate', pdf.unitPricePrintable(ol), false);
  }
  // ⚠️ A quantity column must still never be money: reading a count of lunches
  // as euros is what the `ignore` role was protecting against, and the
  // data-sniffing pass below the heading rules would happily claim a column
  // full of numbers. It only reconsiders `ignore`, so `quantity` is safe - and
  // this is what says so if that ever changes.
  eq('F is never a line amount', sug.F?.role === 'line_amount', false);
  eq('G is never a line amount', sug.G?.role === 'line_amount', false);

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

  // ── A legacy mapping mode is refused, never read as the one left ─────────
  // `mode` was removed on 2026-11-02: it offered `row_per_line`, which was
  // never built and only ever threw, so the type promised two shapes of
  // spreadsheet while one worked. A mapping stored before then can still
  // carry the key, and guessing that an unknown value means the surviving
  // mode would issue invoices from a sheet nobody designed for.
  let threw = false;
  try { imp.buildInvoices(sheet, { ...imp.BALTIJOS_LICEJUS_MAPPING, mode: 'row_per_line' }); }
  catch { threw = true; }
  if (!threw) fail('a legacy row_per_line mapping must be refused, not read as row_per_invoice');

  threw = false;
  try { imp.buildInvoices(sheet, { ...imp.BALTIJOS_LICEJUS_MAPPING, mode: 'something_else' }); }
  catch { threw = true; }
  if (!threw) fail('an unknown mapping mode must be refused rather than guessed');

  // ...and the mapping as it is stored NOW, with no mode at all, still builds.
  if (!imp.buildInvoices(sheet, imp.BALTIJOS_LICEJUS_MAPPING).ready.length) {
    fail('a mapping with no mode must build normally');
  }

  // ── A sheet that is not there is an error, not an empty result ───────────
  threw = false;
  try { x.readXlsxSheet(buf, 'Spalio mėn.'); } catch { threw = true; }
  if (!threw) fail('a missing sheet name must throw - returning nothing reads as "no invoices"');
  console.log('refusals: 2 checked');

  // ── End to end: the importer's output into the real generator ───────────
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

  // ── ⚠️ The issue screen must know every role this lib can produce ────────
  //
  // A role the suggester returns and the page's own union omits is not merely
  // unlabelled: `<select value={role}>` matches no `<option>`, so the browser
  // shows the FIRST one - "not used" - and saving the mapping writes that
  // back. The column is silently demoted and the merchant cannot tell.
  // `payer_email_cc` sat in that state from 2026-11-02 to 2026-11-03, losing
  // the second parent's address, and `quantity` and `opening_balance` would
  // each have arrived the same way. Compared as text, because the page cannot
  // import the lib's type at runtime.
  const read = rel => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  const libRoles = (() => {
    const src = read('lib/invoice-import.ts');
    const i = src.indexOf('export type ColumnRole =');
    const end = src.indexOf(';', src.indexOf('reference', i));
    return [...src.slice(i, end).matchAll(/\|\s*'([a-z_]+)'/g)].map(m => m[1]);
  })();
  const pageSrc = read('app/(merchant-portal)/merchant/(portal)/invoices/issue/page.tsx');
  const pageUnion = (() => {
    const i = pageSrc.indexOf('type ColumnRole =');
    const end = pageSrc.indexOf(';', i);
    return [...pageSrc.slice(i, end).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  })();
  const pageList = (() => {
    const i = pageSrc.indexOf('const ROLES: ColumnRole[] = [');
    const end = pageSrc.indexOf('];', i);
    return [...pageSrc.slice(i, end).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  })();
  const i18n = read('app/(merchant-portal)/i18n.tsx');
  const dicts = [...i18n.matchAll(/roles:\s*\{([\s\S]*?)\n\s{4}\}/g)]
    .map(m => [...m[1].matchAll(/^\s*([a-z_]+):/gm)].map(x => x[1]));

  eq('lib declares roles', libRoles.length > 0, true);
  for (const r of libRoles) {
    if (!pageUnion.includes(r)) fail(`role '${r}' is missing from the issue page's ColumnRole union - a column with it would show as "not used" and be lost on save`);
    if (!pageList.includes(r)) fail(`role '${r}' is missing from the page's ROLES list - no option is rendered for it`);
    dicts.forEach((d, n) => {
      if (!d.includes(r)) fail(`role '${r}' has no label in dictionary #${n + 1}`);
    });
  }
  for (const r of pageList) {
    if (!libRoles.includes(r)) fail(`the page offers role '${r}', which the lib does not know`);
  }
  eq('both dictionaries found', dicts.length, 2);
  console.log(`roles: ${libRoles.length} in the lib, union/list/2 dictionaries agree`);

  const LETTERHEAD = {
    business_name: 'UAB Baltijos licėjus', company_code: '306640558', iban: 'LT02',
    invoice_address: 'Vilnius', invoice_bank_name: 'AB Šiaulių bankas',
    is_vat_payer: false, invoice_vat_code: null, invoice_vat_rate: null,
    invoice_amounts_include_vat: null, invoice_number_prefix: 'BL',
    invoice_number_format: null, invoice_import_mapping: null, blockers: [],
  };
  const ADV_CTX = {
    number: 'BL2610001', issueDate: '2026-10-31', dueDate: '2026-11-10', currency: 'EUR',
    openingBalance: null, amountInWords: false, issuedBy: null, note: null, lang: 'lt',
  };

  // ── An advance account: two columns, and a payable of exactly zero ───────
  //
  // ⚠️ Their tuition report is a different shape from the one above, and read
  // as that one it is dangerous: "Avansas" holds 2 120 beside a 530 charge, so
  // a money sniffer that claims it invoices a parent 2 650 for a month that
  // cost 530. Rule 2 refused every such row rather than issuing it - the guard
  // working - but the merchant could then issue nothing at all.
  //
  // Headings and figures are the real ones from
  // "Ataskaitos mokestis uz moksla 2026.10": on that sheet
  // `Avansas - Likutis` equals the month's charge in 28 of 28 rows, which is
  // why the payable lands on 0 and their blank "Moketina suma" is satisfied.
  const ADV_HEADERS = [
    { col: 'C', label: 'Vardas, pavardė' },
    { col: 'D', label: 'Tėveliai' },
    { col: 'E', label: 'Tėvelių el paštas' },
    { col: 'F', label: 'Mokestis                   už mokslą               ' },
    { col: 'G', label: 'Avansas' },
    { col: 'H', label: 'Likutis ' },
    { col: 'I', label: 'Mokėtina suma' },
  ];
  const ADV_ROWS = [
    [null, null, 'Hubertas Strazdauskas', 'Agnė Strazdauskienė', 'a@x.lt', 530, 2120, 1590, null],
    [null, null, 'Vladas Buivys', 'Lina Buivienė', 'lina@x.lt', 498.2, 2182.2, 1683.9999999999998, null],
    [null, null, 'Sofija Buivytė ', 'Lina Buivienė', 'lina@x.lt', 545.2, 2369.7, 1824.4999999999998, null],
  ];
  const advCols = imp.suggestMapping(ADV_HEADERS, ADV_ROWS);
  eq("'Avansas' is the advance held, never a charge", advCols.G?.role, 'advance_before');
  eq("'Likutis' beside it is the advance left", advCols.H?.role, 'advance_after');
  eq("the charge is still a line", advCols.F?.role, 'line_amount');
  eq("their blank payable is still the totals check", advCols.I?.role, 'total_check');

  // ⚠️ Without an advance column on the sheet, "Likutis" must stay excluded -
  // on their OTHER report "Likutis pabaigai" is the CLOSING balance, which is
  // minus the payable, and reading that as an advance inverts the invoice.
  const noAdv = imp.suggestMapping(
    [{ col: 'A', label: 'Vardas' }, { col: 'B', label: 'Iš viso mokėti' }, { col: 'C', label: 'Likutis pabaigai' }],
    [['Jonas', 530, 2120]]
  );
  if (noAdv.C?.role === 'advance_after') fail("'Likutis pabaigai' read as an advance with no advance column on the sheet");

  const advSheet = {
    name: 'Lapas1 (4)',
    grid: [ADV_HEADERS.reduce((r, h, i) => (r[x.colToIndex(h.col) - 1] = h.label, r), new Array(9).fill(null)), ...ADV_ROWS],
    unreadable: new Set(),
  };
  const advRes = imp.buildInvoices(advSheet, {
    sheet: 0, headerRow: 1, firstDataRow: 2, columns: advCols, mergeByPayer: true,
  });
  eq('advance sheet: rows refused', advRes.refused.length, 0);
  eq('advance sheet: 3 rows become 2 invoices', advRes.ready.length, 2);
  const solo = advRes.ready.find(r => r.subjectNames.length === 1);
  eq('the charge is the line', solo.linesTotal, 53000);
  // ⚠️ Read, never capped: `before - after`, both the merchant's own figures.
  eq('the advance applied is before minus after', solo.openingBalance, -53000);
  eq('and it is named as an advance, not a debt', solo.balanceIsAdvance, true);
  eq('the advance left is read from their column', solo.advanceRemaining, 159000);
  eq('so nothing is payable', pdf.computePayable(issue.toInvoiceDoc(solo, LETTERHEAD, ADV_CTX)).payable, 0);
  const advMerged = advRes.ready.find(r => r.subjectNames.length === 2);
  eq('two children merge into one document', advMerged.linesTotal, 104340);
  eq('their advances applied add', advMerged.openingBalance, -104340);
  // ⚠️ Two children, one parent, one pot - the remainders add as well.
  eq('their advances left add', advMerged.advanceRemaining, 350850);
  eq('and that document is payable zero too',
     pdf.computePayable(issue.toInvoiceDoc(advMerged, LETTERHEAD, ADV_CTX)).payable, 0);

  // ⚠️ An advance that GREW is a top-up paid in, not a charge taken out.
  // Nothing on the row says how to invoice it, and guessing would credit a
  // parent against a month they were never charged for.
  const grewRes = imp.buildInvoices(
    { ...advSheet, grid: [advSheet.grid[0], [null, null, 'Ona Onaitė', 'Ona Onienė', 'o@x.lt', 530, 1000, 1600, null]] },
    { sheet: 0, headerRow: 1, firstDataRow: 2, columns: advCols, mergeByPayer: true }
  );
  eq('an advance that grew is refused, not guessed', grewRes.ready.length, 0);
  eq('and the refusal says so', grewRes.refused[0]?.reason, 'bad_amount');
  console.log('advance account: 17 checked');

  // ── Merging is decided, not defaulted off ────────────────────────────────
  //
  // ⚠️ `mergeByPayer` silently defaulted to OFF for every real merchant: the
  // only place it was ever true is BALTIJOS_LICEJUS_MAPPING, the exemplar
  // these checks run against - so the checks passed while a parent with two
  // children received two invoices and paid twice, each with its own EUR 0.49.
  // The qtyFrom trap of 2026-11-03 in a second field.
  const ADV_MAPPING_BASE = {
    sheet: 0, headerRow: 1, firstDataRow: 2, columns: advCols,
  };
  // The advance fixture carries Lina Buivienė twice, for two children.
  const unanswered = imp.buildInvoices(advSheet, { ...ADV_MAPPING_BASE });
  eq('an unanswered flag merges when the sheet repeats a payer', unanswered.mergedByPayer, true);
  eq('...so three rows become two invoices', unanswered.ready.length, 2);

  // ⚠️ An explicit answer is the merchant's and always wins - both ways.
  const saidNo = imp.buildInvoices(advSheet, { ...ADV_MAPPING_BASE, mergeByPayer: false });
  eq('an explicit false is obeyed', saidNo.mergedByPayer, false);
  eq('...and nothing is merged', saidNo.ready.length, 3);
  const saidYes = imp.buildInvoices(advSheet, { ...ADV_MAPPING_BASE, mergeByPayer: true });
  eq('an explicit true is obeyed', saidYes.mergedByPayer, true);

  // ⚠️ With no repeated payer the box stays clear: merging would change
  // nothing, and asserting a policy nobody asked for is worse than silence.
  const solos = {
    ...advSheet,
    grid: [advSheet.grid[0],
           [null, null, 'Vaikas Vienas', 'Tėvas Pirmas', 'a@x.lt', 530, 2120, 1590, null],
           [null, null, 'Vaikas Kitas', 'Tėvas Antras', 'b@x.lt', 530, 2120, 1590, null]],
  };
  const noRepeat = imp.buildInvoices(solos, { ...ADV_MAPPING_BASE });
  eq('no repeated payer means no merge suggested', noRepeat.mergedByPayer, false);
  eq('...and both invoices stand alone', noRepeat.ready.length, 2);

  // The detector groups exactly as the merge does, so it cannot promise a
  // merge the merge then declines to make.
  eq('the detector agrees with the merge on the repeating sheet',
     imp.sheetHasRepeatedPayer(saidNo.ready), true);
  eq('and on the non-repeating one', imp.sheetHasRepeatedPayer(noRepeat.ready), false);
  console.log('merge decision: 9 checked');
} finally {
  compiled.cleanup();
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall pass');
