#!/usr/bin/env node
/**
 * Does each button on the issue screen act on its own rows, and only those?
 *
 *     npm run verify:invoice-issue
 *
 * ⚠️ There are two presses and they are two different acts:
 *
 * - **"Issue N invoices"** sends a document to a family that has none.
 * - **"Reissue the N corrected ones"** sends a SECOND document to a family
 *   that already holds one, because the figure has moved since.
 *
 * The route filtered both out of one pass and answered `true` for any key it
 * had not seen regardless of the flag, so pressing reissue did both jobs:
 * Gytis pressed it for one corrected invoice on 2026-11-03 and the whole
 * remaining batch went out to real parents. Nothing could see that fail - the
 * filter was four lines inside a route handler, `tsc` was happy, and the only
 * symptom is invoices arriving at people.
 *
 * So the rule is pinned here, and the property that matters is **disjointness**:
 * no key may be selected by both passes, or one press can send a family their
 * first invoice and a second one.
 *
 * Exit codes:
 *     0  every case matches
 *     1  a case disagrees
 *     2  could not look - the lib would not compile
 */
import { compileLib } from './compile-lib.mjs';

let failures = 0;
function eq(label, got, want) {
  if (got !== want) {
    failures += 1;
    console.log(`FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const compiled = compileLib(
  ['lib/invoice-issue.ts', 'lib/invoice-pdf.ts', 'lib/invoice-import.ts',
   'lib/xlsx-read.ts', 'lib/lt-name-case.ts'],
  '.verify-invoice-issue'
);

try {
  const m = await compiled.load('invoice-issue.js');
  const correctionKey = (key, n) => `${key} #${n + 1}`.slice(0, 200);

  /** A fake ledger: what has been issued, and for how much. */
  const ledger = (rows) => ({
    has: k => Object.prototype.hasOwnProperty.call(rows, k),
    amount: k => rows[k],
  });

  const K = '2026m. rugsėjo mėn.|Augustas Červonikovas';

  // (label, key, payable, reissue, already issued, expected)
  const CASES = [
    // ── The ordinary batch: only what has never been issued ────────────────
    ['never issued, plain press', K, 11920, false, {}, true],
    ['already issued, plain press', K, 11920, false, { [K]: 11920 }, false],
    // ⚠️ THE DEFECT. A plain press must not be smuggled into the reissue pass:
    // this is the row that went out to a family that had not asked for it.
    ['never issued, REISSUE press', K, 11920, true, {}, false],

    // ── The correction pass: only an issued figure that has moved ──────────
    ['issued and the figure moved', K, 12000, true, { [K]: 11920 }, true],
    ['issued and the figure agrees', K, 11920, true, { [K]: 11920 }, false],
    // Moved, but the merchant pressed the ordinary button - that button's job
    // is first invoices, so this is somebody else's row.
    ['moved, but a plain press', K, 12000, false, { [K]: 11920 }, false],

    // ── Corrections of corrections ─────────────────────────────────────────
    ['the correction already agrees', K, 12000, true,
      { [K]: 11920, [correctionKey(K, 1)]: 12000 }, false],
    ['the correction is stale too', K, 12500, true,
      { [K]: 11920, [correctionKey(K, 1)]: 12000 }, true],
    ['two corrections, the last agrees', K, 12500, true,
      { [K]: 11920, [correctionKey(K, 1)]: 12000, [correctionKey(K, 2)]: 12500 }, false],

    // ⚠️ Issued with no amount recorded - rows from before the column, or a
    // read that came back null. Nothing to compare, so nothing to correct: a
    // second document on no evidence is the one outcome worse than none.
    ['issued, amount unknown', K, 12000, true, { [K]: undefined }, false],

    // A zero or a credit is still a statement, and still issuable.
    ['a zero invoice, never issued', K, 0, false, {}, true],
    ['a credit whose figure moved', K, -4530, true, { [K]: -4000 }, true],
  ];

  for (const [label, key, payable, reissue, issued, want] of CASES) {
    eq(`selectsForIssue (${label})`,
       m.selectsForIssue(key, payable, reissue, ledger(issued), correctionKey),
       want);
  }
  console.log(`selectsForIssue: ${CASES.length} checked`);

  // ⚠️ **Disjointness, stated as its own property rather than inferred.** For
  // every ledger state, at most ONE of the two presses may claim the row. If
  // both ever did, a single press could send a family their first invoice and
  // a correction of it.
  const STATES = [
    ['never issued', {}],
    ['issued, same figure', { [K]: 11920 }],
    ['issued, figure moved', { [K]: 11900 }],
    ['issued, amount unknown', { [K]: undefined }],
    ['corrected once', { [K]: 11900, [correctionKey(K, 1)]: 11920 }],
  ];
  for (const [label, rows] of STATES) {
    const plain = m.selectsForIssue(K, 11920, false, ledger(rows), correctionKey);
    const again = m.selectsForIssue(K, 11920, true, ledger(rows), correctionKey);
    if (plain && again) {
      failures += 1;
      console.log(`FAIL  both presses claim the row (${label}) - one press could send two documents`);
    }
  }
  console.log(`disjoint: ${STATES.length} ledger states checked`);

  if (failures) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall pass');
} catch (err) {
  // ⚠️ "Could not look" is never "looked and found nothing."
  console.error(`could not run: ${err?.stack || err}`);
  process.exit(2);
} finally {
  compiled.cleanup?.();
}
