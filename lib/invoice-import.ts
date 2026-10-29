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
  | 'payer_phone'
  /** The person the invoice is *about* - a pupil, a participant. Becomes the
   *  payment purpose, which is usually not the payer: the mother pays, the
   *  child is enrolled. */
  | 'subject_name'
  /** An already-computed amount. See rule 1 - this is the authority. */
  | 'line_amount'
  /** The same, subtracted. Their discount column holds a positive number. */
  | 'line_discount'
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
   * `row_per_invoice` - one row is one invoice (the monthly fees sheet).
   * `row_per_line` - one row is one invoice line, grouped by payer. That is the
   * uniform-orders document, and it is phase 2: its own source still reads
   * "Iš viso: x Eur" because the merchant has not added the totals up, and a
   * total nobody computed cannot be cross-checked by rule 2.
   */
  mode: 'row_per_invoice' | 'row_per_line';
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
  if (mapping.mode === 'row_per_line') {
    throw new Error(
      'invoice-import: row_per_line is not built yet (phase 2 - the uniform orders). ' +
        'Its source has no per-invoice total, so rule 2 cannot cross-check it.'
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
  const phoneCol = roleCol('payer_phone');
  const subjectCol = roleCol('subject_name');
  const refCol = roleCol('reference');
  const dueCol = roleCol('due_date');
  const totalCol = roleCol('total_check');

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
    const dead = [...cols.values()]
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
      lines.push({
        description,
        amount,
        qty: m.qtyFrom ? toQty(cellAt(row, m.qtyFrom)) : null,
        unit: m.unit ?? null,
        unitPrice: m.unitPrice ?? null,
      });
    }
    if (badAmount) {
      refused.push({ sheetRow, label, reason: 'bad_amount', detail: badAmount });
      continue;
    }

    const linesTotal = lines.reduce((s, l) => s + l.amount, 0);

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
      if (text(statedRaw) === '' && linesTotal !== 0) {
        refused.push({
          sheetRow, label, reason: 'total_missing',
          detail: `${totalCol}${sheetRow} tuščias, o eilutės duoda ${(linesTotal / 100).toFixed(2)}`,
        });
        continue;
      }
      statedTotal = cents;
      if (statedTotal !== linesTotal) {
        refused.push({
          sheetRow, label, reason: 'total_mismatch',
          detail: `eilutės duoda ${(linesTotal / 100).toFixed(2)}, o ${totalCol}${sheetRow} rodo ${(statedTotal / 100).toFixed(2)}`,
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
      payerPhone,
      subjectName: subjectName || null,
      subjectNames: subjectName ? [subjectName] : [],
      reference: text(cellAt(row, refCol)) || null,
      dueDate,
      lines,
      statedTotal,
      linesTotal,
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
      payerPhone: first.payerPhone,
      subjectName: first.subjectName,
      subjectNames,
      reference: group.find(r => r.reference)?.reference ?? null,
      dueDate: group.find(r => r.dueDate)?.dueDate ?? null,
      lines,
      statedTotal: totals.some(t => t === null) ? null : totals.reduce((a, b) => (a ?? 0) + (b ?? 0), 0),
      linesTotal: group.reduce((sum, r) => sum + r.linesTotal, 0),
    });
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
    else if (/el\.? ?pašt|el\.? ?past|e-?mail/.test(label)) role = 'payer_email';
    else if (/telefon|phone|mob\./.test(label)) role = 'payer_phone';
    else if (/tėvel|tevel|tėvai|tevai|mokėtoj|moketoj|payer|parent/.test(label)) role = 'payer_name';
    else if (/vardas|mokin|vaik|dalyvi|pupil|child|participant/.test(label)) role = 'subject_name';
    else if (/nuolaid|discount/.test(label)) role = 'line_discount';
    else if (/apmokėti iki|apmoketi iki|termin|due date/.test(label)) role = 'due_date';
    // A quantity column is documentation, attached to a line through `qtyFrom`
    // rather than being a line of its own - see rule 1.
    else if (/\bvnt\b|kiekis|\bqty\b|quantity/.test(label)) role = 'ignore';
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
      if (/iš viso|is viso|viso|subtotal|\bvnt\b|kiekis|\bqty\b|klas|grup/.test(label)) continue;
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
  mode: 'row_per_invoice',
  sheet: '2026m. rugsėjo mėn.',
  headerRow: 5,
  firstDataRow: 7,
  columns: {
    A: { role: 'ignore' },
    B: { role: 'subject_name' },
    C: { role: 'ignore' },
    D: { role: 'payer_name' },
    E: { role: 'payer_email' },
    F: { role: 'ignore' },
    G: { role: 'ignore' },
    H: { role: 'line_amount', description: 'Pietūs', qtyFrom: 'F', unit: 'vnt.', unitPrice: 480 },
    I: { role: 'line_amount', description: 'Pavakariai', qtyFrom: 'F', unit: 'vnt.', unitPrice: 300 },
    J: { role: 'line_discount', description: 'Taikoma nuolaida' },
    K: { role: 'line_amount', description: 'Kita', descriptionFrom: 'O' },
    // "Iš viso už maistą" - a subtotal of H..J. Adding it would double-count.
    L: { role: 'ignore' },
    M: { role: 'line_amount', description: 'Užimtumas po pamokų' },
    N: { role: 'total_check' },
    O: { role: 'ignore' },
  },
  // Ten of their 46 payers have two children, and they pay for both on one
  // document - see `mergeByPayer`.
  mergeByPayer: true,
};
