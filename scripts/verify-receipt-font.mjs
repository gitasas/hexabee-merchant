/**
 * Proves the embedded receipt font still works. Run after touching
 * app/payment-success/receipt-font.ts:
 *
 *   npm run verify:receipt-font
 *
 * Why this exists: jsPDF parses an embedded TTF inside a PubSub handler and
 * swallows anything that handler throws, so addFont() "succeeds" for a font it
 * could not read. Nothing fails at build time, tsc is happy, the page renders —
 * and the first payer to press Download gets a dead button. That is exactly how
 * the receipt would silently go back to being unusable.
 *
 * The specific trap: jsPDF's name-table parser needs nameID 6 (PostScript name)
 * or, failing that, nameID 4 — it has no third fallback. Subsetting a font with
 * --name-IDs='' drops both, and the parse throws where nothing reports it. The
 * command in receipt-font.ts keeps 0,1,2,4,6,14 for that reason. Verified by
 * running this script against each variant, including a deliberately broken one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const fontModule = join(here, '..', 'app', 'payment-success', 'receipt-font.ts');

// A sample of every alphabet the subset promises to cover, plus the euro sign.
const SAMPLE = 'Apmokėta 18,49 € — sąskaitos ĄČĘĖĮŠŲŪŽ āēīļņ õäöü ąćęłńóśźż';

function base64Of(name, source) {
  const at = source.indexOf(`export const ${name} =`);
  if (at === -1) throw new Error(`${name} is not exported from receipt-font.ts`);
  const statement = source.slice(at, source.indexOf(';', at));
  const parts = statement.match(/'([A-Za-z0-9+/=]+)'/g);
  if (!parts) throw new Error(`${name} holds no base64`);
  return parts.map((p) => p.slice(1, -1)).join('');
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const source = readFileSync(fontModule, 'utf8');
const { jsPDF } = require('jspdf');
const doc = new jsPDF({ unit: 'mm', format: 'a4' });

doc.addFileToVFS('NotoSans-Regular.ttf', base64Of('NOTO_SANS_REGULAR_BASE64', source));
doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
doc.addFileToVFS('NotoSans-Bold.ttf', base64Of('NOTO_SANS_BOLD_BASE64', source));
doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');

// The same question the page asks before it draws anything.
for (const style of ['normal', 'bold']) {
  try {
    doc.setFont('NotoSans', style);
    if (!(doc.getTextWidth(SAMPLE) > 0)) fail(`NotoSans ${style} measures the sample as zero-width.`);
  } catch (err) {
    fail(
      `NotoSans ${style} did not register: ${err.message}\n` +
        `  jsPDF swallowed the real parse error. The usual cause is a missing\n` +
        `  PostScript name: re-subset keeping --name-IDs=0,1,2,4,6,14 (see receipt-font.ts).`
    );
  }
}

// And that the document really draws with it rather than falling back.
doc.setFont('NotoSans', 'normal');
doc.text(SAMPLE, 15, 20);
doc.setFont('NotoSans', 'bold');
doc.text(SAMPLE, 15, 30);

const pdf = doc.output();
if (!pdf.includes('/FontFile2')) fail('The PDF embeds no font file — nothing was subset into it.');
if (!/\/BaseFont\s*\/[A-Za-z0-9+,-]*NotoSans/.test(pdf)) fail('The PDF carries no NotoSans font object.');

const used = [...new Set([...pdf.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf/g)].map((m) => m[1]))];
const notoRefs = [...pdf.matchAll(/\/(F\d+)\s+\d+\s+0\s+R/g)]
  .map((m, i) => ({ ref: m[1], i }))
  .slice(14) // jsPDF registers the 14 standard PDF fonts first
  .map((f) => f.ref);
const drawnWithFallback = used.filter((f) => !notoRefs.includes(f));
if (drawnWithFallback.length > 0) {
  fail(`Text was drawn with a non-embedded font (${drawnWithFallback.join(', ')}) — jsPDF fell back to Helvetica.`);
}

console.log('✓ receipt font: both weights register, and the PDF draws Lithuanian text with them.');
