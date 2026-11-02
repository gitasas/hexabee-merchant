/**
 * Just enough .xlsx to read a merchant's own billing spreadsheet.
 *
 * **Why not a library.** Reading one sheet's cell values needs a ZIP reader and
 * a walk over very regular XML. A maintained spreadsheet library costs about a
 * megabyte in a serverless function; the npm `xlsx` package has a CVE history
 * and its maintained build is not on npm at all; and this repository has one
 * developer and no test suite, so a dependency nobody here can read is a worse
 * trade than ~200 lines that are pinned against a real merchant file.
 *
 * Node's `zlib` does the decompression: every entry in a real .xlsx is raw
 * deflate (verified on the merchant's own file), and `inflateRawSync` is
 * exactly that. No ZIP64, no encryption, no stored entries beyond the trivial
 * case - all three are rejected loudly rather than guessed at.
 *
 * ⚠️ **The one failure this file must never hide.** A formula cell carries both
 * its formula and its last cached result; we read the result. A file saved by a
 * tool that wrote no cached values has `<f>` and no `<v>`, and that cell is
 * genuinely unreadable - NOT empty. Those are counted and reported in
 * `uncachedFormulas`, because "could not look" reported as "looked and found
 * nothing" is this project's most expensive recurring mistake.
 */

import { inflateRawSync } from 'node:zlib';

export type Cell = string | number | null;

export type Sheet = {
  name: string;
  /** Row-major, 0-based, padded to the widest row. `null` is an empty cell. */
  grid: Cell[][];
  /**
   * A1 references of cells whose value could not be read at all - a formula
   * with no cached result.
   *
   * ⚠️ A count alone is not enough, and that was a real bug here. In the grid
   * such a cell is `null`, which is indistinguishable from empty - so if both
   * an amount column and the total column were uncached formulas, both would
   * read as zero, **agree with each other**, and a parent who owed money would
   * be issued a zero invoice. The importer refuses any row that touches one of
   * these, which it can only do if it knows WHICH cells they are.
   */
  unreadable: Set<string>;
};

// ── ZIP ─────────────────────────────────────────────────────────────────────

type Entry = { name: string; offset: number; compressed: number; size: number; method: number };

/** Entries of a ZIP, read through its central directory. */
function readZip(buf: Buffer): Map<string, Entry> {
  // The End of Central Directory record is at the end, after an optional
  // comment, so it is searched for backwards. 22 bytes plus up to 64 kB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx: not a ZIP archive (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff || count === 0xffff) {
    throw new Error('xlsx: ZIP64 archives are not supported - re-save the file from Excel');
  }

  const entries = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx: corrupt central directory');
    const flags = buf.readUInt16LE(p + 8);
    if (flags & 0x1) throw new Error('xlsx: the file is encrypted - remove the password and re-save');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { name, offset, compressed, size, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf: Buffer, e: Entry): string {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error(`xlsx: corrupt entry ${e.name}`);
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  // Sizes come from the central directory, never from the local header: with a
  // data descriptor the local header's are zero.
  const start = e.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressed);
  if (e.method === 0) return raw.subarray(0, e.size).toString('utf8');
  if (e.method !== 8) throw new Error(`xlsx: ${e.name} uses compression method ${e.method}, expected deflate`);
  return inflateRawSync(raw).toString('utf8');
}

// ── XML ─────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** Every `<t>` inside one shared string, concatenated - rich text is runs. */
function sharedStringText(si: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(si)) !== null) out += unescapeXml(m[1] ?? '');
  return out;
}

function readSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] === undefined ? '' : sharedStringText(m[1]));
  return out;
}

/** "BC" to 28 (1-based, as Excel counts columns). */
export function colToIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1 to "A", 28 to "AB" - what the mapping keys a column by. */
export function indexToCol(n: number): string {
  let out = '';
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
}

// ── Sheets ──────────────────────────────────────────────────────────────────

/** Sheet names, in the order the workbook lists them. */
export function readXlsxSheetNames(buf: Buffer): string[] {
  const zip = readZip(buf);
  const wb = zip.get('xl/workbook.xml');
  if (!wb) throw new Error('xlsx: xl/workbook.xml is missing - this is not a .xlsx file');
  const xml = readEntry(buf, wb);
  const names: string[] = [];
  const re = /<sheet\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const name = /\bname="([^"]*)"/.exec(m[1]);
    if (name) names.push(unescapeXml(name[1]));
  }
  return names;
}

/**
 * One sheet as a grid, by name or by 0-based position.
 *
 * Sheet order in `xl/workbook.xml` is the order a person sees in Excel, but the
 * file each `<sheet>` lives in comes from the relationships part - the Nth
 * `<sheet>` is NOT reliably `sheetN.xml`, and assuming it is reads the wrong
 * month's figures without any error at all.
 */
export function readXlsxSheet(buf: Buffer, which: string | number = 0): Sheet {
  const zip = readZip(buf);
  const wbEntry = zip.get('xl/workbook.xml');
  if (!wbEntry) throw new Error('xlsx: xl/workbook.xml is missing - this is not a .xlsx file');
  const wb = readEntry(buf, wbEntry);

  const sheets: { name: string; rid: string }[] = [];
  const sre = /<sheet\b([^>]*?)\/?>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sre.exec(wb)) !== null) {
    const name = /\bname="([^"]*)"/.exec(sm[1]);
    const rid = /\br:id="([^"]*)"/.exec(sm[1]);
    if (name && rid) sheets.push({ name: unescapeXml(name[1]), rid: rid[1] });
  }
  if (!sheets.length) throw new Error('xlsx: the workbook lists no sheets');

  const picked = typeof which === 'number' ? sheets[which] : sheets.find(s => s.name === which);
  if (!picked) {
    throw new Error(
      `xlsx: no sheet ${JSON.stringify(which)} - the file has: ${sheets.map(s => s.name).join(', ')}`
    );
  }

  const relsEntry = zip.get('xl/_rels/workbook.xml.rels');
  if (!relsEntry) throw new Error('xlsx: xl/_rels/workbook.xml.rels is missing');
  const rels = readEntry(buf, relsEntry);
  const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${picked.rid}"[^>]*>`).exec(rels);
  const target = rel && /\bTarget="([^"]*)"/.exec(rel[0]);
  if (!target) throw new Error(`xlsx: sheet ${picked.name} has no relationship target`);
  const path = target[1].replace(/^\/?(xl\/)?/, 'xl/');

  const sheetEntry = zip.get(path) ?? zip.get(path.replace(/^xl\//, ''));
  if (!sheetEntry) throw new Error(`xlsx: ${path} is missing from the archive`);
  const xml = readEntry(buf, sheetEntry);

  const ssEntry = zip.get('xl/sharedStrings.xml');
  const shared = ssEntry ? readSharedStrings(readEntry(buf, ssEntry)) : [];

  const grid: Cell[][] = [];
  const unreadable = new Set<string>();
  let width = 0;

  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const attrs = rm[1] ?? rm[3] ?? '';
    const body = rm[2] ?? '';
    const rAttr = /\br="(\d+)"/.exec(attrs);
    // Rows carry their own number, and a sheet may skip empty ones entirely -
    // so position in the file is not the row number.
    const rowIndex = rAttr ? parseInt(rAttr[1], 10) - 1 : grid.length;
    const row: Cell[] = [];

    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(body)) !== null) {
      const cAttrs = cm[1] ?? '';
      const inner = cm[2] ?? '';
      const fullRef = /\br="([A-Z]+\d+)"/.exec(cAttrs)?.[1] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(cAttrs);
      const col = ref ? colToIndex(ref[1]) - 1 : row.length;
      const type = /\bt="([^"]*)"/.exec(cAttrs)?.[1] ?? 'n';

      let value: Cell = null;
      if (type === 'inlineStr') {
        value = sharedStringText(inner) || null;
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        // ⚠️ An EMPTY `<v></v>` is not a value, and this is where the bug was.
        // openpyxl writes exactly that for a formula it has no cached result
        // for - `<c r="N15"><f>H15+I15+M15</f><v></v></c>` - and `Number('')`
        // is 0, which is finite. So an unreadable total read as zero, silently.
        // Verified against a real generated file, not reasoned about.
        const raw = v ? v[1] : null;
        if (raw === null || raw.trim() === '') {
          if (/<f[\s>]/.test(inner)) unreadable.add(fullRef || `${indexToCol(col + 1)}${rowIndex + 1}`);
        } else if (type === 's') {
          value = shared[parseInt(raw, 10)] ?? null;
        } else if (type === 'str' || type === 'd') {
          value = unescapeXml(raw);
        } else if (type === 'b') {
          value = raw === '1' ? 1 : 0;
        } else {
          const n = Number(raw);
          value = Number.isFinite(n) ? n : unescapeXml(raw);
        }
      }
      while (row.length < col) row.push(null);
      row[col] = value;
    }

    while (grid.length < rowIndex) grid.push([]);
    grid[rowIndex] = row;
    width = Math.max(width, row.length);
  }

  for (const row of grid) while (row.length < width) row.push(null);
  return { name: picked.name, grid, unreadable };
}
