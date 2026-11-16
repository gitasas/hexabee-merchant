import { jsPDF } from 'jspdf';
import { NOTO_SANS_REGULAR_BASE64, NOTO_SANS_BOLD_BASE64 } from './pdf-font';

/**
 * One `<invoice>-M` fee document as a PDF (2026-11-16). The bookkeeper books
 * the 0,49 EUR the payer added as the merchant's income and needs a document
 * behind every entry; Centas holds the figures but cannot carry a file.
 *
 * ⚠️ The seller is the MERCHANT - the fee is collected for them, not for
 * HexaBee. Every figure comes from the backend's `centas.fee_documents`,
 * which reads exactly what was written to Centas, so the two agree. The admin
 * panel draws the same page (`hexabee-admin/app/fee-docs-pdf.ts`).
 */

export type FeeDoc = {
  number: string;
  date: string;
  invoice_number: string;
  buyer: string;
  buyer_email: string | null;
  fee_eur: number;
  line: string;
  in_centas: boolean;
};
export type FeeSeller = {
  name: string | null; company_code: string | null; address: string | null;
  vat_code: string | null; is_vat_payer: boolean | null; iban: string | null; bank: string | null;
};

const eur = (n: number) => n.toFixed(2).replace('.', ',') + ' EUR';
const dot = (iso: string) => iso.replaceAll('-', '.');
const INK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [107, 114, 128];

export function feeDocPdf(d: FeeDoc, s: FeeSeller): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR_BASE64);
  doc.addFont('NotoSans-Regular.ttf', 'Noto', 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', NOTO_SANS_BOLD_BASE64);
  doc.addFont('NotoSans-Bold.ttf', 'Noto', 'bold');
  const font = (style: 'normal' | 'bold', size: number, color = INK) => {
    doc.setFont('Noto', style); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const L = 20, R = 190;

  font('bold', 16);
  doc.text('SĄSKAITA FAKTŪRA', L, 28);
  font('normal', 10);
  doc.text(`Serija ir Nr. ${d.number}`, L, 35);
  doc.text(`Data ${dot(d.date)}`, L, 40.5);

  let y = 54;
  font('bold', 8, MUTED); doc.text('PARDAVĖJAS', L, y); doc.text('PIRKĖJAS', 110, y);
  y += 6;
  font('bold', 10.5);
  doc.text(doc.splitTextToSize(s.name ?? '', 80)[0] ?? '', L, y);
  doc.text(doc.splitTextToSize(d.buyer, 80)[0] ?? '', 110, y);
  font('normal', 9);
  const sellerLines = [
    s.company_code ? `Įmonės kodas ${s.company_code}` : null,
    s.vat_code ? `PVM mokėtojo kodas ${s.vat_code}` : null,
    s.address,
    s.iban ? `A. s. ${s.iban}${s.bank ? ', ' + s.bank : ''}` : null,
  ].filter(Boolean) as string[];
  let ys = y + 5.5;
  for (const l of sellerLines) for (const part of doc.splitTextToSize(l, 82)) { doc.text(part, L, ys); ys += 4.6; }
  if (d.buyer_email) doc.text(d.buyer_email, 110, y + 5.5);

  y = Math.max(ys, y + 12) + 10;
  font('bold', 8, MUTED);
  doc.text('PAVADINIMAS', L, y);
  doc.text('KIEKIS', 130, y, { align: 'right' });
  doc.text('KAINA', 158, y, { align: 'right' });
  doc.text('SUMA', R, y, { align: 'right' });
  doc.setDrawColor(200, 200, 200); doc.line(L, y + 2, R, y + 2);
  y += 8;
  font('normal', 10);
  doc.text(d.line, L, y);
  doc.text('1 vnt.', 130, y, { align: 'right' });
  doc.text(eur(d.fee_eur), 158, y, { align: 'right' });
  doc.text(eur(d.fee_eur), R, y, { align: 'right' });
  font('normal', 8.5, MUTED);
  doc.text(`Sąskaitos ${d.invoice_number} apmokėjimas per HexaBee`, L, y + 5);
  doc.line(L, y + 9, R, y + 9);

  y += 17;
  font('normal', 10);
  doc.text('PVM', 130, y); doc.text('netaikomas', R, y, { align: 'right' });
  font('bold', 11.5);
  doc.text('Iš viso', 130, y + 7); doc.text(eur(d.fee_eur), R, y + 7, { align: 'right' });

  y += 22;
  font('normal', 9.5);
  doc.text(`Apmokėta ${dot(d.date)}, mokant sąskaitą ${d.invoice_number} per HexaBee.`, L, y);

  font('normal', 7.5, MUTED);
  doc.text('Dokumentas parengtas per HexaBee platformą.', L, 285);

  return new Uint8Array(doc.output('arraybuffer'));
}
