/**
 * The merchant's own spreadsheet to invoices HexaBee can issue.
 *
 * **What makes this general.** The mapping is data, not code: each merchant says
 * once which of their columns means what, it is saved on their row, and next
 * month's file maps itself. A canonical CSV for them to fill in would be the
 * one thing this product refuses - Baltijos licėjus' administrator will not
 * restructure the sheet she already maintains, and `CLAUDE.md` records that
 * there is nothing to import from in the first place.
 *
 * Three rules, all of them measured rather than reasoned, and all three about
 * refusing rather than producing:
 *
 * **1. The amount columns are authoritative; the quantity columns are
 * documentation.** Checked across all 54 rows of their real September sheet:
 * the amounts sum to the merchant's own stated total every time, but
 * `qty × rate` disagrees in one - a hand override where 21 × 4,80 was written
 * as 54,60. Recomputing would have invoiced that family €76,20 instead of
 * €30,00.
 *
 * **2. The merchant's own total is a refusal, not a label.** Because the amounts
 * do sum to it, it is a reliable cross-check - so a row where they disagree is
 * NOT issued, it is listed. That turns the hand edits above from silent data
 * corruption into two rows a person reads in a minute.
 *
 * **3. The recipient is never guessed.** The whole `merchant_payers` apparatus -
 * two independent name sources, the `ambiguous` flag, the two-candidate email
 * rule - exists because the PDF path has to infer who an invoice is for. Here
 * the merchant states it in a column, so inference is not merely unnecessary,
 * it is forbidden: a row with no recipient is refused and shown.
 *
 * Nothing here sends anything. It produces rows; sending stays the separate,
 * chunked, resumable step with its own preview, because half a parent list
 * receiving an invoice while the school believes everyone did is the worst
 * failure this product has had.
 */

import type { InvoiceLine } from './invoice-pdf';
import { colToIndex, indexToCol, type Cell, type Sheet } from './xlsx-read';

export type ColumnRole =
  | 'ignore'
  | 'payer_name'
  | 'payer_email'
  /**
   * A SECOND address for the same payer - the other parent, usually.
   *
   * ⚠️ The ledger row has carried `payer_email_cc` since the send path was
   * built, HexaBee emails the invoice to BOTH addresses, and the Invoices page
   * lets a merchant type one in by hand. The importer was the only place that
   * could not fill it, so a merchant whose sheet already holds both addresses
   * had to retype the second one 46 times. Spotted by Gytis, 2026-11-02.
   */
  | 'payer_email_cc'
  | 'payer_phone'
  /** The person the invoice is *about* - a pupil, a participant. Becomes the
   *  payment purpose, which is usually not the payer: the mother pays, the
   *  child is enrolled. */
  | 'subject_name'
  /**
   * How many - printed beside a line, never multiplied into one.
   *
   * ⚠️ **This role exists because the invoice was coming out with no quantity
   * and no unit price at all** (Gytis, 2026-11-03: *"i saskaita neikrenta nei
   * kiekis nei kaina, atsiranda tik bendra suma"*). The heading rule already
   * recognised a quantity column and marked it `ignore`, which made it
   * indistinguishable from "Klasė" or "Komentarai" - so nothing could ever
   * attach it to a line, `qty` was always null, and `unitPricePrintable`
   * therefore refused to print the rate as well. Both columns on the document
   * were empty on every invoice, and a suggested mapping could not fill them:
   * `qtyFrom` was only ever set by hand.
   *
   * It is **not** a line of its own and no arithmetic is ever done with it -
   * see rule 1. It names a column whose cells may be printed as the quantity
   * of a line that it is proven to belong to, which is what `matchQuantity`
   * decides, per row.
   */
  | 'quantity'
  /** An already-computed amount. See rule 1 - this is the authority. */
  | 'line_amount'
  /** The same, subtracted. Their discount column holds a positive number. */
  | 'line_discount'
  /**
   * What the payer owed - or had in credit - BEFORE this invoice.
   *
   * Baltijos licėjus print it as `Pradinis įsiskolinimas` and the document
   * already renders it: `computePayable` is `lines + openingBalance`, so their
   * BL2610001 reads 530,00 + (-2 650,00) = **-2 120,00**, a parent in credit.
   * Until 2026-11-03 nothing could supply the figure, so `openingBalance` was
   * always null and the block was omitted from every invoice we issued.
   *
   * ⚠️ **The sign is the merchant's, taken as printed, never derived.** On
   * their sheet a credit is a POSITIVE "Įplaukos už mokslą" (2650) while the
   * invoice prints -2650, and their "Likutis pabaigai" (2120) is the closing
   * balance, which is minus the payable. Two inversions, and there are four
   * separate receipt columns whose combination rule is theirs, not ours. So
   * the merchant states one column with the invoice's own sign and we read it
   * - the same rule as rule 1 for amounts.
   *
   * ⚠️ **It is not a line.** It never enters `linesTotal`, because it is not
   * something charged - it is what was already owed. It does enter the totals
   * check, because their "Iš viso mokėti" states the payable.
   */
  | 'opening_balance'
  /**
   * An ADVANCE account, stated as two columns: what the payer had before this
   * invoice (`advance_before`) and what is left after it (`advance_after`).
   *
   * ⚠️ **This is a different shape from `opening_balance`, not a synonym, and
   * the same school runs both.** Their tuition report reads
   * `Mokestis už mokslą 530 | Avansas 2120 | Likutis 1590 | Mokėtina suma ∅`:
   * the parent prepaid, the month's charge comes out of that, and **nothing
   * is payable** - the stated total is blank in all 28 rows, meaning zero.
   * Carrying the whole 2 120 onto the invoice the way `opening_balance` does
   * would print `Mokėti -1 590,00`, which is not what their own report says.
   *
   * ⚠️ **What is applied is read, never capped or derived**: it is
   * `before - after`, the merchant's own two figures. Measured on their real
   * October sheet, that equals the month's charge in **28 of 28** rows. When
   * it does not, the payable comes out non-zero and rule 2 refuses the row
   * against their stated total - which is the guard working, not a gap.
   *
   * ⚠️ **"Likutis" means the opposite thing on their other sheet**, where
   * "Likutis pabaigai" is the closing balance - minus the payable. So
   * `advance_after` is only ever suggested when an `advance_before` column
   * exists beside it; on its own, `likut` stays excluded as it was.
   */
  | 'advance_before'
  | 'advance_after'
  /** The merchant's own total for the row. See rule 2 - it refuses. */
  | 'total_check'
  | 'due_date'
  | 'reference';

export type ColumnMapping = {
  role: ColumnRole;
  /** Fixed line description ("Pietūs"). */
  description?: string;
  /** ...or read the description from this column, e.g. a comments column. */
  descriptionFrom?: string;
  /** Quantity column, printed beside the line. Documentation only - rule 1. */
  qtyFrom?: string;
  unit?: string;
  /** Integer cents. Printed only when it multiplies out to the amount. */
  unitPrice?: number;
};

export type ImportMapping = {
  /**
   * ⚠️ **There is one mode, and `mode` is gone from this type (2026-11-02).**
   * It used to read `'row_per_invoice' | 'row_per_line'`, and the second was
   * never built: `buildInvoices` reaching it simply threw. So the type
   * promised a system that supported two shapes of spreadsheet while one did,
   * and every reader of this file had to discover that for themselves.
   *
   * The idea it stood for - one row per invoice LINE, grouped by payer, for
   * their uniform-orders document - is not lost, it was never started. It
   * needs its own thinking when it comes: that source has no per-invoice
   * total, so rule 2 has nothing to cross-check it against, which is the
   * reason it was deferred and is still the reason.
   *
   * A stored mapping may still carry the old key, so `buildInvoices` refuses
   * anything that is not `row_per_invoice` rather than quietly treating it as
   * one - an unknown value is the one thing this codebase may not guess at.
   */
  /** Sheet name, or a 0-based index. Names beat indexes - months get added. */
  sheet?: string | number;
  /**
   * 1-based, exactly as a person reads them in Excel.
   *
   * ⚠️ Not derivable. On the merchant's real file the header is row 5 (row 4
   * holds the unit rates), row 6 is entirely blank and the data starts at row
   * 7. Any rule that guessed would have read the rates as a pupil.
   */
  headerRow: number;
  firstDataRow: number;
  /** Keyed by spreadsheet column letter: `{"D": {"role": "payer_name"}}`. */
  columns: Record<string, ColumnMapping>;
  /**
   * One invoice per PAYER rather than per row.
   *
   * ⚠️ Asked for by Baltijos licejus on 2026-10-29, and it reverses what this
   * file assumed: their sheet has one row per pupil, and the obvious reading
   * was that a parent with two children gets two invoices - which is what
   * their old documents look like. Gintare's answer: *"Tikslinga tevams,
   * kurie turi du vaikus, rasyti kartu nes moka uz abu vaikus"*. Their own
   * invoice already agrees - BL2606014 carries `Uz Vlada Buivi, Sofija
   * Buivyte`. Ten of their 46 payers have two children.
   *
   * ⚠️ Merging happens AFTER each source row has passed the totals check, so
   * rule 2 is preserved by construction: the merged total is the sum of
   * totals the merchant themselves wrote.
   */
  mergeByPayer?: boolean;
};

export type ImportedInvoice = {
  /** 1-based spreadsheet row, so a refusal can be pointed at. */
  sheetRow: number;
  /** Every source row behind this invoice - more than one when merged. */
  sheetRows: number[];
  payerName: string;
  payerEmail: string | null;
  /** The second address, when the sheet carries one. */
  payerEmailCc: string | null;
  payerPhone: string | null;
  /** The first subject, kept for screens that show one name. */
  subjectName: string | null;
  /** Everyone this invoice is about, in sheet order. Builds the purpose. */
  subjectNames: string[];
  reference: string | null;
  dueDate: string | null;
  lines: InvoiceLine[];
  /** Integer cents. The sum the merchant themselves wrote, where mapped. */
  statedTotal: number | null;
  /**
   * Integer cents carried over from before this invoice, with the merchant's
   * own sign - negative when the payer is in credit. **NULL means unknown**,
   * which the document renders by omitting the block rather than printing
   * 0,00 at a parent who has overpaid.
   */
  openingBalance: number | null;
  /**
   * True when `openingBalance` came from an ADVANCE account rather than a
   * debt brought forward, so the document names it correctly. See the
   * `advance_before` role - the same school runs both shapes.
   */
  balanceIsAdvance: boolean;
  /**
   * Integer cents of advance left after this invoice, read from the
   * merchant's own "Likutis" column. Null when they stated none.
   */
  advanceRemaining: number | null;
  /** Integer cents, from the lines. Equals `statedTotal` when both exist. */
  linesTotal: number;
};

export type RefusalReason =
  | 'total_mismatch'
  | 'total_missing'
  | 'no_payer_name'
  | 'no_recipient'
  | 'bad_amount'
  | 'bad_due_date'
  /**
   * ⚠️ A cell on this row has no readable value - a formula whose result was
   * never cached. It must refuse rather than read as zero: if an amount column
   * and the total column were both uncached, both would be zero, they would
   * AGREE, and rule 2 would wave through a zero invoice for a parent who owes
   * money.
   */
  | 'unreadable_cell';

export type RefusedRow = {
  sheetRow: number;
  /** Whatever identifies the row to a human - the subject or payer name. */
  label: string;
  reason: RefusalReason;
  /** Said plainly, for a merchant standing at the screen. */
  detail: string;
};

export type ImportResult = {
  sheetName: string;
  ready: ImportedInvoice[];
  refused: RefusedRow[];
  /** Rows that were blank, and so skipped rather than refused. */
  skipped: number;
  /**
   * Rows with content but no name on them - a column total, a price list under
   * the data. Set aside rather than refused, because they are not invoices and
   * would otherwise flood the failure list; reported rather than dropped,
   * because silence is worse than noise. See the comment at the skip.
   */
  ignored: { sheetRow: number; detail: string }[];
  /**
   * ⚠️ A1 references of cells with no readable value anywhere on the sheet.
   * Non-empty means the file is partly unreadable, which is NOT the same
   * statement as "those cells are empty", and the caller must say so - the
   * rows that touch them are in `refused` with `unreadable_cell`.
   */
  unreadable: string[];
};

// ── Cells ───────────────────────────────────────────────────────────────────

function text(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).trim();
}

/**
 * A money cell to integer cents.
 *
 * ⚠️ Rounded, not truncated, and rounded here rather than later: the merchant's
 * own file contains `109.20000000000002`, so the float noise is in the source.
 * Returns `undefined` for a cell that is not a number at all, which the caller
 * turns into a refusal instead of a zero.
 */
export function toCents(cell: Cell): number | undefined {
  if (cell === null || cell === undefined || cell === '') return 0;
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? Math.round(cell * 100) : undefined;
  }
  // A number typed as text, in either European or plain notation. Thousands
  // separators are stripped only when they leave a well-formed number.
  const raw = String(cell).trim().replace(/\s| /g, '');
  const normalised = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return undefined;
  const n = Number(normalised);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

/** A quantity cell, as a number for display. Never used in arithmetic. */
function toQty(cell: Cell): number | null {
  if (cell === null || cell === undefined || cell === '') return null;
  const n = typeof cell === 'number' ? cell : Number(String(cell).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Excel's own epoch, for a column the mapping says is a date. */
function serialToIso(serial: number): string | null {
  // Day 1 is 1900-01-01 and Excel believes 1900 was a leap year, so everything
  // from 1900-03-01 is shifted by one. The usual correction: treat day 25569 as
  // the Unix epoch.
  if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function toIsoDate(cell: Cell): string | null | undefined {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'number') return serialToIso(cell) ?? undefined;
  const s = String(cell).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = /^(\d{4})[.](\d{1,2})[.](\d{1,2})/.exec(s);
  if (dotted) {
    return `${dotted[1]}-${dotted[2].padStart(2, '0')}-${dotted[3].padStart(2, '0')}`;
  }
  return undefined;
}

// ── Mapping ─────────────────────────────────────────────────────────────────

/** `{"D": {...}}` keyed by letter, read by 0-based grid index. */
function byIndex(mapping: ImportMapping): Map<number, ColumnMapping & { col: string }> {
  const out = new Map<number, ColumnMapping & { col: string }>();
  for (const [col, m] of Object.entries(mapping.columns)) {
    if (m.role === 'ignore') continue;
    out.set(colToIndex(col) - 1, { ...m, col });
  }
  return out;
}

function cellAt(row: Cell[], col: string | undefined): Cell {
  if (!col) return null;
  return row[colToIndex(col) - 1] ?? null;
}

/**
 * Which quantity cell on this row, if any, actually multiplies out to this
 * line's amount?
 *
 * ⚠️ **This verifies rather than guesses, and the difference is the whole
 * design.** A mapping cannot say which quantity column belongs to which
 * amount, and on the real sheet it genuinely depends on the row: column F is
 * "Pietūs ir pavakariai vnt" and column G is "Tik pietūs vnt.", so the
 * quantity behind the lunch charge is **whichever of the two that pupil's
 * parent filled in**. Picking one in the mapping would print a wrong quantity
 * for every pupil on the other arrangement.
 *
 * So the amount stays the authority (rule 1) and the quantity has to earn its
 * place: `qty × unitPrice` must equal the amount already read off the sheet.
 * Nothing is computed FROM the quantity - it is only admitted when it agrees
 * with what the merchant already wrote.
 *
 * ⚠️ That is also what keeps the hand override of rule 1 honest. Leonas
 * Bunikis' row has 21 lunches written as 54,60 instead of 100,80; no quantity
 * multiplies out, so his invoice prints the amount alone rather than a
 * quantity and a rate that contradict it.
 *
 * `Math.abs`, because a discount line carries a negative amount while its
 * column holds a positive rate - their "Taikoma nuolaida -2,6 Eur" at 21 units
 * is exactly the shape, and it should print like any other line.
 */
export function matchQuantity(
  amount: number,
  unitPrice: number | null | undefined,
  candidates: { qty: number | null; unit?: string | null }[]
): { qty: number; unit: string | null } | null {
  if (unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  if (!Number.isFinite(amount)) return null;
  const want = Math.abs(Math.round(amount));
  for (const c of candidates) {
    if (c.qty == null || !Number.isFinite(c.qty) || c.qty <= 0) continue;
    if (Math.round(unitPrice * c.qty) === want) return { qty: c.qty, unit: c.unit ?? null };
  }
  return null;
}

/** The headings a merchant sees, so a mapping UI can label the columns. */
export function readHeaders(sheet: Sheet, headerRow: number): { col: string; label: string }[] {
  const row = sheet.grid[headerRow - 1] ?? [];
  return row
    .map((cell, i) => ({ col: indexToCol(i + 1), label: text(cell) }))
    .filter(h => h.label !== '');
}

/**
 * Build the invoices a mapping describes, and refuse the rest.
 *
 * ⚠️ It never sends, never assigns an invoice number and never writes anything.
 * Numbering happens at issue time, in one transaction with the ledger row, so
 * an abandoned preview leaves no gaps in the merchant's series.
 */
export function buildInvoices(sheet: Sheet, mapping: ImportMapping): ImportResult {
  // ⚠️ A mapping stored before 2026-11-02 may carry `mode`. The only value
  // that ever worked is `row_per_invoice`; anything else is refused rather
  // than read as the mode that happens to be left, because a mapping saved
  // for a different shape of sheet would produce invoices nobody designed.
  const legacyMode = (mapping as { mode?: unknown }).mode;
  if (legacyMode !== undefined && legacyMode !== 'row_per_invoice') {
    throw new Error(
      `invoice-import: unknown mapping mode ${JSON.stringify(legacyMode)}. ` +
        'Only one row per invoice is supported - re-read the file to build a new mapping.'
    );
  }

  const cols = byIndex(mapping);
  const ready: ImportedInvoice[] = [];
  const refused: RefusedRow[] = [];
  const ignored: { sheetRow: number; detail: string }[] = [];
  let skipped = 0;

  const roleCol = (role: ColumnRole): string | undefined => {
    for (const [col, m] of Object.entries(mapping.columns)) if (m.role === role) return col;
    return undefined;
  };
  const payerCol = roleCol('payer_name');
  const emailCol = roleCol('payer_email');
  const emailCcCol = roleCol('payer_email_cc');
  const phoneCol = roleCol('payer_phone');
  const subjectCol = roleCol('subject_name');
  const refCol = roleCol('reference');
  const dueCol = roleCol('due_date');
  const totalCol = roleCol('total_check');
  const balanceCol = roleCol('opening_balance');
  const advBeforeCol = roleCol('advance_before');
  const advAfterCol = roleCol('advance_after');

  // Every column the merchant (or the suggester) marked as a quantity. Read
  // once: which of them belongs to a line is decided per row, not here.
  const qtyCols = [...cols.values()].filter(m => m.role === 'quantity');

  for (let r = mapping.firstDataRow - 1; r < sheet.grid.length; r++) {
    const row = sheet.grid[r] ?? [];
    const sheetRow = r + 1;

    const payerName = text(cellAt(row, payerCol));
    const subjectName = text(cellAt(row, subjectCol));

    let anyAmount = false;
    for (const [i, m] of cols) {
      if (m.role !== 'line_amount' && m.role !== 'line_discount') continue;
      if (text(row[i]) !== '') { anyAmount = true; break; }
    }
    const statedRaw = cellAt(row, totalCol);
    const named = Boolean(payerName || subjectName);

    // A blank row - and their sheet has one in the middle of the data - is
    // skipped without a word.
    if (!named && !anyAmount && text(statedRaw) === '') {
      skipped += 1;
      continue;
    }

    // ⚠️ A row with content but NOBODY ON IT is not an invoice, and this is
    // not a theoretical shape: below the 56 pupils their sheet carries a
    // column total and an eight-line price list ("MAX - 90 Eur/men", "MIDI -
    // 60 Eur/men"...). Read as pupils those produced eight refusals, which is
    // exactly the noise that makes a failure list unreadable - and the failure
    // list is the entire point of the screen.
    //
    // So they are set aside rather than refused. NOT silently: silence is the
    // failure this project pays for most, so they come back in `ignored` with
    // what was on them, and the preview says how many. Anything carrying a
    // real name is never ignored - a pupil whose parent column is empty still
    // gets refused below, where the merchant will see it.
    if (!named) {
      const seen = [...cols.entries()]
        .map(([i, m]) => ({ col: m.col, value: text(row[i]) }))
        .filter(c => c.value !== '')
        .slice(0, 3)
        .map(c => `${c.col}: „${c.value}"`)
        .join(', ');
      ignored.push({ sheetRow, detail: seen || 'tuščia' });
      continue;
    }

    const label = subjectName || payerName || `eilutė ${sheetRow}`;

    // ⚠️ Before reading anything on this row: is any of it unreadable? See
    // `unreadable_cell` above for why this cannot be left to the totals check.
    // ⚠️ A quantity column is excluded on purpose. It is documentation, and an
    // optional field must never be able to refuse a row that carries a perfectly
    // readable amount - the rule this file already follows for `line_items`.
    // An unreadable quantity cell simply never matches, so nothing prints.
    const dead = [...cols.values()]
      .filter(m => m.role !== 'quantity')
      .map(m => `${m.col}${sheetRow}`)
      .filter(ref => sheet.unreadable.has(ref));
    if (dead.length) {
      refused.push({
        sheetRow, label, reason: 'unreadable_cell',
        detail: `${dead.join(', ')} - formulė be apskaičiuotos reikšmės. Atidarykite failą Excel'yje, leiskite perskaičiuoti ir išsaugokite.`,
      });
      continue;
    }

    // Lines, in the order the mapping lists the columns - which is the order
    // the merchant's own sheet has them, so the invoice reads like their sheet.
    const lines: InvoiceLine[] = [];
    let badAmount: string | null = null;
    for (const [i, m] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
      if (m.role !== 'line_amount' && m.role !== 'line_discount') continue;
      const cents = toCents(row[i] ?? null);
      if (cents === undefined) {
        badAmount = `${m.col}${sheetRow}: „${text(row[i])}" nėra suma`;
        break;
      }
      if (cents === 0) continue;
      const described = m.descriptionFrom ? text(cellAt(row, m.descriptionFrom)) : '';
      const description = described || m.description || `${m.col}`;
      const amount = m.role === 'line_discount' ? -cents : cents;
      // A `qtyFrom` the merchant set by hand is their answer and wins. With
      // none, every `quantity` column on the row is offered to `matchQuantity`,
      // which admits one only if it multiplies out to this amount.
      const stated = m.qtyFrom ? toQty(cellAt(row, m.qtyFrom)) : null;
      const matched = stated == null
        ? matchQuantity(amount, m.unitPrice, qtyCols.map(q => ({
            qty: toQty(cellAt(row, q.col)),
            unit: q.unit,
          })))
        : null;
      lines.push({
        description,
        amount,
        qty: stated ?? matched?.qty ?? null,
        // The unit lives on the quantity column ("... vnt"), so it comes with
        // whichever one matched unless the merchant named one on the line.
        unit: m.unit ?? matched?.unit ?? null,
        unitPrice: m.unitPrice ?? null,
      });
    }
    if (badAmount) {
      refused.push({ sheetRow, label, reason: 'bad_amount', detail: badAmount });
      continue;
    }

    const linesTotal = lines.reduce((s, l) => s + l.amount, 0);

    // ⚠️ Carried over, not charged - so it stays OUT of `linesTotal` and the
    // document shows it on its own line. An unreadable cell leaves it null,
    // which the generator renders as "unknown" by omitting the block, never
    // as zero: telling a parent in credit that their balance is 0,00 is the
    // one answer worse than saying nothing.
    let openingBalance: number | null = null;
    if (balanceCol) {
      const raw = cellAt(row, balanceCol);
      const cents = toCents(raw);
      if (cents === undefined) {
        refused.push({
          sheetRow, label, reason: 'bad_amount',
          detail: `${balanceCol}${sheetRow}: „${text(raw)}" nėra suma`,
        });
        continue;
      }
      if (text(raw) !== '') openingBalance = cents;
    }

    // ⚠️ **An advance account, which is two columns and not one.** What came
    // out of it this month is `before - after` - both the merchant's own
    // figures, so nothing here is capped, floored or derived. On their real
    // October sheet that difference equals the month's charge in 28 of 28
    // rows, which is why the payable lands on exactly 0 and their blank
    // "Mokėtina suma" is satisfied.
    let balanceIsAdvance = false;
    let advanceRemaining: number | null = null;
    if (advBeforeCol && advAfterCol) {
      const rawBefore = cellAt(row, advBeforeCol);
      const rawAfter = cellAt(row, advAfterCol);
      const before = toCents(rawBefore);
      const after = toCents(rawAfter);
      const badCol = before === undefined ? advBeforeCol : after === undefined ? advAfterCol : null;
      if (badCol) {
        refused.push({
          sheetRow, label, reason: 'bad_amount',
          detail: `${badCol}${sheetRow}: „${text(badCol === advBeforeCol ? rawBefore : rawAfter)}" nėra suma`,
        });
        continue;
      }
      if (text(rawBefore) !== '' && text(rawAfter) !== '') {
        const used = (before as number) - (after as number);
        // ⚠️ A NEGATIVE difference means the advance GREW - a top-up paid in,
        // not a charge taken out. Nothing on the row says how to invoice
        // that, and guessing would credit a parent against a month they were
        // never charged for. Refused where the merchant can see it.
        if (used < 0) {
          refused.push({
            sheetRow, label, reason: 'bad_amount',
            detail: `avansas padidėjo (${advBeforeCol}${sheetRow} ${((before as number) / 100).toFixed(2)} -> ${advAfterCol}${sheetRow} ${((after as number) / 100).toFixed(2)}), tad neaišku, ką išrašyti`,
          });
          continue;
        }
        // Applied to the invoice, so it carries the credit's own sign.
        openingBalance = -used;
        balanceIsAdvance = true;
        advanceRemaining = after as number;
      }
    }

    // What the merchant's own total states, which is what the payer owes.
    const payable = linesTotal + (openingBalance ?? 0);

    // ⚠️ Rule 2. Their own total decides whether this row may be issued.
    let statedTotal: number | null = null;
    if (totalCol) {
      const cents = toCents(statedRaw);
      if (cents === undefined) {
        refused.push({
          sheetRow, label, reason: 'total_missing',
          detail: `${totalCol}${sheetRow}: „${text(statedRaw)}" nėra suma`,
        });
        continue;
      }
      if (text(statedRaw) === '' && payable !== 0) {
        refused.push({
          sheetRow, label, reason: 'total_missing',
          detail: `${totalCol}${sheetRow} tuščias, o eilutės duoda ${(payable / 100).toFixed(2)}`,
        });
        continue;
      }
      statedTotal = cents;
      // ⚠️ Compared against the PAYABLE, not the lines. Their "Iš viso mokėti"
      // states what the parent pays, which on an invoice carrying a balance is
      // lines + balance - BL2610001 reads -2 120,00 against lines of 530,00.
      // Comparing against the lines alone would refuse every such row.
      if (statedTotal !== payable) {
        refused.push({
          sheetRow, label, reason: 'total_mismatch',
          detail: openingBalance === null
            ? `eilutės duoda ${(payable / 100).toFixed(2)}, o ${totalCol}${sheetRow} rodo ${(statedTotal / 100).toFixed(2)}`
            : `eilutės su pradiniu likučiu duoda ${(payable / 100).toFixed(2)}, o ${totalCol}${sheetRow} rodo ${(statedTotal / 100).toFixed(2)}`,
        });
        continue;
      }
    }

    if (!payerName) {
      refused.push({
        sheetRow, label, reason: 'no_payer_name',
        detail: payerCol ? `${payerCol}${sheetRow} tuščias` : 'mokėtojo stulpelis nepriskirtas',
      });
      continue;
    }

    const payerEmail = text(cellAt(row, emailCol)).replace(/\s+/g, '') || null;
    const ccRaw = text(cellAt(row, emailCcCol)).replace(/\s+/g, '') || null;
    // ⚠️ The same address twice is not two recipients. The send path
    // de-duplicates case-insensitively for exactly this reason - sending one
    // invoice to one mailbox twice spends a message out of the daily cap and
    // reads as a fault - so it is dropped here rather than carried.
    const payerEmailCc =
      ccRaw && (!payerEmail || ccRaw.toLowerCase() !== payerEmail.toLowerCase()) ? ccRaw : null;
    const payerPhone = text(cellAt(row, phoneCol)) || null;
    // ⚠️ Rule 3 - refused, never filled in from memory or from the document.
    if (!payerEmail && !payerPhone) {
      refused.push({
        sheetRow, label, reason: 'no_recipient',
        detail: 'nėra nei el. pašto, nei telefono',
      });
      continue;
    }

    let dueDate: string | null = null;
    if (dueCol) {
      const d = toIsoDate(cellAt(row, dueCol));
      if (d === undefined) {
        refused.push({
          sheetRow, label, reason: 'bad_due_date',
          detail: `${dueCol}${sheetRow}: „${text(cellAt(row, dueCol))}" neatpažinta kaip data`,
        });
        continue;
      }
      dueDate = d;
    }

    ready.push({
      sheetRow,
      sheetRows: [sheetRow],
      payerName,
      payerEmail,
      payerEmailCc,
      payerPhone,
      subjectName: subjectName || null,
      subjectNames: subjectName ? [subjectName] : [],
      reference: text(cellAt(row, refCol)) || null,
      dueDate,
      lines,
      statedTotal,
      linesTotal,
      openingBalance,
      balanceIsAdvance,
      advanceRemaining,
    });
  }

  const finalReady = mapping.mergeByPayer ? mergeByPayer(ready) : ready;
  return {
    sheetName: sheet.name, ready: finalReady, refused, skipped, ignored,
    unreadable: [...sheet.unreadable],
  };
}

/**
 * Who is this row's invoice for, for the purpose of merging?
 *
 * ⚠️ The email first, because it is the identity we actually deliver to and
 * two rows sharing an address are certainly one person. The name is the last
 * resort: two different parents can share a name, and `merchant_payers`
 * exists precisely because that has happened. A row whose address is blank
 * therefore does NOT merge into one that has an address - two invoices is the
 * safe direction, a wrong merge is not.
 */
function payerKey(row: ImportedInvoice): string {
  if (row.payerEmail) return `e:${row.payerEmail.trim().toLowerCase()}`;
  if (row.payerPhone) return `p:${row.payerPhone.replace(/\s|-/g, '')}`;
  return `n:${row.payerName.replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

/**
 * One invoice per payer instead of one per row.
 *
 * Each line keeps the name of the person it is for when the invoice covers
 * more than one - a parent seeing "Pietūs" twice could not tell which child
 * is which, and the whole reason this is one document is that they pay for
 * both.
 *
 * ⚠️ `statedTotal` is the SUM of the merchant's own totals, so the totals
 * check stays exactly as strong as it was: every row in the group has already
 * passed it individually before getting here.
 */
export function mergeByPayer(rows: ImportedInvoice[]): ImportedInvoice[] {
  const groups = new Map<string, ImportedInvoice[]>();
  for (const row of rows) {
    const key = payerKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const out: ImportedInvoice[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }
    const first = group[0];
    const subjectNames = group.flatMap(r => r.subjectNames);
    const named = subjectNames.length > 1;
    const lines = group.flatMap(r =>
      r.lines.map(l => ({
        ...l,
        // Only when it is actually ambiguous: a single-subject invoice reads
        // better without the name repeated on every line.
        description: named && r.subjectName ? `${r.subjectName}: ${l.description}` : l.description,
      }))
    );
    const totals = group.map(r => r.statedTotal);
    out.push({
      sheetRow: first.sheetRow,
      sheetRows: group.flatMap(r => r.sheetRows),
      payerName: first.payerName,
      payerEmail: first.payerEmail,
      // The first second-address anyone in the group gave. A merged
      // invoice is one document for one payer, so it has one pair of
      // addresses - not one pair per child.
      payerEmailCc: group.find(r => r.payerEmailCc)?.payerEmailCc ?? null,
      payerPhone: first.payerPhone,
      subjectName: first.subjectName,
      subjectNames,
      reference: group.find(r => r.reference)?.reference ?? null,
      dueDate: group.find(r => r.dueDate)?.dueDate ?? null,
      lines,
      statedTotal: totals.some(t => t === null) ? null : totals.reduce((a, b) => (a ?? 0) + (b ?? 0), 0),
      linesTotal: group.reduce((sum, r) => sum + r.linesTotal, 0),
      // ⚠️ The known balances add; all-unknown stays unknown. One child
      // carrying a credit and another carrying none is a parent with that
      // credit, and they pay as one - which is the whole reason this is one
      // document. Treating a blank as unknown here would discard a real
      // credit and invoice a parent who has already overpaid.
      // An advance on any child makes the merged document an advance
      // document - the label has to match what the figure is.
      balanceIsAdvance: group.some(r => r.balanceIsAdvance),
      // ⚠️ The remaining advances ADD, same reasoning as the balances below:
      // two children, one parent, one pot. All-unknown stays unknown.
      advanceRemaining: group.every(r => r.advanceRemaining === null)
        ? null
        : group.reduce((sum, r) => sum + (r.advanceRemaining ?? 0), 0),
      openingBalance: group.every(r => r.openingBalance === null)
        ? null
        : group.reduce((sum, r) => sum + (r.openingBalance ?? 0), 0),
    });
  }
  return out;
}


export type DetectedLayout = {
  /** 1-based, as a person reads them in Excel - the same scale as `ImportMapping`. */
  headerRow: number;
  firstDataRow: number;
  /** Labels found on that row. */
  labelCount: number;
  /**
   * How many of those labels stand over a column that holds numbers below -
   * the signal that separates a header from a data row of names.
   *
   * ⚠️ Numbers, not a sentence. An earlier draft returned ready-made
   * Lithuanian here, which is the same bug as a translated string in React
   * state: the portal is bilingual and a sentence born in one language never
   * changes with the toggle. The screen composes the words from its own
   * dictionary - and only there can it decline the numeral correctly, which
   * Lithuanian requires (1 pavadinimas, 3 pavadinimai, 14 pavadinimų).
   */
  numericLabels: number;
};

/**
 * Where the headings are, and where the data starts - found rather than asked.
 *
 * ⚠️ **This file used to say the header row "cannot be guessed", and that was
 * decided without trying.** It became two form fields - "Header row" and "First
 * data row" - which is the first thing a merchant is asked and the one thing
 * they have no way to answer: Gytis could not fill them in himself on staging.
 * A rule written from reasoning rather than measurement is exactly what this
 * codebase keeps paying for, so this one is measured against the real file.
 *
 * **What makes it work is that a header labels the NUMERIC columns too.** On
 * Baltijos licėjus' real September sheet:
 *
 *     row 3   one cell, a title ("Mokinių pietūs, pavakariai")
 *     row 4   three bare numbers - the unit rates, 4.8 / 3 / 2.6
 *     row 5   fourteen labels, B..O                        <- the header
 *     row 6   blank
 *     row 7   1 | Augustas Červonikovas | 1VDL | ... | 100.8 | 63 | ...
 *
 * A data row is text too - names, a class, an email - so counting text alone
 * would not separate row 7 from row 5. What separates them is that row 5 has
 * text ABOVE COLUMNS THAT HOLD NUMBERS. Row 7 has numbers there. So a label
 * over a numeric column scores double, and the title and rate rows fall away
 * on their own: one has a single cell, the other no text at all.
 *
 * ⚠️ **It is a draft, not an answer.** The screen shows the first invoices it
 * produces before anything is stored, and the merchant can correct the rows -
 * the same shape as `suggestMapping`, and the same reason it is allowed to
 * guess at all. Returning null is better than a wrong confident answer, so a
 * sheet with nothing header-shaped gets null and the merchant is asked.
 */
export function detectLayout(sheet: Sheet, searchRows = 30): DetectedLayout | null {
  const grid = sheet.grid;
  const isText = (c: Cell) => typeof c === 'string' && c.trim() !== '';
  const isNum = (c: Cell) =>
    typeof c === 'number' || (typeof c === 'string' && c.trim() !== '' && Number.isFinite(Number(c.replace(',', '.'))));
  const rowEmpty = (r: number) => !grid[r] || grid[r].every(c => c === null || c === '');

  let best: DetectedLayout | null = null;
  let bestScore = 0;

  for (let r = 0; r < Math.min(searchRows, grid.length); r++) {
    if (rowEmpty(r)) continue;
    const labels: number[] = [];
    for (let c = 0; c < grid[r].length; c++) if (isText(grid[r][c])) labels.push(c);
    // One text cell is a title, not a header. Two is the smallest real table.
    if (labels.length < 2) continue;

    // The first non-empty row below is where the data would start. Blank
    // separator rows are normal - theirs has one - so they are skipped rather
    // than treated as the end of the sheet.
    let d = r + 1;
    while (d < grid.length && rowEmpty(d)) d++;
    if (d >= grid.length) continue;

    const sample: Cell[][] = [];
    for (let i = d; i < grid.length && sample.length < 8; i++) if (!rowEmpty(i)) sample.push(grid[i]);
    if (!sample.length) continue;

    let score = 0;
    let numericLabels = 0;
    for (const c of labels) {
      const below = sample.map(row => row[c]).filter(v => v !== null && v !== '');
      if (!below.length) continue;           // a label over nothing proves nothing
      const numeric = below.filter(isNum).length;
      if (numeric / below.length >= 0.6) {
        // Text over a column of numbers: this is what a heading looks like and
        // what a data row never does.
        score += 2;
        numericLabels++;
      } else {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = {
        headerRow: r + 1,
        firstDataRow: d + 1,
        labelCount: labels.length,
        numericLabels,
      };
    }
  }

  return best;
}

/**
 * Batch labels this merchant has already issued under that look like THIS
 * sheet renamed.
 *
 * ⚠️ **The rename is the one way left to give every parent a second invoice.**
 * `issue_key` is the sheet name plus the person, so calling the tab
 * "2026m. rugsėjo mėn. (taisyta)" - exactly what somebody does while
 * CORRECTING a file - changes all 46 keys at once. Every invoice is issued
 * again under a fresh number and every family receives a second copy. The
 * figures in the file say nothing about it; only the labels already used can.
 *
 * Compared with punctuation, case and spacing removed, and a match is one
 * label containing the other - which is what a rename looks like in both
 * directions, whether the suffix was added or dropped. Different months do
 * not contain one another, so September and October never collide.
 *
 * ⚠️ **It warns and must never block.** A merchant legitimately runs more than
 * one sheet in a month - tuition and monthly fees are separate documents for
 * the same families - and those labels can contain one another too. Being
 * told "you have already issued 46 under a label like this" costs a glance;
 * refusing would stop real work on a guess.
 *
 * An exact match is not a rename and is not returned: that is the same batch,
 * which `issue_key` already handles row by row.
 */
export function similarBatches(
  current: string,
  known: { batch: string; count: number }[]
): { batch: string; count: number }[] {
  const norm = (v: string) =>
    v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const a = norm(current);
  if (!a) return [];
  // ⚠️ "Same batch" is decided on the RAW label, not the normalised one,
  // because `issueKeyFor` builds the key from the raw sheet name. "rugsėjo
  // mėn" and "rugsėjo mėn." normalise alike but key differently, so that
  // missing full stop alone issues all 46 again - the very thing being warned
  // about. Caught by the check, not by reading this twice.
  const rawCurrent = current.trim();
  return known.filter(k => {
    if (k.batch.trim() === rawCurrent) return false;
    const b = norm(k.batch);
    if (!b) return false;
    return a.includes(b) || b.includes(a);
  });
}

/**
 * The layout found in THIS file, carrying forward the merchant's own wording
 * and prices from a mapping they saved earlier.
 *
 * ⚠️ **Detection always wins on structure, and that is the point** (Gytis,
 * 2026-11-02: *"manau tai neteisinga nes cia niekas nesupras"*). A stored
 * mapping used to win outright, so a merchant who had saved one - or saved
 * something wrong while fumbling - uploaded a file and saw nothing happen,
 * with no way to tell that from the feature being broken. Which sheet, which
 * row and what each column holds are facts about the file in hand, so they are
 * re-read every time.
 *
 * What is carried over is only what detection CANNOT know and the merchant
 * alone can say: the line's wording, its unit, and its unit price - their
 * invoice prints "Pietūs 21,00 vnt. 4,80", and no amount of reading the
 * numbers produces the words "Pietūs" or the rate behind them. Plus
 * `mergeByPayer`, which is a decision about their customers, not about the
 * file.
 *
 * ⚠️ **Only where the role still agrees.** If the new file puts something else
 * in column H, carrying "Pietūs 4,80" onto it would relabel a different
 * column with an old price - a wrong invoice that looks right. A disagreement
 * drops the refinement and keeps the detected role, which at worst costs the
 * decoration and never the amount.
 */
export function withSavedRefinements(
  detected: Record<string, ColumnMapping>,
  stored: ImportMapping | null | undefined
): Record<string, ColumnMapping> {
  if (!stored?.columns) return detected;
  const out: Record<string, ColumnMapping> = {};
  for (const [col, col_] of Object.entries(detected)) {
    const prev = stored.columns[col];
    out[col] = prev && prev.role === col_.role
      ? {
          ...col_,
          description: prev.description ?? col_.description,
          descriptionFrom: prev.descriptionFrom ?? col_.descriptionFrom,
          qtyFrom: prev.qtyFrom ?? col_.qtyFrom,
          unit: prev.unit ?? col_.unit,
          unitPrice: prev.unitPrice ?? col_.unitPrice,
        }
      : col_;
  }
  return out;
}

/**
 * A first guess at what each column means, from its heading.
 *
 * ⚠️ **This is a DRAFT the merchant corrects, never a stored answer.** Nothing
 * is saved until they press save, and the preview shows every figure before a
 * single invoice exists. That is what makes guessing acceptable here when this
 * codebase refuses it almost everywhere else - a guess nobody is asked to
 * confirm is the `business_country DEFAULT 'GB'` trap, and this is the
 * opposite shape.
 *
 * It is also guarded by construction: the totals check catches a column read
 * as money that should not have been, AND one that should have been and was
 * not, because either way the lines stop summing to the merchant's own total
 * and every row is refused in front of them.
 *
 * Unmatched headings default to `ignore`, which is the conservative direction:
 * a missing line is loud (the totals disagree) while a silently invented one
 * is the thing worth avoiding.
 */
export function suggestMapping(
  headers: { col: string; label: string }[],
  /**
   * The data rows, when they are to hand.
   *
   * ⚠️ Not a nicety. Two of this merchant's four money columns are headed
   * "Kita" and "Užimtumas po pamokų" - neither says Eur, suma, kaina or
   * anything else a heading rule could catch - so heading text alone misses
   * half the invoice. What the cells actually contain is the stronger signal,
   * and it is only consulted for columns no heading rule claimed.
   */
  sample?: Cell[][]
): Record<string, ColumnMapping> {
  const columns: Record<string, ColumnMapping> = {};
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const commentsCol = headers.find(h => /komentar|pastab|comment|note/.test(norm(h.label)))?.col;
  // Does this sheet run an advance account at all? Decides what "Likutis"
  // means here - see the `advance_after` rule below.
  const hasAdvance = headers.some(h => /avans|advance|prepa/.test(norm(h.label)));
  // Whether an address column has already been claimed as the primary one.
  let seenEmail = false;

  for (const h of headers) {
    const label = norm(h.label);
    let role: ColumnRole = 'ignore';
    const extra: Partial<ColumnMapping> = {};

    // ⚠️ Order matters more than the patterns do. "Iš viso mokėti" and "Iš
    // viso už maistą" both begin "iš viso", and the second is a SUBTOTAL of
    // other columns - mapping it as money would count the food charges twice.
    // So the payable is matched first, and anything else saying "iš viso" or
    // "viso" is left alone.
    if (/mokėti|moketi|total due|amount due/.test(label)) role = 'total_check';
    else if (/iš viso|is viso|viso|subtotal|tarpinė|tarpine/.test(label)) role = 'ignore';
    // ⚠️ The SECOND email column is the second parent, not a replacement.
    // Order decides it, because a sheet rarely labels them "first" and
    // "second" - theirs says "Tėvelių el paštas" and would say the same twice.
    // An explicit word wins over position where there is one.
    else if (/el\.? ?pašt|el\.? ?past|e-?mail/.test(label)) {
      role =
        /antras|kitas|papildom|second|other|additional|cc\b|\b2\b/.test(label) || seenEmail
          ? 'payer_email_cc'
          : 'payer_email';
      if (role === 'payer_email') seenEmail = true;
    }
    else if (/telefon|phone|mob\./.test(label)) role = 'payer_phone';
    else if (/tėvel|tevel|tėvai|tevai|mokėtoj|moketoj|payer|parent/.test(label)) role = 'payer_name';
    else if (/vardas|mokin|vaik|dalyvi|pupil|child|participant/.test(label)) role = 'subject_name';
    // ⚠️ **Before the money rules, and never "likutis" on its own.** Their
    // sheet carries "Likutis pabaigai" - the CLOSING balance, which is minus
    // the payable - directly beside the opening one. Reading that as the
    // opening balance would double the correction and invert its sign on an
    // accounting document. So only a heading that says it is the opening one,
    // and "pabaig" disqualifies outright.
    else if (!/pabaig|closing/.test(label)
             // ⚠️ `\S*`, not `\w*`: `\w` is ASCII-only even here, so
             // "Pradinė skola" failed at the `ė` and read as an ordinary
             // column. The same ASCII-class trap that made `detectInvoiceNumber`
             // return "FAKT" out of "SĄSKAITA FAKTŪRA" on 2026-10-28.
             && /(pradin\S*\s*(likut|įsiskolin|isiskolin|skol))|permok|(opening\s*balance)|(balance\s*b\/?f)/.test(label)) {
      role = 'opening_balance';
    }
    // ⚠️ **Before the money rules too, and for the same reason as the
    // opening balance: these columns hold big numbers that are not charges.**
    else if (/avans|advance|prepa/.test(label)) role = 'advance_before';
    // ⚠️ **Only beside an advance column.** On their OTHER sheet "Likutis
    // pabaigai" is the closing balance - minus the payable - and reading that
    // as an advance would invert a parent's invoice. `hasAdvance` is what
    // tells the two sheets apart, and it is knowable here because this
    // function sees every heading at once.
    else if (hasAdvance && !/pabaig|closing/.test(label) && /likut|remaining|left/.test(label)) {
      role = 'advance_after';
    }
    else if (/nuolaid|discount/.test(label)) role = 'line_discount';
    else if (/apmokėti iki|apmoketi iki|termin|due date/.test(label)) role = 'due_date';
    // ⚠️ A quantity column is documentation, never a line of its own (rule 1) -
    // but it was marked `ignore` until 2026-11-03, which made it
    // indistinguishable from "Klasė", so nothing could attach it to a line and
    // the quantity and unit price were blank on every invoice we issued.
    else if (/\bvnt\b|kiekis|\bqty\b|quantity/.test(label)) {
      role = 'quantity';
      // The unit is lifted from the heading rather than invented: their column
      // reads "Pietūs ir pavakariai vnt " and their own invoice prints "vnt.".
      // No match means no unit, and the quantity prints bare.
      if (/\bvnt\b/.test(label)) extra.unit = 'vnt.';
      else if (/\bval\b|hour/.test(label)) extra.unit = 'val.';
      else if (/\bmėn\b|\bmen\b|month/.test(label)) extra.unit = 'mėn.';
    }
    else if (/klas|grup|class|group/.test(label)) role = 'ignore';
    else if (/eur|suma|mokest|kaina|amount|fee|price/.test(label)) role = 'line_amount';

    if (role === 'line_amount' || role === 'line_discount') {
      // The description is the heading with the rate and the currency taken
      // off: "Pietūs 4.80  Eur." becomes "Pietūs".
      extra.description = h.label
        .replace(/[-\u2013]?\s*\d+(?:[.,]\d{1,2})?\s*(eur|€|eurų|euru)\.?/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || h.label.trim();
      // ⚠️ A rate read out of the heading is safe even when it is wrong:
      // `unitPricePrintable` only prints it when qty × rate equals the amount,
      // so a bad guess simply never appears on the document.
      const rate = /(\d+(?:[.,]\d{1,2})?)\s*(eur|€)/i.exec(h.label);
      if (rate) {
        const cents = Math.round(Number(rate[1].replace(',', '.')) * 100);
        if (Number.isFinite(cents) && cents > 0) extra.unitPrice = cents;
      }
      if (commentsCol && /kita|other|papildom|extra/.test(label)) extra.descriptionFrom = commentsCol;
    }

    columns[h.col] = { role, ...extra };
  }

  // Columns no heading rule claimed, decided by what is in them.
  if (sample?.length) {
    // ⚠️ Only rows that carry a NAME count as data. The sample a caller has to
    // hand runs to the bottom of the sheet, and below this merchant's 56
    // pupils sit a column total and an eight-line price list - three of whose
    // cells are numbers. Counting those put "Užimtumas po pamokų" at 4
    // numeric out of 6 and the column was suggested as `ignore`, losing a
    // quarter of every invoice. Same rule `buildInvoices` uses to set those
    // rows aside, applied here so the two cannot disagree.
    const nameCols = headers
      .filter(h => columns[h.col]?.role === 'payer_name' || columns[h.col]?.role === 'subject_name')
      .map(h => colToIndex(h.col) - 1);
    const dataRows = nameCols.length
      ? sample.filter(row => nameCols.some(i => text(row[i] ?? null) !== ''))
      : sample;

    for (const h of headers) {
      if (columns[h.col]?.role !== 'ignore') continue;
      const label = norm(h.label);
      // Never override a deliberate ignore: a subtotal and a quantity column
      // are both full of numbers, and reading either as money is exactly the
      // mistake this is meant to avoid.
      // ⚠️ `likut`, `permok` and `įsiskolin` joined this list on 2026-11-03.
      // A balance column is full of numbers and reads as money, and that is
      // precisely the failure measured on their half-year sheet: "Likutis
      // pabaigai" summed into the charges turned a 530,00 invoice into
      // 5 830,00. A balance is never a line - it is either the opening one,
      // which has its own role, or the closing one, which is an output.
      // ⚠️ `avans` joined this list on 2026-11-04, and it is the dangerous
      // one: on their tuition report "Avansas" is 2 120 beside a 530 charge,
      // so reading it as a line would invoice a parent 2 650 for a month
      // that cost 530. Rule 2 refused every such row rather than issuing it,
      // which is the totals check doing exactly its job - but the merchant
      // could then issue nothing at all.
      if (/iš viso|is viso|viso|subtotal|\bvnt\b|kiekis|\bqty\b|klas|grup|likut|permok|įsiskolin|isiskolin|avans|advance|prepa/.test(label)) continue;
      const i = colToIndex(h.col) - 1;
      let filled = 0;
      let numeric = 0;
      for (const row of dataRows) {
        const cell = row[i];
        if (cell === null || cell === undefined || cell === '') continue;
        filled += 1;
        if (typeof cell === 'number' || toCents(cell) !== undefined) numeric += 1;
      }
      // Two is the floor: one stray number in a column of text is not a
      // pattern, and this is a suggestion a person still has to approve.
      if (filled >= 2 && numeric / filled >= 0.8) {
        columns[h.col] = {
          role: 'line_amount',
          description: h.label.replace(/\s{2,}/g, ' ').trim(),
          ...(commentsCol && /kita|other|papildom|extra/.test(label)
            ? { descriptionFrom: commentsCol }
            : {}),
        };
      }
    }
  }
  return columns;
}

/**
 * The mapping for Baltijos licėjus' monthly fees sheet.
 *
 * Here as the worked example a second merchant's mapping is written against,
 * and because it is what the first one is seeded with. ⚠️ Not a default for
 * anybody else: every column letter in it is theirs.
 */
export const BALTIJOS_LICEJUS_MAPPING: ImportMapping = {
  sheet: '2026m. rugsėjo mėn.',
  headerRow: 5,
  firstDataRow: 7,
  columns: {
    A: { role: 'ignore' },
    B: { role: 'subject_name' },
    C: { role: 'ignore' },
    D: { role: 'payer_name' },
    E: { role: 'payer_email' },
    // ⚠️ Two quantity columns, and neither is "the" quantity: F is "Pietūs ir
    // pavakariai vnt" and G is "Tik pietūs vnt.", so which one stands behind
    // the lunch charge depends on the pupil. `qtyFrom: 'F'` was pinned on both
    // lines here and would print a wrong count for every lunch-only child;
    // `matchQuantity` picks the one that multiplies out, row by row.
    F: { role: 'quantity', unit: 'vnt.' },
    G: { role: 'quantity', unit: 'vnt.' },
    H: { role: 'line_amount', description: 'Pietūs', unitPrice: 480 },
    I: { role: 'line_amount', description: 'Pavakariai', unitPrice: 300 },
    J: { role: 'line_discount', description: 'Taikoma nuolaida', unitPrice: 260 },
    K: { role: 'line_amount', description: 'Kita', descriptionFrom: 'O' },
    // "Iš viso už maistą" - a subtotal of H..J. Adding it would double-count.
    L: { role: 'ignore' },
    M: { role: 'line_amount', description: 'Užimtumas po pamokų' },
    N: { role: 'total_check' },
    O: { role: 'ignore' },
    // Added 2026-11-03 with the opening balance. ⚠️ Q is "Likutis pabaigai",
    // the CLOSING balance - minus the payable - and must never be read as the
    // opening one nor as money.
    P: { role: 'opening_balance' },
    Q: { role: 'ignore' },
  },
  // Ten of their 46 payers have two children, and they pay for both on one
  // document - see `mergeByPayer`.
  mergeByPayer: true,
};
