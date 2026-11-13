/**
 * Which open invoices a bank statement may close by itself.
 *
 *   npm run verify:bank-statement
 *
 * A wrongly closed invoice is never chased again and nobody notices, so the
 * dangerous direction is closing too much. These cases pin that only a payment
 * that NAMES the invoice and pays its EXACT amount closes it, and that a name
 * or an amount alone is only ever a suggestion.
 *
 * Exit codes: 0 all agree, 1 a case disagrees, 2 the check could not run.
 */
import { compileLib } from './compile-lib.mjs';

let mod;
try {
  const lib = compileLib(['lib/bank-statement.ts'], '.verify-bankstmt');
  mod = await lib.load('bank-statement.js');
} catch (err) {
  console.error('could not compile lib/bank-statement.ts:', err);
  process.exit(2);
}
const { parseStatement, matchStatement } = mod;

const ntry = (o) => `<Ntry><Amt Ccy="${o.ccy ?? 'EUR'}">${o.amt}</Amt><CdtDbtInd>${o.ind ?? 'CRDT'}</CdtDbtInd>
  ${o.rvsl ? '<RvslInd>true</RvslInd>' : ''}<BookgDt><Dt>2026-11-05</Dt></BookgDt>
  <AcctSvcrRef>${o.ref}</AcctSvcrRef><NtryDtls><TxDtls>
  <RltdPties><Dbtr><Nm>${o.debtor ?? ''}</Nm></Dbtr></RltdPties>
  <RmtInf><Ustrd>${o.text ?? ''}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`;
const doc = (entries) => `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>${entries.join('')}</Stmt></BkToCstmrStmt></Document>`;

const INV = [
  { id: 'a', invoiceNumber: 'BL2611004', amountCents: 19920, currency: 'EUR', payerName: 'Agnė Prusaitytė-Strazdauskienė', paymentPurpose: 'Už Hubertą Strazdauską', status: 'issued' },
  { id: 'b', invoiceNumber: 'BL2611058', amountCents: 53000, currency: 'EUR', payerName: 'Agnė Prusaitytė-Strazdauskienė', paymentPurpose: null, status: 'issued' },
  { id: 'c', invoiceNumber: 'VAL24535', amountCents: 43480, currency: 'EUR', payerName: 'Jonas Darašas', paymentPurpose: '1070 Jonas Darašas', status: 'issued' },
  { id: 'd', invoiceNumber: 'BL2610001', amountCents: 6000, currency: 'EUR', payerName: 'Rūta Nissen', paymentPurpose: null, status: 'paid' },
  { id: 'e', invoiceNumber: 'BL2611030', amountCents: 6000, currency: 'EUR', payerName: 'Laura Paškūnaitė-Lickan', paymentPurpose: null, status: 'issued' },
  { id: 'f', invoiceNumber: 'BL2611012', amountCents: 6000, currency: 'EUR', payerName: 'Laura Paškūnaitė-Lickan', paymentPurpose: null, status: 'issued' },
];

// [label, entry, expected kind, expected invoice id(s)]
const CASES = [
  ['number and exact amount close', { ref: 'r1', amt: '199.20', text: 'Uz Huberta, sask. BL2611004' }, 'close', 'a'],
  ['number written with spaces still closes', { ref: 'r2', amt: '530.00', text: 'BL 2611-058' }, 'close', 'b'],
  ['registration code from the purpose closes', { ref: 'r3', amt: '434.80', text: '1070 Jonas Darasas' }, 'close', 'c'],
  ['number but a part payment only suggests', { ref: 'r4', amt: '100.00', text: 'BL2611004 dalis' }, 'suggest', 'a'],
  ['number of an invoice already paid', { ref: 'r5', amt: '60.00', text: 'BL2610001' }, 'already', 'd'],
  ['amount and name, no number - only a suggestion', { ref: 'r6', amt: '60.00', debtor: 'LAURA PASKUNAITE-LICKAN', text: 'uz mokykla' }, 'suggest', 'e,f'],
  ['amount alone never closes', { ref: 'r7', amt: '60.00', debtor: 'Kitas Zmogus', text: 'mokestis' }, 'none', ''],
  ['code must be a whole word, not a part of a number', { ref: 'r8', amt: '434.80', text: '10701 kitas' }, 'none', ''],
  ['other currency is not matched', { ref: 'r9', amt: '199.20', ccy: 'GBP', text: 'BL2611004' }, 'none', ''],
];

const ENTRIES = CASES.map(([, e]) => ntry(e));
let failures = 0;
let parsed;
try {
  parsed = parseStatement(doc([...ENTRIES, ntry({ ref: 'd1', amt: '50.00', ind: 'DBIT' }), ntry({ ref: 'rv', amt: '199.20', rvsl: true, text: 'BL2611004' })]));
} catch (err) {
  console.error('parse failed:', err);
  process.exit(2);
}
if (parsed.credits.length !== CASES.length || parsed.debitsSkipped !== 2) {
  console.log(`FAIL parse: ${parsed.credits.length} credits / ${parsed.debitsSkipped} skipped, expected ${CASES.length} / 2`);
  failures++;
}
// Each case alone against the ledger, so one cannot claim another's invoice.
CASES.forEach(([label, , kind, ids], i) => {
  const [{ outcome }] = matchStatement([parsed.credits[i]], INV);
  const got = outcome.kind === 'close' || outcome.kind === 'already' ? outcome.invoiceId
    : outcome.kind === 'suggest' ? outcome.invoiceIds.join(',') : '';
  const ok = outcome.kind === kind && got === ids;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${outcome.kind} ${got}`);
});

// Two transfers for one invoice in one file: the second must be seen.
const twice = parseStatement(doc([ntry({ ref: 't1', amt: '199.20', text: 'BL2611004' }), ntry({ ref: 't2', amt: '199.20', text: 'BL2611004' })]));
const [one, two] = matchStatement(twice.credits, INV);
const dup = one.outcome.kind === 'close' && two.outcome.kind === 'suggest';
if (!dup) failures++;
console.log(`${dup ? 'ok  ' : 'FAIL'}  second transfer for the same invoice: ${one.outcome.kind} then ${two.outcome.kind}`);

// Not a statement at all must be refused, not read as empty.
try { parseStatement('<html></html>'); console.log('FAIL  non-camt file was accepted'); failures++; }
catch { console.log('ok    non-camt file is refused'); }

if (failures) { console.log(`\n${failures} case(s) disagree.`); process.exit(1); }
console.log('\nAll bank statement cases agree.');
