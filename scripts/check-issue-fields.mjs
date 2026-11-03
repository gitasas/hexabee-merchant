#!/usr/bin/env node
/**
 * Does every letterhead field the form touches actually get saved?
 *
 *     npm run verify:issue-fields
 *
 * ⚠️ The failure this exists for is silent in the worst way. The save route
 * copies on **only the keys it knows** (`SAVEABLE_FIELDS`), so a field added to
 * the form but not to that list is dropped on the way out - the request
 * succeeds, the screen says "saved", and the value is simply not there. No type
 * check can see it: the form reads `lh.whatever`, the body is built by hand,
 * and `res.json()` is `any` at both ends.
 *
 * So this reads the three files that have to agree and compares them as text:
 *
 * 1. `lib/issue-fields.ts`    - the list the route allows through.
 * 2. the `settings/business` form - the fields a merchant can actually type in.
 * 3. the POST body that form sends.
 *
 * It also asserts the card carries **no role gate**, which is the decision of
 * 2026-11-03: at both schools the director owns the account and somebody else
 * does the invoicing, so an owner-only letterhead meant the school's own
 * address could only be typed by the person who never signs in. A
 * `disabled={isStaff}` reappearing on one of these inputs would put that back
 * for one field at a time, which is exactly how it would go unnoticed.
 *
 * Exit codes:
 *     0  everything agrees
 *     1  a disagreement, named
 *     2  could not look - a file moved or could not be read. ⚠️ Never reported
 *        as "looked and found nothing", which this codebase has paid for twice.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS = 'lib/issue-fields.ts';
const FORM = 'app/(merchant-portal)/merchant/(portal)/settings/business/page.tsx';
const ROUTE = 'app/api/merchant/invoices/issue-settings/route.ts';

function read(rel) {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch (err) {
    console.error(`could not read ${rel}: ${err.message}`);
    process.exit(2);
  }
}

const fieldsSrc = read(FIELDS);
const formSrc = read(FORM);
const routeSrc = read(ROUTE);

/** The declared list, read out of the `LETTERHEAD_FIELDS` array literal. */
function declaredFields() {
  const block = fieldsSrc.match(/LETTERHEAD_FIELDS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) {
    console.error(`could not find LETTERHEAD_FIELDS in ${FIELDS}`);
    process.exit(2);
  }
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

/** Every `lh.<field>` the form reads or writes - what a merchant can edit. */
function formFields() {
  const card = formSrc.indexOf('t.issue.letterhead.title');
  if (card < 0) {
    console.error(`could not find the letterhead card in ${FORM}`);
    process.exit(2);
  }
  // `blockers` is served by the backend and never saved; `lh` itself is the
  // state object. Everything else named here is a column.
  const skip = new Set(['blockers']);
  const names = new Set();
  for (const m of formSrc.slice(card).matchAll(/\blh\.([a-z_]+)/g)) {
    if (!skip.has(m[1])) names.add(m[1]);
  }
  return [...names];
}

/** The keys the form's POST body actually sends. */
function postedFields() {
  const body = formSrc.match(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/);
  if (!body) {
    console.error(`could not find the letterhead POST body in ${FORM}`);
    process.exit(2);
  }
  return [...body[1].matchAll(/^\s*([a-z_]+):/gm)].map(m => m[1]);
}

const declared = declaredFields();
const onForm = formFields();
const posted = postedFields();

let failures = 0;
function fail(msg) {
  failures += 1;
  console.log(`FAIL  ${msg}`);
}

// 1. Nothing a merchant can type in may be missing from the allowlist, or the
//    route drops it and the save reports success anyway.
for (const f of onForm) {
  if (!declared.includes(f)) {
    fail(`'${f}' is editable on the form but missing from LETTERHEAD_FIELDS - the route would drop it silently`);
  }
  if (!posted.includes(f)) {
    fail(`'${f}' is editable on the form but never sent in the POST body`);
  }
}

// 2. And nothing is sent that the route will not carry.
for (const f of posted) {
  if (!declared.includes(f)) {
    fail(`'${f}' is posted by the form but missing from LETTERHEAD_FIELDS`);
  }
}

// 3. A declared field nobody can edit is dead weight rather than a hazard, but
//    it usually means a form input was removed and the list was not.
for (const f of declared) {
  if (!onForm.includes(f)) {
    fail(`'${f}' is in LETTERHEAD_FIELDS but nothing on the form edits it`);
  }
}

console.log(`fields: ${declared.length} declared, ${onForm.length} on the form, ${posted.length} posted`);

/**
 * Comments stripped, because a check that fails over a comment is a check
 * nobody runs - this one did on its first run, on a comment that said the card
 * carries no `isStaff`. Block comments and whole comment lines only, so a `//`
 * inside a URL on a line of real code is left alone.
 */
function withoutComments(src) {
  return src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    .replace(/^\s*(\/\/|\*).*$/gm, '');
}

// 4. ⚠️ The card must carry no role gate. Checked on the card's own slice, so
//    the owner rule on the business form above is untouched by this.
const cardSrc = withoutComments(formSrc.slice(formSrc.indexOf('t.issue.letterhead.title')));
const gates = [...cardSrc.matchAll(/isStaff|isOwner|owner_only|ownerOnly/g)].map(m => m[0]);
if (gates.length) {
  fail(`the letterhead card carries a role gate again (${[...new Set(gates)].join(', ')}) - these are invoice details and staff enter them`);
} else {
  console.log('role gate: none in the letterhead card, as intended');
}

// 5. The route must not have regrown one either - the UI is not the enforcement
//    point and never was, so this is the half that actually decides.
if (/owner_only|isOwner/.test(withoutComments(routeSrc))) {
  fail(`${ROUTE} refuses a staff session again - the form would then invite an edit the API rejects`);
} else {
  console.log('route: no owner gate, as intended');
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall pass');
