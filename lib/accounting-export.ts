/**
 * The generic accounting file (2026-11-16): sales documents a bookkeeper
 * imports into a program we have no API for (Dineta, B1, anything else).
 *
 * One row per document LINE, with the document's own fields repeated on each
 * row - the shape every Lithuanian program's spreadsheet import accepts, and
 * the one a bookkeeper can re-map by hand when hers wants different columns.
 * A program-specific format replaces this only once it is written from that
 * program's real import template.
 *
 * What goes in, and why only this:
 * - Invoices HexaBee ISSUED (`source = 'issued'`). A BCC'd or uploaded
 *   invoice was made in the merchant's own program and is already in their
 *   books; importing it again would book the sale twice.
 * - The 0,49 EUR fee documents (`<invoice>-M`), which exist nowhere else.
 *
 * ⚠️ The same three rules as the Centas writer, because this is the same
 * document written to a file instead of an API:
 * - The document total is the SUM OF THE LINES, never `amount` - `amount` is
 *   what the payer still owes, and an advance applied on the face of the
 *   invoice would otherwise book a sale of 0,00.
 * - Quantity is 1 and the price is the line total. The ledger stores no unit
 *   price, and dividing a hand-overridden line (21 x 4,80 written as 54,60)
 *   invents a rate the merchant never charged.
 * - VAT is filled only for a merchant who answered "not a VAT payer"
 *   (0 %, net = gross). For a VAT payer the split is not stored, so the VAT
 *   columns are left blank rather than re-derived here.
 */

export type IssuedRow = {
  invoice_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  payer_name: string | null;
  payer_email: string | null;
  line_items: unknown;
  amount: string | number | null;
  currency: string | null;
  status: string;
  paid_at: string | null;
};

export type FeeDocRow = {
  number: string;
  date: string;
  invoice_number: string;
  buyer: string;
  buyer_email: string | null;
  fee_eur: number;
  line: string;
};

export const ACCOUNTING_HEADERS = [
  'Dokumento tipas', 'Dokumento nr.', 'Data', 'Apmokėti iki', 'Pirkėjas', 'Pirkėjo el. paštas',
  'Eilutė', 'Pavadinimas', 'Kiekis', 'Kaina', 'Suma be PVM', 'PVM %', 'PVM suma', 'Suma su PVM',
  'Dokumento suma', 'Mokėtina suma', 'Valiuta', 'Apmokėta', 'Apmokėjimo data', 'Susijusi sąskaita',
];

type Cell = string | number | null;

const cents = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : Math.round(n * 100);
};
const day = (v: string | null) => (v ? String(v).slice(0, 10) : '');

export function accountingRows(
  issued: IssuedRow[],
  fees: FeeDocRow[],
  vatPayer: boolean | null,
  money: (c: number) => string,
): Cell[][] {
  const rows: Cell[][] = [];
  const noVat = vatPayer === false;
  const vatCells = (c: number): Cell[] => (noVat ? ['0', money(0), money(c)] : ['', '', '']);

  for (const inv of issued) {
    if (!inv.invoice_number) continue;
    const items = (Array.isArray(inv.line_items) ? inv.line_items : [])
      .map((it) => ({ d: String((it as { description?: unknown })?.description ?? '').trim(), c: cents((it as { amount?: unknown })?.amount) }))
      .filter((it): it is { d: string; c: number } => it.c !== null);
    const payable = cents(inv.amount);
    const lines = items.length ? items : payable !== null ? [{ d: 'Paslaugos', c: payable }] : [];
    const total = lines.reduce((s, l) => s + l.c, 0);
    const paid = inv.status === 'paid';
    lines.forEach((l, i) => {
      rows.push([
        'Sąskaita faktūra', inv.invoice_number, day(inv.issue_date), day(inv.due_date),
        inv.payer_name ?? '', inv.payer_email ?? '', i + 1, l.d, '1', money(l.c),
        noVat ? money(l.c) : '', ...vatCells(l.c),
        money(total), payable !== null ? money(payable) : '', inv.currency ?? 'EUR',
        paid ? 'taip' : 'ne', paid ? day(inv.paid_at) : '', '',
      ]);
    });
  }

  for (const f of fees) {
    const c = Math.round(f.fee_eur * 100);
    rows.push([
      'Mokesčio dokumentas', f.number, f.date, '', f.buyer, f.buyer_email ?? '', 1, f.line, '1', money(c),
      money(c), '0', money(0), money(c), money(c), money(0), 'EUR', 'taip', f.date, f.invoice_number,
    ]);
  }
  return rows;
}
