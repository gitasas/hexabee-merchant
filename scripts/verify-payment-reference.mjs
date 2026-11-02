/**
 * What may be sent in Montonio's STRUCTURED reference field.
 *
 *   npm run verify:payment-reference
 *
 * This is the only field in the Montonio payload a bank can refuse the payment
 * over - their docs: "banks validate this number strictly and payments will
 * start failing if this number is not formatted correctly". So the rule that
 * decides what goes in it is pinned, and the cases are taken from real
 * invoices rather than invented:
 *
 *   VAL25485  "1107 Vilija Juknaitė"            -> 1107
 *   VAL24535  "1070 Jonas Darašas"              -> 1070
 *   VAL24654  "1031 Arminas Kustinskis"         -> 1031
 *   NUOM-2691 "AA-017A Raimondas Gabrilavičius" -> null   <- would break the payment
 *   Baltijos licėjus "Už Vladą Buivį, ..."      -> null
 *   SB „Žaluma" "Z2410 Brigita Sprindienė"      -> null
 *
 * ⚠️ The naive rule - send the purpose's first token whatever it is - passes
 * three of those and silently breaks the other three. Six cases here fail
 * against it, which is the only reason to trust the rest.
 *
 * Exit codes:
 *   0  every case matches
 *   1  a case disagrees
 *   2  the check could not run
 */
import { compileLib } from './compile-lib.mjs';

// [purpose, enabled, expected, provider?]
const CASES = [
  // --- banks with no reference field at all ---
  // Gytis, 2026-11-02: Revolut gives the payer no such box, so sending one is
  // the risky direction. Matched as a substring of Montonio's provider code.
  ['1107 Vilija Juknaitė', true, null, 'revolut'],
  ['1107 Vilija Juknaitė', true, null, 'REVOLUT21'],
  ['1107 Vilija Juknaitė', true, null, 'N26'],
  ['1107 Vilija Juknaitė', true, null, 'wise'],
  // Everything else is unaffected, including no provider at all - the payer
  // may not have chosen a bank yet when the order is created.
  ['1107 Vilija Juknaitė', true, '1107', 'SWEDBANK_LT'],
  ['1107 Vilija Juknaitė', true, '1107', null],
  ['1107 Vilija Juknaitė', true, '1107', ''],

  // --- Kauno Valdorfo mokykla, the merchant who asked for this ---
  ['1107 Vilija Juknaitė', true, '1107'],
  ['1070 Jonas Darašas', true, '1070'],
  ['1031 Arminas Kustinskis', true, '1031'],
  // ⚠️ Their OWN rental invoice. Letters and a hyphen, so the bank would
  // refuse it - and this is why the rule is not "the first token".
  ['AA-017A Raimondas Gabrilavičius', true, null],
  // A bare code with no name above it on the page is still a code.
  ['168', true, '168'],

  // --- other live merchants, who must be untouched ---
  // Baltijos licėjus state the purpose in words; there is no code at all.
  ['Už Vladą Buivį, Sofiją Buivytę', true, null],
  ['Už Rytį Černiauską', true, null],
  // SB „Žaluma" put the plot number in the buyer's code field: a letter and
  // digits, which this field cannot carry.
  ['Z2410 Brigita Sprindienė', true, null],

  // --- the gate itself ---
  // Off, or never answered: a merchant who asked for none of this must not
  // start sending a bank-validated field. NULL is "nobody asked", not "yes".
  ['1107 Vilija Juknaitė', false, null],
  ['1107 Vilija Juknaitė', null, null],
  ['1107 Vilija Juknaitė', undefined, null],

  // --- shapes that must never reach a bank ---
  [null, true, null],
  [undefined, true, null],
  ['', true, null],
  ['   ', true, null],
  // Not a code: a label word that survived extraction.
  ['Registracijos', true, null],
  // Decimals, signs and separators are not reference numbers.
  ['1107.5 Vardas', true, null],
  ['-1107 Vardas', true, null],
  ['1107/2 Vardas', true, null],
  ['1 107 Vardas', true, '1'],   // the token IS "1"; the rest is not the code
  // Absurdly long: refused rather than truncated, because a truncated
  // reference is a different reference and would reconcile to nothing.
  ['1'.repeat(21) + ' Vardas', true, null],
  ['1'.repeat(20) + ' Vardas', true, '1'.repeat(20)],
  // Leading whitespace is the ledger's, not the payer's.
  ['  1031 Arminas Kustinskis', true, '1031'],
];

let mod;
let lib;
try {
  lib = compileLib(['lib/payment-reference.ts'], '.verify-payref');
  mod = await lib.load('payment-reference.js');
} catch (err) {
  console.error('could not compile lib/payment-reference.ts:', err.message);
  process.exit(2);
}

let failures = 0;
for (const [purpose, enabled, want, provider] of CASES) {
  let got;
  try {
    got = mod.montonioReference(purpose, enabled, provider);
  } catch (err) {
    // Loud: a throw here would reach /api/payment/montonio and take down a
    // payment, which is worse than sending nothing.
    failures++;
    console.log(`FAIL  threw on ${JSON.stringify(purpose)} (enabled=${enabled}): ${err.message}`);
    continue;
  }
  if (got !== want) {
    failures++;
    console.log(
      `FAIL  ${JSON.stringify(purpose)} (enabled=${enabled}, provider=${JSON.stringify(provider)}) -> ${JSON.stringify(got)}, want ${JSON.stringify(want)}`
    );
  }
}

lib.cleanup();

console.log(`\n${CASES.length - failures}/${CASES.length} pass`);
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all pass');
