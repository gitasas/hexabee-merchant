#!/usr/bin/env node
/**
 * Pins `detectInvoiceNumber` in lib/invoice-number.ts against the shapes that
 * have actually broken an invoice-number reader in this product.
 *
 *     npm run verify:invoice-number
 *
 * ⚠️ These are the same 19 cases as `scripts/check_invoice_number.js` in the
 * hexabee-cloudrun repo, which pins `detectInvoiceNumber` in `index.js`. Those
 * two readers are one rule written twice - `index.js` serves the BCC ledger
 * and the batch upload, this one serves the payer's PDF drop on /pay/[slug] -
 * and this project's own history says that pair is what keeps drifting apart.
 * A case added on one side belongs on the other in the same change.
 *
 * Why it exists rather than a note in CLAUDE.md: the number is the one field a
 * ledger row cannot work without, and this reader could not read a number
 * containing a LETTER at all. Its capture group after the label was
 * `(\d{1,20})`, so `Sąskaitos Nr.: DEMO-2026-0147` came back null - and both
 * merchants this product actually runs on number their invoices `VAL#####` and
 * `BL######`. Gemini goes first on this route, so nothing looked wrong; with
 * no `GEMINI_API_KEY`, or during a model outage, the payer's PDF drop read no
 * number whatsoever. A defect behind a safety net is still a defect, and
 * nothing in the product could see this one.
 *
 * Each case is checked in BOTH text shapes, because the shape is not a detail
 * here: `parsePdfBuffer` in app/api/invoice/parse/route.ts joins pdf2json's
 * text runs with a SPACE, so this reader never sees a newline in production,
 * while the cases below are written with them for legibility. Anything that
 * quietly depends on a line break would pass the readable half of this file
 * and still fail on every real invoice.
 *
 * Exit codes:
 *     0  every case passes in both text shapes
 *     1  a case disagrees
 *     2  the file could not be compiled or loaded at all - never read that as
 *        a pass
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// [label, page text, expected invoice number] - the same 19 cases as
// hexabee-cloudrun/scripts/check_invoice_number.js.
const CASES = [
  // A heading is itself a match. In `index.js` that meant "SĄSKAITA FAKTŪRA"
  // captured "FAKT" and the real number below was never reached; here the
  // label matched and the digits-only capture refused the number outright.
  // Different faults, one symptom: a clean invoice the rules cannot read.
  ['LT heading above the number',
    'SĄSKAITA FAKTŪRA\nPardavėjas: UAB Demo\nSąskaitos Nr.: DEMO-2026-0147\nSumokėti iki: 2026-10-15',
    'DEMO-2026-0147'],
  ['PVM heading, Serija form',
    'PVM SĄSKAITA FAKTŪRA\nSerija VAL Nr. VAL24535\nData: 2026-10-02',
    'VAL24535'],
  ['bare LT heading, number on the next line',
    'SĄSKAITA\nNr. DEMO-2026-0147',
    'DEMO-2026-0147'],
  ['EN heading above the number',
    'INVOICE\nSeller: Demo Ltd\nInvoice No. INV-2026-0088\nDate: 2026-09-30',
    'INV-2026-0088'],
  // The label must never eat the number's own prefix: with a hyphen allowed as
  // the separator, `inv` matches the "INV" of "INV-2026-0088" and the capture
  // keeps "2026-0088" - plausible, wrong, and unmatchable by a payer's `?r=`.
  ['EN "Invoice No." with a full stop',
    'Seller: Demo Ltd\nInvoice No. INV-2026-0088',
    'INV-2026-0088'],
  ['EN "Invoice Number" with slashes',
    'Seller: Demo Ltd\nInvoice Number INV/2026/0088',
    'INV/2026/0088'],
  ['EN colon form',
    'Invoice: INV-2026-0088',
    'INV-2026-0088'],
  ['EN all-digit number',
    'Invoice No. 20260088',
    '20260088'],
  ['Serija form on its own',
    'Serija VD Nr. 2026-05-127\nData: 2026-05-10',
    '2026-05-127'],

  // A code naming the PAYER or the SELLER must never become the ledger key. A
  // production row was once stored under 1070 - a pupil's registration number
  // - instead of VAL24535 (2026-10-06). Those lines sit in the buyer block,
  // which a reader that stops at the first match never reaches; one that walks
  // the whole page does reach them, so it has to walk past them by name.
  ['registration number BEFORE the invoice number',
    'SĄSKAITA FAKTŪRA\nPirkėjas: Arminas Kustinskis\nRegistracijos nr.: 1031\nSąskaitos Nr. VAL24535',
    'VAL24535'],
  ['registration number and nothing else',
    'SĄSKAITA FAKTŪRA\nPirkėjas: Arminas Kustinskis\nRegistracijos nr.: 1031',
    null],
  ['company registration number before the invoice number',
    'UAB Demo\nReg. nr. 300123456\nSąskaitos Nr. VAL24535',
    'VAL24535'],
  ['telephone number before the invoice number',
    'UAB Demo\nTelefono nr. 86012345\nSąskaitos Nr. BL2606025',
    'BL2606025'],
  ['telephone number and nothing else',
    'UAB Demo\nTelefono nr. 86012345\nEl. paštas info@demo.lt',
    null],
  ['customer number only',
    'INVOICE\nCustomer No. 44120\nBill to: John Smith',
    null],

  // The two merchants whose invoices this product actually runs on.
  ['Kauno Valdorfo shape',
    'KAUNO VALDORFO MOKYKLA\nPVM SĄSKAITA FAKTŪRA\nSerija VAL Nr. VAL24535\n' +
    'Išrašymo data 2026-10-01\nArminas Kustinskis\nRegistracijos nr.: 1031\n' +
    'IŠ VISO MOKĖTI: 434.80\nMokant pavedimu, registracijos numerį 1070 prašome ' +
    'nurodyti mokėtojo kodo laukelyje',
    'VAL24535'],
  ['Baltijos licejus shape',
    'SĄSKAITA FAKTŪRA Nr. BL2606025\nUž Rytį Černiauską\nBendra suma 1043,40\nMokėti: 0,00',
    'BL2606025'],

  // Nothing readable must stay null, so the page goes to the model rather than
  // into the ledger under an invented key.
  ['mojibake with no digits',
    'VsVnLWDV IDNWbUD SDUGDYHMDV LPRQHV NRGDV JUDILNDV SDVODXJRV VXPD PRNHWL LNL',
    null],
  ['no number anywhere on the page',
    'SĄSKAITA FAKTŪRA\nPardavėjas: UAB Demo\nSuma: 100.00 EUR',
    null],
];

// The two shapes the same page can arrive in. "spaces" is what production
// actually hands this reader; "newlines" is only how the cases are written.
const SHAPES = [
  ['newlines', (t) => t],
  ['spaces', (t) => t.replace(/\s+/g, ' ')],
];

const out = mkdtempSync(join(tmpdir(), 'hb-invno-'));
try {
  // Compile the real file rather than testing a copy of it - a copy is exactly
  // the failure this script exists to catch.
  execFileSync(
    'npx',
    ['tsc', 'lib/invoice-number.ts', '--outDir', out,
     '--module', 'esnext', '--target', 'es2020', '--moduleResolution', 'bundler'],
    { stdio: 'inherit' }
  );

  const mod = await import(pathToFileURL(join(out, 'invoice-number.js')).href);

  if (typeof mod.detectInvoiceNumber !== 'function') {
    console.error('CHECK BROKEN: detectInvoiceNumber is not exported from lib/invoice-number.ts.');
    console.error('Either it was renamed or the compile produced something else - fix that before trusting this.');
    process.exit(2);
  }

  let failures = 0;
  for (const [label, text, expected] of CASES) {
    for (const [shape, reshape] of SHAPES) {
      let got;
      try {
        got = mod.detectInvoiceNumber(reshape(text));
      } catch (err) {
        console.error(`THREW  ${label} [${shape}]: ${err && err.stack}`);
        failures += 1;
        continue;
      }
      const ok = got === expected;
      if (!ok) failures += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${`${label} [${shape}]`.padEnd(62)} ` +
        `got=${JSON.stringify(got ?? null).padEnd(18)} expected=${JSON.stringify(expected)}`
      );
    }
  }

  const assertions = CASES.length * SHAPES.length;
  console.log(
    `\n${failures === 0
      ? `all ${CASES.length} cases pass in both text shapes (${assertions} assertions)`
      : `${failures} of ${assertions} assertions FAILED across ${CASES.length} cases`}`
  );
  if (!failures) {
    console.log('Also run, in the hexabee-cloudrun repo: npm run verify:invoice-number');
  }
  process.exit(failures ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
