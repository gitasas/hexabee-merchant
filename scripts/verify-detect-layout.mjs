/**
 * Does `detectLayout` find the headings without being told where they are?
 *
 *   npm run verify:detect-layout
 *
 * ⚠️ This replaces two form fields - "Header row" and "First data row" - that
 * asked the merchant the one thing they cannot know. `invoice-import.ts` used
 * to state that the header row "cannot be guessed"; that was decided without
 * trying, and this check is what makes the new claim an answer rather than
 * another assertion.
 *
 * The cases are shapes, not one merchant's file: a header on the first row, a
 * title above it, a row of bare numbers above it (Baltijos licėjus' unit
 * rates), a blank separator between headings and data, and a sheet with
 * nothing header-shaped, which must come back null rather than confident.
 *
 * Exit codes:
 *   0  every case matches
 *   1  a case disagrees
 *   2  the check could not run
 */
import { compileLib } from './compile-lib.mjs';

/** A sheet from a grid of plain values, as `xlsx-read` would hand it over. */
const sheet = (grid) => ({ name: 'test', grid, unreadable: new Set() });
const N = null;

const CASES = [
  {
    name: 'header on row 1, data straight after',
    grid: [
      ['Vardas', 'El. paštas', 'Suma'],
      ['Jonas Jonaitis', 'j@x.lt', 12.5],
      ['Ona Onaitė', 'o@x.lt', 30],
    ],
    want: { headerRow: 1, firstDataRow: 2 },
  },
  {
    // Their real shape: a title, a row of bare rates, the header, a blank, data.
    name: 'title and a rates row above the header, blank separator below',
    grid: [
      [N, N, N, N, N, 'Mokinių pietūs, pavakariai', N, N],
      [N, N, N, N, N, N, 4.8, 3],
      [N, 'Vardas, pavardė', 'Klasė', 'Tėveliai', 'Tėvelių el paštas', 'Pietūs ir pavakariai vnt', 'Pietūs 4.80 Eur.', 'Pavakariai 3 Eur.'],
      [N, N, N, N, N, N, N, N],
      [1, 'Augustas Červonikovas', '1VDL', 'Gintarė Sakalauskė', 'gintareskl@gmail.com', 21, 100.8, 63],
      [2, 'Milėja Vaitkutė', '1VDL', 'Monika Valčiukaitė', 'valciukaites@gmail.com', 18, 86.4, 54],
    ],
    want: { headerRow: 3, firstDataRow: 5 },
  },
  {
    // ⚠️ The case that makes counting text cells alone wrong: the data rows are
    // mostly text too. What separates them is the header's text standing over
    // columns that hold numbers.
    name: 'data rows are mostly text as well',
    grid: [
      ['Mokinys', 'Tėvas', 'El. paštas', 'Mokestis'],
      ['Augustas Červonikovas', 'Gintarė Sakalauskė', 'g@x.lt', 119.2],
      ['Milėja Vaitkutė', 'Monika Valčiukaitė', 'v@x.lt', 103.6],
      ['Matėja Žemliauskaitė', 'Ieva Žemliauskienė', 'a@x.lt', 154.2],
    ],
    want: { headerRow: 1, firstDataRow: 2 },
  },
  {
    name: 'a single title cell is not a header',
    grid: [
      ['2026 m. rugsėjo mėn.', N, N],
      ['Vardas', 'El. paštas', 'Suma'],
      ['Jonas Jonaitis', 'j@x.lt', 12.5],
      ['Ona Onaitė', 'o@x.lt', 30],
    ],
    want: { headerRow: 2, firstDataRow: 3 },
  },
  {
    name: 'leading blank rows',
    grid: [
      [N, N, N],
      [N, N, N],
      ['Vardas', 'El. paštas', 'Suma'],
      ['Jonas Jonaitis', 'j@x.lt', 12.5],
      ['Ona Onaitė', 'o@x.lt', 30],
    ],
    want: { headerRow: 3, firstDataRow: 4 },
  },
  {
    // ⚠️ Null beats a confident wrong answer: the merchant is asked instead.
    name: 'nothing header-shaped at all',
    grid: [[1, 2, 3], [4, 5, 6]],
    want: null,
  },
  {
    name: 'a header with no data under it is not a header',
    grid: [['Vardas', 'El. paštas', 'Suma']],
    want: null,
  },
];

let lib;
let mod;
try {
  lib = compileLib(['lib/invoice-import.ts'], '.verify-layout');
  mod = await lib.load('invoice-import.js');
} catch (err) {
  console.error('could not compile lib/invoice-import.ts:', err.message);
  process.exit(2);
}

let failures = 0;
for (const c of CASES) {
  let got;
  try {
    got = mod.detectLayout(sheet(c.grid));
  } catch (err) {
    failures++;
    console.log(`FAIL  ${c.name}: threw ${err.message}`);
    continue;
  }
  if (c.want === null) {
    if (got !== null) {
      failures++;
      console.log(`FAIL  ${c.name}: expected null, got row ${got.headerRow}/${got.firstDataRow}`);
    }
    continue;
  }
  if (!got) {
    failures++;
    console.log(`FAIL  ${c.name}: got null, wanted row ${c.want.headerRow}/${c.want.firstDataRow}`);
    continue;
  }
  if (got.headerRow !== c.want.headerRow || got.firstDataRow !== c.want.firstDataRow) {
    failures++;
    console.log(
      `FAIL  ${c.name}: got header ${got.headerRow}, data ${got.firstDataRow}; ` +
      `wanted ${c.want.headerRow}/${c.want.firstDataRow}`
    );
  }
}


// ── withSavedRefinements ────────────────────────────────────────────────────
// Detection decides the structure; the merchant's own wording and prices ride
// along ONLY where the column still means the same thing. Carrying "Pietūs
// 4,80" onto a column that now holds something else would relabel it with an
// old price - a wrong invoice that looks right.
const detectedCols = {
  H: { role: 'line_amount' },
  I: { role: 'line_amount' },
  J: { role: 'ignore' },
};
const savedCols = {
  columns: {
    H: { role: 'line_amount', description: 'Pietūs', unit: 'vnt.', unitPrice: 480, qtyFrom: 'F' },
    I: { role: 'total_check', description: 'Iš viso', unitPrice: 999 }, // role changed since
    J: { role: 'line_discount', description: 'Nuolaida' },
  },
};
const merged = mod.withSavedRefinements(detectedCols, savedCols);
const refCases = [
  ['role agrees: wording kept', merged.H.description === 'Pietūs' && merged.H.unitPrice === 480 && merged.H.qtyFrom === 'F'],
  ['role agrees: role unchanged', merged.H.role === 'line_amount'],
  ['role disagrees: detection wins', merged.I.role === 'line_amount'],
  ['role disagrees: refinement dropped', merged.I.description === undefined && merged.I.unitPrice === undefined],
  ['role disagrees the other way: detection wins', merged.J.role === 'ignore'],
  ['role disagrees the other way: refinement dropped', merged.J.description === undefined],
  ['no stored mapping at all', JSON.stringify(mod.withSavedRefinements(detectedCols, null)) === JSON.stringify(detectedCols)],
];
for (const [label, ok] of refCases) {
  if (!ok) { failures++; console.log(`FAIL  withSavedRefinements - ${label}`); }
}
console.log(`refinements: ${refCases.length} checked`);

lib.cleanup();

console.log(`\n${CASES.length - failures}/${CASES.length} pass`);
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all pass');
