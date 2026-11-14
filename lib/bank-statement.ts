/**
 * Reading a bank statement the merchant downloaded themselves (ISO 20022
 * camt.053, and camt.054 which carries the same entries), and deciding which
 * open invoices it settles. Built 2026-11-12.
 *
 * ⚠️ **Why a file and not the bank's API.** Reading a merchant's account
 * through a bank API is an account information service under PSD2 and needs a
 * licence we do not hold. A statement the merchant downloads and hands to us is
 * their own document - nothing connects to the bank. When a licensed partner
 * (Yapily / Enable Banking) is in place, the same entries arrive over an API
 * and this matcher is reused as is.
 *
 * ⚠️ **Positive evidence only, the same rule as Centas and Rivilė.** An
 * invoice closes by itself only when the payment text names it (its number, or
 * the code its payment purpose starts with) AND the amount is exactly what it
 * asks for AND exactly one open invoice fits. A matching amount alone, a name
 * alone, a part payment - those are shown as suggestions for a person to
 * confirm. A wrongly closed invoice is never chased again and nobody notices.
 *
 * Pure functions, no I/O, so `npm run verify:bank-statement` can pin them.
 */

export type StatementEntry = {
  key: string;
  amountCents: number;
  currency: string;
  bookedOn: string | null;
  debtor: string | null;
  remittance: string;
};

export type ParsedStatement = { credits: StatementEntry[]; debitsSkipped: number };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTITIES[n]);
}

/** Every element `name` (any namespace prefix) inside `xml`, inner text. */
function all(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function first(xml: string, name: string): string | null {
  const v = all(xml, name)[0];
  return v === undefined ? null : decode(v.replace(/<[^>]+>/g, '').trim());
}
function amountOf(xml: string): { cents: number; ccy: string } | null {
  const m = /<(?:[\w.-]+:)?Amt\b([^>]*)>\s*([0-9]+(?:\.[0-9]{1,2})?)\s*</.exec(xml);
  if (!m) return null;
  const ccy = /Ccy="([A-Z]{3})"/.exec(m[1])?.[1] ?? 'EUR';
  const [w, f = ''] = m[2].split('.');
  return { cents: Number(w) * 100 + Number((f + '00').slice(0, 2)), ccy };
}

/** djb2 - only a fallback key for an entry the bank gave no reference to. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function parseStatement(xml: string): ParsedStatement {
  if (!/<(?:[\w.-]+:)?(BkToCstmrStmt|BkToCstmrDbtCdtNtfctn|BkToCstmrAcctRpt)\b/.test(xml)) {
    throw new Error('not_camt');
  }
  const credits: StatementEntry[] = [];
  let debitsSkipped = 0;
  for (const ntry of all(xml, 'Ntry')) {
    const ind = first(ntry, 'CdtDbtInd');
    if (ind !== 'CRDT') { debitsSkipped++; continue; }
    // ⚠️ RvslInd marks a reversal of an earlier entry, not money arriving.
    if (first(ntry, 'RvslInd') === 'true') { debitsSkipped++; continue; }
    const bookedOn = (first(all(ntry, 'BookgDt')[0] ?? '', 'Dt') ?? first(all(ntry, 'BookgDt')[0] ?? '', 'DtTm') ?? '').slice(0, 10) || null;
    const entryRef = first(ntry, 'AcctSvcrRef') ?? first(ntry, 'NtryRef');
    const txs = all(ntry, 'TxDtls');
    // A batch entry carries one TxDtls per payment, each with its own amount.
    const parts = txs.length > 1 ? txs : [txs[0] ?? ntry];
    parts.forEach((tx, i) => {
      const amt = (txs.length > 1 ? amountOf(tx) : null) ?? amountOf(ntry);
      if (!amt) return;
      const debtorBlock = all(tx, 'Dbtr')[0] ?? '';
      const debtor = first(debtorBlock, 'Nm');
      const texts = [...all(tx, 'Ustrd'), ...all(tx, 'Ref'), ...all(tx, 'AddtlRmtInf')]
        .map(t => decode(t.replace(/<[^>]+>/g, '').trim())).filter(Boolean);
      const remittance = Array.from(new Set(texts)).join(' ');
      const txRef = first(all(tx, 'Refs')[0] ?? '', 'AcctSvcrRef') ?? first(all(tx, 'Refs')[0] ?? '', 'EndToEndId');
      const base = txRef && txRef !== 'NOTPROVIDED' ? txRef : entryRef;
      const key = base
        ? (txs.length > 1 && !txRef ? `${base}#${i}` : base)
        : `h:${hash([bookedOn, amt.cents, debtor, remittance].join('|'))}`;
      credits.push({ key, amountCents: amt.cents, currency: amt.ccy, bookedOn, debtor, remittance });
    });
  }
  return { credits, debitsSkipped };
}

export type OpenInvoice = {
  id: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  payerName: string | null;
  paymentPurpose: string | null;
  status: string;
};

export type Outcome =
  | { kind: 'close'; invoiceId: string }
  | { kind: 'already'; invoiceId: string }
  | { kind: 'suggest'; invoiceIds: string[]; why: 'amount_differs' | 'amount_and_name' | 'several' }
  | { kind: 'none' };

/** Upper case, diacritics folded, only letters and digits - so "BL 2611-004" finds BL2611004. */
export function squash(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function words(s: string | null): string[] {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .split(/[^A-Z0-9]+/).filter(w => w.length >= 3);
}

/** The code a purpose like "1070 Jonas Darašas" starts with, if it is digits. */
function purposeCode(purpose: string | null): string | null {
  const m = /^\s*(?:Už\s+)?(\d{3,20})\b/i.exec(purpose ?? '');
  return m ? m[1] : null;
}

export function matchEntry(e: StatementEntry, invoices: OpenInvoice[]): Outcome {
  const text = squash(e.remittance);
  const textWords = new Set(words(e.remittance));
  const sameCcy = invoices.filter(i => i.currency.toUpperCase() === e.currency.toUpperCase());

  const named = sameCcy.filter(i => {
    const n = squash(i.invoiceNumber);
    if (n.length >= 4 && text.includes(n)) return true;
    const code = purposeCode(i.paymentPurpose);
    if (code && textWords.has(code)) return true;
    // ⚠️ Measured on Baltijos licėjus' real November statement (2026-11-14):
    // 33 of 46 credits quote the purpose printed on the invoice ("Už Rytį
    // Černiauską") and only 7 the invoice number. A purpose names a CHILD and
    // repeats across months and invoice types, so it never closes alone - the
    // exact amount and "exactly one open invoice" below still have to hold.
    const purpose = squash(i.paymentPurpose ?? '');
    return purpose.length >= 8 && text.includes(purpose);
  });

  const namedOpen = named.filter(i => i.status !== 'paid');
  const exact = namedOpen.filter(i => i.amountCents === e.amountCents);
  if (exact.length === 1) return { kind: 'close', invoiceId: exact[0].id };
  if (exact.length > 1) return { kind: 'suggest', invoiceIds: exact.map(i => i.id).slice(0, 3), why: 'several' };
  if (namedOpen.length > 0) return { kind: 'suggest', invoiceIds: namedOpen.map(i => i.id).slice(0, 3), why: 'amount_differs' };
  const namedPaid = named.filter(i => i.status === 'paid');
  if (namedPaid.length > 0) return { kind: 'already', invoiceId: namedPaid[0].id };

  // Nothing names an invoice: only an exact amount from someone whose name
  // matches the payer may be offered, and only offered.
  const debtorWords = new Set(words(e.debtor));
  if (debtorWords.size > 0) {
    const byName = sameCcy.filter(i => i.status !== 'paid' && i.amountCents === e.amountCents &&
      words(i.payerName).filter(w => debtorWords.has(w)).length >= 2);
    if (byName.length > 0) return { kind: 'suggest', invoiceIds: byName.map(i => i.id).slice(0, 3), why: 'amount_and_name' };
  }
  return { kind: 'none' };
}

/**
 * Match a whole statement. One entry closes at most one invoice and one invoice
 * is closed by at most one entry: a second entry naming an invoice already
 * claimed in this file becomes a suggestion, so two transfers for one invoice
 * are seen by a person instead of the second vanishing.
 */
export function matchStatement(entries: StatementEntry[], invoices: OpenInvoice[]) {
  const claimed = new Set<string>();
  return entries.map(e => {
    const pool = invoices.map(i => (claimed.has(i.id) ? { ...i, status: 'paid' } : i));
    let o = matchEntry(e, pool);
    if (o.kind === 'close') claimed.add(o.invoiceId);
    // A second transfer for an invoice this same file just closed is not "paid
    // earlier" - it is a possible double payment, and a person must see it.
    if (o.kind === 'already' && claimed.has(o.invoiceId)) {
      o = { kind: 'suggest', invoiceIds: [o.invoiceId], why: 'several' };
    }
    return { entry: e, outcome: o };
  });
}
