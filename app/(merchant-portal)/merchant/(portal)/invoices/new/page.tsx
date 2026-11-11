'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLang, type Dict } from '../../../../i18n';
// ⚠️ The screen computes its running total with the SAME function the server
// uses. Its own copy read an empty quantity as a finite 0 and lit the issue
// button for an invoice the server then refused.
import { lineAmountCents } from '@/lib/invoice-manual';

type Msg = { ok: boolean; text: (t: Dict) => string };
type Line = { description: string; qty: string; unit: string; unitPrice: string; amount: string };
type Payer = {
  id: string; name: string; email: string | null; email_cc: string | null;
  phone: string | null; company_code: string | null; vat_code: string | null;
  address: string | null; ambiguous: boolean;
};

const emptyLine = (): Line => ({ description: '', qty: '', unit: '', unitPrice: '', amount: '' });
const today = () => new Date().toISOString().slice(0, 10);


/**
 * Issue ONE invoice, typed by hand.
 *
 * The batch screen is for a merchant with a month in a spreadsheet. This is
 * for the one billing per session - a lecturer, a therapist - who has no sheet
 * and no document, because the document is what they wanted us to make.
 *
 * ⚠️ **Nothing is sent from here.** Issuing puts the invoice in the ledger;
 * sending is the Invoices page and a second press.
 */
export default function NewInvoicePage() {
  const { t } = useLang();
  const router = useRouter();
  const [payers, setPayers] = useState<Payer[]>([]);
  const [payerName, setPayerName] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [vatCode, setVatCode] = useState('');
  const [address, setAddress] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [payerEmailCc, setPayerEmailCc] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  // `?edit=<id>`: correct an issued invoice in place, keeping its number.
  const editId = useSearchParams()?.get('edit') ?? '';
  const [editNumber, setEditNumber] = useState('');

  useEffect(() => {
    if (!editId) return;
    let live = true;
    fetch(`/api/merchant/invoices/${encodeURIComponent(editId)}/edit-data`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live || !d) return;
        if (!d.editable) { setMsg({ ok: false, text: (x) => x.newInvoice.errors[d.status === 'paid' ? 'paid' : 'not_issued'] ?? x.common.genericError }); return; }
        setEditNumber(d.invoice_number ?? '');
        setPayerName(d.payer_name ?? '');
        setCompanyCode(d.company_code ?? '');
        setVatCode(d.vat_code ?? '');
        setAddress(d.address ?? '');
        setPayerEmail(d.payer_email ?? '');
        setPayerEmailCc(d.payer_email_cc ?? '');
        setPayerPhone(d.payer_phone ?? '');
        if (d.issue_date) setIssueDate(d.issue_date);
        setDueDate(d.due_date ?? '');
        const ls: Line[] = (d.line_items ?? []).map((it: { description?: string; qty?: number | null; amount?: string | number }) => {
          const amount = it.amount == null ? '' : String(it.amount);
          const qty = it.qty ? String(it.qty) : '';
          // The ledger keeps the line total, not the rate; it is recovered only
          // when the division is exact, so no rate is ever invented.
          const cents = Math.round(Number(amount) * 100);
          const per = it.qty && Number.isFinite(cents) && cents % Number(it.qty) === 0 ? (cents / Number(it.qty) / 100).toFixed(2) : '';
          return { description: it.description ?? '', qty, unit: qty ? 'vnt.' : '', unitPrice: per, amount };
        });
        if (ls.length) setLines(ls);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [editId]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [usesPurpose, setUsesPurpose] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    // ⚠️ Whether the payment purpose is used at all for this merchant. It is
    // operator-set and off for all but one, so asking everyone else would
    // store a line no payer ever sees.
    fetch('/api/merchant/invoices/issue-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setUsesPurpose(Boolean(d?.uses_payment_purpose)); })
      .catch(() => { if (live) setUsesPurpose(false); });
    // The customers this merchant has invoiced before. An empty list is the
    // normal state on day one and must not look like a failure.
    fetch('/api/merchant/payers')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setPayers(d?.payers ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  /** Fill the whole customer block from one that is already known. */
  function pickPayer(id: string) {
    const p = payers.find(x => x.id === id);
    if (!p) return;
    setPayerName(p.name);
    setCompanyCode(p.company_code ?? '');
    setVatCode(p.vat_code ?? '');
    setAddress(p.address ?? '');
    setPayerEmail(p.email ?? '');
    setPayerEmailCc(p.email_cc ?? '');
    setPayerPhone(p.phone ?? '');
  }

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(ls => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  /**
   * What each line comes to, for the screen only.
   *
   * ⚠️ The typed amount wins and the multiplication only fills a blank - the
   * same rule the server applies, because this merchant's own data contains a
   * hand override where 21 x 4,80 was written as 54,60.
   */
  const lineTotal = (l: Line): number | null => {
    const cents = lineAmountCents(l);
    return cents === null ? null : cents / 100;
  };
  const total = lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0);

  const hasContact = payerEmail.trim() !== '' || payerPhone.trim() !== '';
  const canIssue =
    !busy && payerName.trim() !== '' && hasContact &&
    /^\d{4}-\d{2}-\d{2}$/.test(dueDate) &&
    lines.some(l => l.description.trim() !== '' && lineTotal(l) !== null);

  async function issue() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/merchant/invoices/issue-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerName, companyCode, vatCode, address,
          payerEmail, payerEmailCc, payerPhone, subjectName,
          issueDate, dueDate, lines, replaceId: editId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The status maps to a dictionary key; the backend's own English never
        // reaches a merchant, and a raw string here would crash the render.
        console.error('[invoice/new] issue failed', res.status, data);
        setMsg({ ok: false, text: (d) => d.newInvoice.errors[String(data.error)] ?? d.common.genericError });
        return;
      }
      // ⚠️ **Straight to the invoices list (2026-11-09).** Pressing issue and
      // staying on the form left the merchant unable to tell whether anything
      // had been created - the invoice is in the ledger, so that is where to
      // be. The number travels in the query so the list can say which one.
      router.push(`/merchant/invoices?issued=${encodeURIComponent(data.invoice_number)}`);
    } catch (err) {
      console.error('[invoice/new] issue error', err);
      setMsg({ ok: false, text: (d) => d.common.genericError });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="hb-page-head">
        <div>
          <Link href="/merchant/invoices" className="hb-backlink">{t.newInvoice.back}</Link>
          <h1 className="hb-h1">{editId ? t.newInvoice.editTitle(editNumber) : t.newInvoice.title}</h1>
          <p className="hb-sub">{t.newInvoice.sub}</p>
        </div>
      </div>

      {msg && <p className={msg.ok ? 'hb-note-ok' : 'hb-note-warn'}>{msg.text(t)}</p>}


      <div className="hb-card">
        <h2 className="hb-h2">{t.newInvoice.payerHeading}</h2>

        {/* ⚠️ The whole reason this section exists. A merchant invoicing the
            same company every month should not retype its name, code and
            address - the contact book has held them since the send was built
            and nothing ever offered them back. */}
        {payers.length > 0 && (
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.pickPayer}</label>
            <select className="hb-input" defaultValue=""
                    onChange={e => { pickPayer(e.target.value); e.target.value = ''; }}>
              <option value="">{t.newInvoice.pickPayerPlaceholder}</option>
              {payers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.company_code ? ` (${p.company_code})` : ''}
                  {p.email ? ` - ${p.email}` : p.phone ? ` - ${p.phone}` : ''}
                </option>
              ))}
            </select>
            <p className="hb-note">{t.newInvoice.pickPayerNote}</p>
          </div>
        )}

        <div className="hb-field">
          <label className="hb-label">{t.newInvoice.payerName}</label>
          <input className="hb-input" value={payerName} required
                 onChange={e => setPayerName(e.target.value)} />
        </div>

        <div className="hb-grid-2">
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.companyCode}</label>
            <input className="hb-input" value={companyCode}
                   onChange={e => setCompanyCode(e.target.value)} />
            {/* Required on an invoice to a company, absent on one to a person,
                so it is asked for and never demanded. */}
            <p className="hb-note">{t.newInvoice.companyCodeNote}</p>
          </div>
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.vatCode}</label>
            <input className="hb-input" value={vatCode}
                   onChange={e => setVatCode(e.target.value)} />
          </div>
        </div>

        <div className="hb-field">
          <label className="hb-label">{t.newInvoice.address}</label>
          <input className="hb-input" value={address}
                 onChange={e => setAddress(e.target.value)} />
        </div>

        <div className="hb-grid-2">
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.payerEmail}</label>
            <input className="hb-input" type="email" value={payerEmail}
                   onChange={e => setPayerEmail(e.target.value)} />
          </div>
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.payerPhone}</label>
            <input className="hb-input" value={payerPhone}
                   onChange={e => setPayerPhone(e.target.value)} />
          </div>
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.payerEmailCc}</label>
            <input className="hb-input" type="email" value={payerEmailCc}
                   onChange={e => setPayerEmailCc(e.target.value)} />
          </div>
        </div>

        {/* ⚠️ Either channel will do - the letter needs an address, the SMS a
            number - but one has to exist, or the invoice is created and then
            has nowhere to go. Said as a condition, not sprung as a refusal. */}
        {!hasContact && <p className="hb-note-warn">{t.newInvoice.contactRequired}</p>}

        {usesPurpose ? (
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.subjectName}</label>
            <input className="hb-input" value={subjectName}
                   onChange={e => setSubjectName(e.target.value)} />
            <p className="hb-note">{t.newInvoice.subjectNote}</p>
          </div>
        ) : null}
      </div>

      <div className="hb-card">
        <h2 className="hb-h2">{t.newInvoice.datesHeading}</h2>
        <div className="hb-grid-2">
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.issueDate}</label>
            <input className="hb-input" type="date" value={issueDate}
                   onChange={e => setIssueDate(e.target.value)} />
          </div>
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.dueDate}</label>
            <input className="hb-input" type="date" value={dueDate} required
                   onChange={e => setDueDate(e.target.value)} />
            <p className="hb-note-warn">{t.newInvoice.dueDateNote}</p>
          </div>
        </div>
      </div>

      <div className="hb-card">
        <h2 className="hb-h2">{t.newInvoice.linesHeading}</h2>
        {/* ⚠️ Quantity, unit, price, then the sum - the order every Lithuanian
            invoice prints and the order the law names them in. They were
            "Suma" and "Kaina" side by side, which said nothing about which
            was which. */}
        <div className="hb-table-wrap">
          <table className="hb-table">
            <thead>
              <tr>
                <th>{t.newInvoice.lineDescription}</th>
                <th>{t.newInvoice.lineQty}</th>
                <th>{t.newInvoice.lineUnit}</th>
                <th>{t.newInvoice.lineUnitPrice}</th>
                <th>{t.newInvoice.lineAmount}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <input className="hb-input" value={l.description}
                           onChange={e => setLine(i, { description: e.target.value })} />
                  </td>
                  <td style={{ width: 90 }}>
                    <input className="hb-input" inputMode="decimal" value={l.qty}
                           onChange={e => setLine(i, { qty: e.target.value })} />
                  </td>
                  <td style={{ width: 80 }}>
                    <input className="hb-input" value={l.unit} placeholder="vnt."
                           onChange={e => setLine(i, { unit: e.target.value })} />
                  </td>
                  <td style={{ width: 110 }}>
                    <input className="hb-input" inputMode="decimal" value={l.unitPrice}
                           onChange={e => setLine(i, { unitPrice: e.target.value })} />
                  </td>
                  <td style={{ width: 120 }}>
                    <input className="hb-input" inputMode="decimal" value={l.amount}
                           placeholder={(lineTotal(l) ?? 0).toFixed(2)}
                           onChange={e => setLine(i, { amount: e.target.value })} />
                  </td>
                  <td>
                    {(lines.length > 1 || editId) && (
                      <button type="button" className="hb-btn"
                              onClick={() => setLines(ls => ls.filter((_, n) => n !== i))}>
                        {t.newInvoice.removeLine}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hb-note">{t.newInvoice.lineAmountNote}</p>
        <button type="button" className="hb-btn"
                onClick={() => setLines(ls => [...ls, emptyLine()])}>
          {t.newInvoice.addLine}
        </button>
        <p className="hb-stat">
          <span className="hb-stat-label">{t.newInvoice.total}</span>{' '}
          <span className="hb-stat-value">{total.toFixed(2)} EUR</span>
        </p>
        <p className="hb-note">{t.newInvoice.totalNote}</p>
      </div>

      <div className="hb-actions">
        <button type="button" className="hb-btn primary" disabled={!canIssue} onClick={() => void issue()}>
          {busy ? t.newInvoice.issuing : editId ? t.newInvoice.saveEdited : t.newInvoice.issueButton}
        </button>
        <Link href="/merchant/invoices" className="hb-btn">{t.newInvoice.toInvoices}</Link>
      </div>
      <p className="hb-note">{t.newInvoice.nothingSent}</p>
    </div>
  );
}
