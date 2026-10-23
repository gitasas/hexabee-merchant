#!/usr/bin/env node
/**
 * Does the browser's SMS price agree with the one the backend will charge?
 *
 *     npm run verify:sms
 *
 * `smsSegments` in lib/sms-template.ts and `segments()` in
 * hexabee-backend/app/sms_sender.py are **two implementations of one rule**.
 * They have to be: the editor prices the message as the merchant types, which
 * cannot be a server round-trip per keystroke, and the send has to price it
 * again where the money is actually spent.
 *
 * That makes drift the whole risk, and drift here is not cosmetic. One
 * Lithuanian diacritic moves a message from GSM-7 (160 characters a segment)
 * to UCS-2 (70), so a wrong answer shows a merchant one price and bills them
 * another - across 700 plot owners, €18 against €36.
 *
 * So the boundaries are pinned on both sides: these cases here, and the same
 * cases in `hexabee-backend/scripts/check_sms.py`. Run both after touching
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

/** A JWT-shaped string with this payload. The signature is deliberate
 *  nonsense - nothing in `jwtExpiryDate` verifies it, and nothing may. */
function jwtWith(payloadJson) {
  const body = Buffer.from(payloadJson).toString('base64url');
  return `eyJ0eXAiOiJKV1QifQ.${body}.not-a-real-signature`;
}

// [label, token, expected YYYY-MM-DD or null] - same ten cases as
// hexabee-backend/scripts/check_sms.py.
const TOKEN_CASES = [
  ['a real-shaped exp', jwtWith('{"exp":1801519200}'), '2027-02-01'],
  ['exp as a string', jwtWith('{"exp":"1801519200"}'), '2027-02-01'],
  ['no exp claim', jwtWith('{}'), null],
  ['exp is not a number', jwtWith('{"exp":"soon"}'), null],
  ['exp of zero', jwtWith('{"exp":0}'), null],
  ['negative exp', jwtWith('{"exp":-5}'), null],
  ['not a JWT at all', 'plain-looking-api-key', null],
  ['three dots but not base64', 'abc.def.ghi', null],
  ['empty', '', null],
  ['milliseconds, not seconds', jwtWith('{"exp":1801519200000}'), null],
];

// [text, expected units, expected segments, expected encoding]
const CASES = [
  ['', 0, 0, 'gsm7'],
  ['Hello', 5, 1, 'gsm7'],
  ['a'.repeat(160), 160, 1, 'gsm7'],
  ['a'.repeat(161), 161, 2, 'gsm7'],
  ['a'.repeat(306), 306, 2, 'gsm7'],
  ['a'.repeat(307), 307, 3, 'gsm7'],
  // In the GSM-7 extension table: one character, two septets.
  ['€', 2, 1, 'gsm7'],
  ['€'.repeat(80), 160, 1, 'gsm7'],
  ['€'.repeat(81), 162, 2, 'gsm7'],
  // The case the whole feature turns on: one `ė` and the budget drops to 70.
  ['Apmokėti', 8, 1, 'unicode'],
  ['ė'.repeat(70), 70, 1, 'unicode'],
  ['ė'.repeat(71), 71, 2, 'unicode'],
  ['ė'.repeat(134), 134, 2, 'unicode'],
  ['ė'.repeat(135), 135, 3, 'unicode'],
];

// Both defaults must stay byte-identical to DEFAULT_TEMPLATE in sms_sender.py:
// the merchant proofreads this text in the portal and the backend sends it.
const EXPECTED_DEFAULTS = {
  lt: '{invoice}: {amount}. Apmoketi: {link}',
  en: 'Invoice {invoice}: {amount}. Pay: {link}',
};

const out = mkdtempSync(join(tmpdir(), 'hb-sms-'));
try {
  // Compile the real file rather than testing a copy of it - a copy is exactly
  // the failure mode this script exists to catch.
  execFileSync(
    'npx',
    ['tsc', 'lib/sms-template.ts', 'lib/jwt-exp.ts', '--outDir', out,
     '--module', 'esnext', '--target', 'es2020', '--moduleResolution', 'bundler'],
    { stdio: 'inherit' }
  );

  const mod = await import(pathToFileURL(join(out, 'sms-template.js')).href);
  const jwt = await import(pathToFileURL(join(out, 'jwt-exp.js')).href);

  let failures = 0;
  for (const [text, units, segments, encoding] of CASES) {
    const got = mod.smsSegments(text);
    if (got.units !== units || got.segments !== segments || got.encoding !== encoding) {
      failures += 1;
      const label = text.length > 14 ? `${text.slice(0, 11)}... (${text.length})` : JSON.stringify(text);
      console.error(`FAIL  ${label}`);
      console.error(`        want ${encoding}/${units}u/${segments}seg`);
      console.error(`        got  ${got.encoding}/${got.units}u/${got.segments}seg`);
    }
  }
  console.log(`segments: ${CASES.length - failures}/${CASES.length} pass`);

  // ⚠️ The Tele2 key's own expiry, the second pair in this file. Tele2 said on
  // the telephone that their keys do not expire; SB „Žaluma"'s expires on
  // 2027-01-31 and the date is inside the key. `jwtExpiryDate` here and
  // `token_expiry()` in sms_sender.py each write `tele2_token_valid_until` -
  // the portal through one, the admin panel through the other.
  //
  // The last case is the dangerous one: an `exp` in milliseconds lands in the
  // year 56000 and would print as a comfortable date far in the future, which
  // is worse than admitting we do not know.
  let tokenFailures = 0;
  for (const [label, token, want] of TOKEN_CASES) {
    const got = jwt.jwtExpiryDate(token);
    if (got !== want) {
      tokenFailures += 1;
      console.error(`FAIL  token ${label}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  failures += tokenFailures;
  console.log(`tokens:   ${TOKEN_CASES.length - tokenFailures}/${TOKEN_CASES.length} pass`);

  for (const [lang, expected] of Object.entries(EXPECTED_DEFAULTS)) {
    const actual = mod.SMS_DEFAULT_TEMPLATE[lang];
    if (actual !== expected) {
      failures += 1;
      console.error(`FAIL  default template [${lang}] drifted from sms_sender.py`);
      console.error(`        want ${JSON.stringify(expected)}`);
      console.error(`        got  ${JSON.stringify(actual)}`);
    }
  }
  if (!failures) {
    console.log('defaults: match sms_sender.py');
    console.log('\nAlso run: cd ../hexabee-backend && python3 scripts/check_sms.py');
  }

  process.exit(failures ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
