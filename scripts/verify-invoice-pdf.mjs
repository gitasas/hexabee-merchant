#!/usr/bin/env node
/**
 * Does the invoice document say what the payer will actually be charged?
 *
 *     npm run verify:invoice-pdf
 *
 * `lib/invoice-pdf.ts` is the only place that computes an issued invoice's
 * payable, on purpose: the ledger row stores what this returns, so the pay link
 * and the PDF cannot disagree. That makes its arithmetic the thing to pin, and
 * the cases below are not invented - each one is a shape found in a merchant's
 * real data or a real document.
 *
 * It also renders a PDF for real and asserts the embedded Noto Sans registered.
 * That check exists because the failure it catches is silent: jsPDF swallows a
 * bad font name table, reports nothing, and the invoice comes out in folded
 * ASCII - which is how the payer's receipt was written in English for weeks
 * before 2026-09-23.
 *
 * Exit codes:
 *     0  every case matches
 *     1  a case disagrees, or the module could not be loaded at all
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ⚠️ Inside the project, not in /tmp, and that is not a preference.
// `invoice-pdf.ts` imports `jspdf`, so the compiled copy has to sit where
// Node's resolver can walk up to this package's node_modules - from a temp
// directory the render step dies with ERR_MODULE_NOT_FOUND and the only thing
// actually exercising the font never runs. Removed again in `finally`.
const out = join(process.cwd(), '.verify-invoice-pdf');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// Keeps Node from reparsing the emitted files and printing a warning about it -
// so that any warning this script does print is a real one.
writeFileSync(join(out, 'package.json'), '{"type":"module"}\n');
let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL  ${msg}`); };
const eq = (label, got, want) => {
  if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

try {
  execFileSync(
    'npx',
    ['tsc', 'lib/invoice-pdf.ts', 'lib/lt-name-case.ts', '--outDir', out, '--module', 'esnext',
     '--target', 'es2020', '--moduleResolution', 'bundler', '--skipLibCheck'],
    { stdio: 'inherit' }
  );

  // Next.js bundles `./pdf-font`, so the source rightly carries no extension -
  // but plain Node ESM will not resolve it, and tsc does not rewrite specifiers
  // under `--moduleResolution bundler`. Adding the extension here is what the
  // bundler would do; the alternative is extensions in the source that exist
  // only to satisfy this script.
  const entry = join(out, 'invoice-pdf.js');
  writeFileSync(entry, readFileSync(entry, 'utf8').replaceAll("'./pdf-font'", "'./pdf-font.js'"));

  const m = await import(pathToFileURL(entry).href);

  // ── Rule 2: a unit price is printed only when it multiplies out ───────────
  //
  // ⚠️ The second case is Leonas Bunikis, from Baltijos licejus' real
  // September sheet: 21 lunches at 4,80 with 54,60 written in the amount
  // column by hand. Printing "21 x 4,80 = 54,60" is arithmetic that does not
  // add up, on a document about somebody's money.
  const UNIT = [
    ['exact',            { qty: 21, unitPrice: 480, amount: 10080 }, true],
    ['the hand override', { qty: 21, unitPrice: 480, amount: 5460 }, false],
    ['fractional qty',   { qty: 1.5, unitPrice: 390, amount: 585 }, true],
    ['rounds to it',     { qty: 3, unitPrice: 333, amount: 999 }, true],
    ['off by a cent',    { qty: 3, unitPrice: 333, amount: 1000 }, false],
    ['no qty',           { qty: null, unitPrice: 480, amount: 480 }, false],
    ['no price',         { qty: 2, unitPrice: null, amount: 960 }, false],
  ];
  for (const [label, line, want] of UNIT) eq(`unitPricePrintable (${label})`, m.unitPricePrintable(line), want);
  console.log(`unitPricePrintable: ${UNIT.length} checked`);

  // ── VAT: three facts, and one of them refuses rather than guesses ─────────
  const base = {
    number: 'X-1', issueDate: '2026-11-01', currency: 'EUR',
    seller: { name: 'Test' }, buyer: { name: 'Payer' },
    lines: [{ description: 'Service', amount: 10000 }],
  };
  const pay = (vat, openingBalance) => m.computePayable({ ...base, vat, openingBalance });

  let r = pay({ kind: 'none' }, null);
  eq('not a VAT payer: net', r.net, 10000);
  eq('not a VAT payer: vat', r.vatAmount, 0);
  eq('not a VAT payer: gross', r.gross, 10000);

  // ⚠️ Kauno Valdorfo mokykla: a registered VAT payer printing 0.00 % on every
  // line of VAL24535. Zero is an answer, so it must not need amountsIncludeVat.
  r = pay({ kind: 'registered', rate: 0 }, null);
  eq('registered at 0 %: vat', r.vatAmount, 0);
  eq('registered at 0 %: gross', r.gross, 10000);

  r = pay({ kind: 'registered', rate: 21, amountsIncludeVat: false }, null);
  eq('21 % on net figures: net', r.net, 10000);
  eq('21 % on net figures: vat', r.vatAmount, 2100);
  eq('21 % on net figures: gross', r.gross, 12100);

  r = pay({ kind: 'registered', rate: 21, amountsIncludeVat: true }, null);
  eq('21 % inside the figures: net', r.net, 8264);
  eq('21 % inside the figures: vat', r.vatAmount, 1736);
  eq('21 % inside the figures: gross stays put', r.gross, 10000);

  // ⚠️ The refusal. Unanswered + a real rate would move the total by the rate,
  // in a direction nobody chose, and the payer is the one who finds out.
  for (const [label, vat] of [
    ['null', { kind: 'registered', rate: 21, amountsIncludeVat: null }],
    ['absent', { kind: 'registered', rate: 21 }],
  ]) {
    let threw = false;
    try { pay(vat, null); } catch { threw = true; }
    if (!threw) fail(`amountsIncludeVat ${label} with rate 21 must throw, it did not`);
  }
  // A negative rate is nonsense, not a discount.
  let threw = false;
  try { pay({ kind: 'registered', rate: -5, amountsIncludeVat: false }, null); } catch { threw = true; }
  if (!threw) fail('a negative VAT rate must throw, it did not');
  console.log('VAT: 13 checked');

  // ── Rule 4: unknown is never zero ────────────────────────────────────────
  r = pay({ kind: 'none' }, null);
  eq('balance unknown: balanceKnown', r.balanceKnown, false);
  eq('balance unknown: payable is the lines alone', r.payable, 10000);

  r = pay({ kind: 'none' }, 0);
  eq('balance known to be zero: balanceKnown', r.balanceKnown, true);
  eq('balance known to be zero: payable', r.payable, 10000);

  r = pay({ kind: 'none' }, 5000);
  eq('arrears carried over: payable', r.payable, 15000);

  // ⚠️ The case that makes this load-bearing: a parent in credit. 24 of 78 of
  // this merchant's October invoices owed nothing. Without the balance we
  // would have mailed them a link to pay 100,00 again.
  r = pay({ kind: 'none' }, -12000);
  eq('parent in credit: payable', r.payable, -2000);
  r = pay({ kind: 'none' }, -10000);
  eq('credit settles it exactly: payable', r.payable, 0);
  console.log('balance: 7 checked');

  // ── The total in words, as their own invoice prints it ───────────────────
  const WORDS = [
    [0, 'nulis'],
    [1, 'vienas'],
    [3, 'trys'],
    [11, 'vienuolika'],
    [21, 'dvidešimt vienas'],
    [100, 'šimtas'],
    [115, 'šimtas penkiolika'],
    [200, 'du šimtai'],
    // ⚠️ The real one: BL2606014 reads "Vienas tūkstantis keturiasdešimt trys".
    [1043, 'vienas tūkstantis keturiasdešimt trys'],
    [2000, 'du tūkstančiai'],
    [10000, 'dešimt tūkstančių'],
    [11000, 'vienuolika tūkstančių'],
    [21000, 'dvidešimt vienas tūkstantis'],
    [30000, 'trisdešimt tūkstančių'],
    [999999, 'devyni šimtai devyniasdešimt devyni tūkstančiai devyni šimtai devyniasdešimt devyni'],
    // Above the range it returns null and the caller prints digits: a wrong
    // word is worse than no words.
    [1000000, null],
    [-1, null],
    [1.5, null],
  ];
  for (const [n, want] of WORDS) eq(`ltWholeInWords(${n})`, m.ltWholeInWords(n), want);
  eq('amountInWordsLt(104340)', m.amountInWordsLt(104340, 'EUR'),
     'Vienas tūkstantis keturiasdešimt trys Eur 40 ct');
  eq('amountInWordsLt(5)', m.amountInWordsLt(5, 'EUR'), 'Nulis Eur 05 ct');
  eq('amountInWordsLt negative', m.amountInWordsLt(-100, 'EUR'), null);
  console.log(`words: ${WORDS.length + 3} checked`);

  // ── The payment purpose is composed by us, so its grammar is ours ────────
  //
  // ⚠️ The spreadsheet column is nominative; their invoices are accusative
  // ("Už Vladą Buivį, Sofiją Buivytę", "Už Rytį Černiauską"). Get it wrong and
  // it is wrong on every parent's bank statement at once. The last two cases
  // are from the school's own list and must come back UNTOUCHED - inventing an
  // ending for a foreign surname is worse than leaving one alone.
  const nc = await import(pathToFileURL(join(out, 'lt-name-case.js')).href);
  const NAMES = [
    ['Vladas Buivys', 'Vladą Buivį'],
    ['Sofija Buivytė', 'Sofiją Buivytę'],
    ['Rytis Černiauskas', 'Rytį Černiauską'],
    ['Lukas Vaitkus', 'Luką Vaitkų'],
    ['Augustas Červonikovas', 'Augustą Červonikovą'],
    ['Matėja Žemliauskaitė', 'Matėją Žemliauskaitę'],
    ['Julius Kazlauskas', 'Julių Kazlauską'],
    ['Monika Valčiukaitė-Vaitkienė', 'Moniką Valčiukaitę-Vaitkienę'],
    // Foreign, and left alone on purpose.
    ['Rea Ana Nissen', 'Reą Aną Nissen'],
    // An initial is not a word to decline.
    ['J. Petraitis', 'J. Petraitį'],
    ['', ''],
  ];
  for (const [from, want] of NAMES) eq(`ltAccusativeName(${JSON.stringify(from)})`, nc.ltAccusativeName(from), want);
  eq('paymentPurposeFor', nc.paymentPurposeFor('Augustas Červonikovas'), 'Už Augustą Červonikovą');
  console.log(`names: ${NAMES.length + 1} checked`);

  // ── Render for real, and insist the Unicode font took ────────────────────
  const rendered = await m.renderInvoicePdf({
    number: 'BL2611001',
    issueDate: '2026-11-01',
    dueDate: '2026-11-14',
    currency: 'EUR',
    seller: {
      name: 'UAB „Baltijos licėjus"',
      companyCode: '300123456',
      address: 'Margių Sodų g. 1, Šiauliai',
      bankName: 'AB Artea bankas',
      accountNumber: 'LT12 7300 0101 2345 6789',
    },
    buyer: { name: 'Gintarė Ščipokė', email: 'gintare@example.com' },
    lines: [
      { description: 'Pietūs', qty: 21, unit: 'vnt.', unitPrice: 480, amount: 10080 },
      { description: 'Pavakariai', qty: 21, unit: 'vnt.', unitPrice: 300, amount: 6300 },
      { description: 'Taikoma nuolaida', amount: -5460 },
      { description: 'Užimtumas po pamokų', amount: 1000 },
    ],
    vat: { kind: 'none' },
    openingBalance: null,
    paymentPurpose: 'Už Paulina Ščipokaitė',
    amountInWords: true,
    issuedBy: 'Direktorė Monika Valčiukaitė-Vaitkienė',
    lang: 'lt',
  });

  eq('rendered payable', rendered.payable, 11920);
  eq('rendered linesTotal', rendered.linesTotal, 11920);
  eq('rendered balanceKnown', rendered.balanceKnown, false);
  // ⚠️ The silent one. False here means every Lithuanian name on every invoice
  // we issue is being flattened to ASCII and nothing else would say so.
  if (rendered.unicode !== true) {
    fail('the embedded Noto Sans did not register - the invoice would be folded to ASCII. ' +
         'See the name-table note at the top of lib/pdf-font.ts.');
  }
  const head = Buffer.from(rendered.bytes.slice(0, 5)).toString('latin1');
  if (head !== '%PDF-') fail(`output is not a PDF, it starts with ${JSON.stringify(head)}`);
  if (rendered.bytes.length < 5000) fail(`PDF is implausibly small: ${rendered.bytes.length} bytes`);
  console.log(`render: 11920 payable, unicode=${rendered.unicode}, ${rendered.bytes.length} bytes`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall pass');
