/**
 * A Lithuanian personal name in the accusative, for a payment purpose.
 *
 * ⚠️ **Why this exists at all.** When HexaBee issues an invoice it composes the
 * payment purpose itself, from a pupil's name in a spreadsheet column - and
 * that column is nominative. Prefixing "Už " gives `Už Augustas Červonikovas`,
 * which is wrong Lithuanian and lands on 53 parents' bank statements at once.
 * Their own invoices read `Už Vladą Buivį, Sofiją Buivytę` and
 * `Už Rytį Černiauską`, so the accusative is what the school and the parents
 * already recognise.
 *
 * This is the opposite case from `reminders.py`, where the Lithuanian strings
 * deliberately keep a **business** name in the nominative because business
 * names cannot be declined. A person's name can be, and here it must be.
 *
 * ⚠️ **A name that matches no rule is returned untouched, deliberately.** The
 * school's own list has `Rea Ana Nissen` and `Mea Sofia Nissen` in it. Guessing
 * an ending for a foreign surname would invent a word and print it on somebody's
 * bank statement; leaving it alone merely leaves it alone. The purpose has to be
 * recognisable, not perfect.
 */

/** Longest ending first: `-ius` must beat `-us` and `-is`, `-ys` must beat `-s`. */
const ENDINGS: ReadonlyArray<readonly [string, string]> = [
  ['ius', 'ių'],
  ['ys', 'į'],
  ['is', 'į'],
  ['as', 'ą'],
  ['us', 'ų'],
  ['ė', 'ę'],
  ['a', 'ą'],
];

/** One word. Returns it unchanged when nothing matches. */
export function ltAccusativeWord(word: string): string {
  if (!word) return word;
  // A word carrying no lower-case letter is an initial or an abbreviation
  // ("J.", "UAB") - declining those produces nonsense.
  if (!/[a-ząčęėįšųūž]/.test(word)) return word;
  for (const [from, to] of ENDINGS) {
    if (word.length > from.length && word.endsWith(from)) {
      return word.slice(0, -from.length) + to;
    }
  }
  return word;
}

/**
 * A full name, word by word. Hyphenated surnames are declined on their last
 * part only, which is what Lithuanian does: `Paškūnaitė-Lickan` has a foreign
 * second half and stays as it is, while `Valčiukaitė-Vaitkienė` becomes
 * `Valčiukaitę-Vaitkienę`.
 */
export function ltAccusativeName(name: string): string {
  return name
    .trim()
    .split(/(\s+)/)
    .map(part => (/^\s+$/.test(part) ? part : part.split('-').map(ltAccusativeWord).join('-')))
    .join('');
}

/**
 * The payment purpose for an invoice HexaBee issues: "Už <name>".
 *
 * ⚠️ Capital `Už ` on purpose - `detectStatedPurpose` in `index.js` matches only
 * a capitalised `Už `, because the same word appears lower-case inside
 * `Mokymo paslaugos už 2026-05` and matching that would put the billing month
 * in the payment purpose. An issued invoice has to be readable by the same rule
 * that reads an uploaded one.
 */
export function paymentPurposeFor(name: string): string {
  return paymentPurposeForAll([name]);
}

/**
 * The same for an invoice covering several people - a parent paying for two
 * children on one document.
 *
 * Their own invoices already read this way: `BL2606014` carries
 * `Už Vladą Buivį, Sofiją Buivytę`. Every name is declined, not just the
 * first, and duplicates are dropped so a repeated row cannot print a name
 * twice on somebody's bank statement.
 */
export function paymentPurposeForAll(names: string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of names) {
    const name = ltAccusativeName(raw ?? '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    parts.push(name);
  }
  return parts.length ? `Už ${parts.join(', ')}` : '';
}
