#!/usr/bin/env node
/**
 * Does the portal's idea of "HexaBee still has to send this" agree with the
 * backend's idea of what it will actually send?
 *
 *     npm run verify:invoice-source
 *
 * `SENDS_FROM_HEXABEE` in lib/invoice-source.ts and `SENDABLE_SOURCES` in
 * hexabee-backend/app/invoice_sender.py are **two implementations of one
 * rule**. They have to be: the Invoices page groups a merchant's whole ledger
 * in the browser with no round-trip, while the backend is what refuses a send.
 *
 * Drift is not cosmetic in either direction. A source the portal offers and
 * the backend refuses is a button that does nothing with no reason shown; a
 * source the backend sends and the portal never listed is worse, because the
 * invoice leaves without anyone having chosen to send it.
 *
 * The history is why this file exists at all. `awaitingSend` used to ask
 * `!sent_at` alone, which parked every BCC'd invoice under "Neišsiųsta"
 * forever - found 2026-10-28 on a real row BCC'd from Gmail during a demo -
 * and `source = 'issued'` (2026-10-29) made the question load-bearing rather
 * than merely tidy.
 *
 * Run this and `python3 scripts/check_invoice_source.py` after touching
 * either file.
 *
 * Exit codes:
 *     0  every case matches
 *     1  a case disagrees, or the file could not be loaded at all
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// [source, may HexaBee send it] - the SAME table as
// hexabee-backend/scripts/check_invoice_source.py.
const CASES = [
  ['bcc', false],
  ['upload', true],
  ['issued', true],
  // Not a value anything in either repository writes. Both sides refuse it.
  ['something-new', false],
];

// ⚠️ NULL is the one value where the two sides DIVERGE, on purpose.
//
// `source` is NOT NULL in the database, so this can only come from
// /api/merchant/invoices serving `NULL::text AS source` defensively while a
// backend migration is pending. Guessing 'bcc' there would empty the "not sent
// yet" group and silently lose a month of real work, so the portal reads NULL
// as "still waiting" while the backend gate refuses to send it. Both fail
// safe: the merchant sees the row, and nothing is emailed on a guess.
const NULL_IS_AWAITING = true;

const row = (source, sent_at = null, sms_sent_at = null) => ({ source, sent_at, sms_sent_at });

const out = mkdtempSync(join(tmpdir(), 'hb-invsrc-'));
let failures = 0;
try {
  // Compile the real file rather than a copy of it - a copy is exactly the
  // failure this script exists to catch.
  execFileSync(
    'npx',
    ['tsc', 'lib/invoice-source.ts', '--outDir', out,
     '--module', 'esnext', '--target', 'es2020', '--moduleResolution', 'bundler'],
    { stdio: 'inherit' }
  );

  const mod = await import(pathToFileURL(join(out, 'invoice-source.js')).href);

  for (const [source, sendable] of CASES) {
    const got = mod.awaitingSend(row(source));
    if (got !== sendable) {
      failures += 1;
      console.error(`FAIL  awaitingSend(source=${JSON.stringify(source)}) -> ${got}, want ${sendable}`);
    }
  }
  console.log(`sources: ${CASES.length - failures}/${CASES.length} pass`);

  if (mod.awaitingSend(row(null)) !== NULL_IS_AWAITING) {
    failures += 1;
    console.error(`FAIL  awaitingSend(source=null) -> must be ${NULL_IS_AWAITING}, see the note above`);
  }

  // Already delivered by either channel is never waiting, whatever the source.
  // The two stamps are independent: a payer with no email address gets only an
  // SMS, so one NULL must not read as "not sent at all".
  const delivered = [
    ['sent by email', row('issued', '2026-11-02T09:00:00')],
    ['sent by SMS', row('issued', null, '2026-11-02T09:00:00')],
    ['uploaded and sent', row('upload', '2026-11-02T09:00:00')],
  ];
  for (const [label, r] of delivered) {
    if (mod.awaitingSend(r) !== false) {
      failures += 1;
      console.error(`FAIL  ${label}: awaitingSend() -> true, want false`);
    }
  }
  console.log(`delivered: ${delivered.length} checked`);

  // Only what HexaBee produced may be regenerated or renumbered. Offering that
  // on a merchant's own document would mean rewriting a document their
  // accounting is the author of.
  const issuedCases = [['issued', true], ['upload', false], ['bcc', false], [null, false]];
  for (const [source, want] of issuedCases) {
    const got = mod.issuedByHexabee(source);
    if (got !== want) {
      failures += 1;
      console.error(`FAIL  issuedByHexabee(${JSON.stringify(source)}) -> ${got}, want ${want}`);
    }
  }
  console.log(`issuedByHexabee: ${issuedCases.length} checked`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall pass');
