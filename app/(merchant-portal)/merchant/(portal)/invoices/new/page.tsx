'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLang, type Dict } from '../../../../i18n';

type Msg = { ok: boolean; text: (t: Dict) => string };
type Line = { description: string; amount: string; qty: string; unit: string; unitPrice: string };

const emptyLine = (): Line => ({ description: '', amount: '', qty: '', unit: '', unitPrice: '' });
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Issue ONE invoice, typed by hand.
 *
 * The batch screen exists for a merchant with a month in a spreadsheet. This
 * is for the one invoicing a few people - a lecturer, a therapist, anyone
 * billing per session - who has no sheet to import and no document to upload,
 * because the document is the thing they wanted us to make.
 *
 * ⚠️ **Nothing is sent from here.** Issuing puts the invoice in the ledger;
 * sending is the Invoices page and a second press. Two decisions, two presses
 * - the same rule the batch follows, and the reason it exists is that a
 * document reaching a customer is not something to do by accident.
 */
export default function NewInvoicePage() {
  const { t } = useLang();
  const [payerName, setPayerName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [payerEmailCc, setPayerEmailCc] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [issued, setIssued] = useState<{ number: string; amount: number } | null>(null);
  // ⚠️ **Whether the payment purpose is used at all, for this merchant.** It
  // is an operator-set flag and off for all but one merchant, so asking
  // everybody else for a purpose would store a line nobody ever sees - a
  // question with no consequence, which is one more thing to answer wrongly.
  // Null while unknown, so the field appears once rather than flickering.
  const [usesPurpose, setUsesPurpose] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/merchant/invoices/issue-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setUsesPurpose(Boolean(d?.uses_payment_purpose)); })
      .catch(() => { if (live) setUsesPurpose(false); });
    return () => { live = false; };
  }, []);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(ls => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  // ⚠️ Shown as the merchant types, and deliberately a DISPLAY only. The
  // figure that lands on the ledger is the one the document prints, computed
  // server-side by `computePayable` - two sums would be two chances to differ,
  // and this one cannot see the VAT settings at all.
  const total = lines.reduce((sum, l) => {
    const n = Number(String(l.amount).replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  const canIssue =
    !busy && payerName.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) &&
    lines.some(l => l.description.trim() !== '' && l.amount.trim() !== '');

  async function issue() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/merchant/invoices/issue-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerName, payerEmail, payerEmailCc, payerPhone, subjectName,
          issueDate, dueDate, lines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // ⚠️ The status maps to a dictionary key; the backend's own English
        // never reaches a merchant. See the portal rule in CLAUDE.md - a
        // string put into this state would also crash the page on render.
        console.error('[invoice/new] issue failed', res.status, data);
        setMsg({ ok: false, text: (d) => d.newInvoice.errors[String(data.error)] ?? d.common.genericError });
        return;
      }
      setIssued({ number: data.invoice_number, amount: (data.amount_cents ?? 0) / 100 });
      setMsg({ ok: true, text: (d) => d.newInvoice.issuedOk(data.invoice_number) });
      setPayerName(''); setPayerEmail(''); setPayerEmailCc(''); setPayerPhone('');
      setSubjectName(''); setDueDate(''); setLines([emptyLine()]);
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
          <h1 className="hb-h1">{t.newInvoice.title}</h1>
          <p className="hb-sub">{t.newInvoice.sub}</p>
        </div>
      </div>

      {msg && (
        <p className={msg.ok ? 'hb-note-ok' : 'hb-note-warn'}>{msg.text(t)}</p>
      )}

      {issued && (
        <div className="hb-card">
          <p>
            <strong>{issued.number}</strong> - {issued.amount.toFixed(2)} EUR.{' '}
            {t.newInvoice.notSentYet}
          </p>
          <Link href="/merchant/invoices" className="hb-btn primary">{t.newInvoice.toInvoices}</Link>
        </div>
      )}

      <div className="hb-card">
        <h2 className="hb-h2">{t.newInvoice.payerHeading}</h2>
        <div className="hb-grid-2">
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.payerName}</label>
            <input className="hb-input" value={payerName} required
                   onChange={e => setPayerName(e.target.value)} />
          </div>
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.payerEmail}</label>
            <input className="hb-input" type="email" value={payerEmail}
                   onChange={e => setPayerEmail(e.target.value)} />
            <p className="hb-note">{t.newInvoice.payerEmailNote}</p>
          </div>
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.payerEmailCc}</label>
            <input className="hb-input" type="email" value={payerEmailCc}
                   onChange={e => setPayerEmailCc(e.target.value)} />
          </div>
          <div className="hb-field">
            <label className="hb-label">{t.newInvoice.payerPhone}</label>
            <input className="hb-input" value={payerPhone}
                   onChange={e => setPayerPhone(e.target.value)} />
          </div>
        </div>
        {/* ⚠️ **Not another word for the line description.** This is the
            person the payment is ABOUT when that is not the person paying -
            a parent pays, a child attends - and it ends up on the payer's
            BANK STATEMENT, not on the invoice line. It is shown only to a
            merchant whose payments actually carry it; for everyone else it
            would be a field that changes nothing. */}
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
            {/* ⚠️ Required, as in the batch: it is the date reminders count
                from, and the merchant's accounting refuses a document without
                one. Said here so it is learned from the field, not a refusal. */}
            <p className="hb-note-warn">{t.newInvoice.dueDateNote}</p>
          </div>
        </div>
      </div>

      <div className="hb-card">
        <h2 className="hb-h2">{t.newInvoice.linesHeading}</h2>
        {lines.map((l, i) => (
          <div key={i} className="hb-grid-2" style={{ marginBottom: 8 }}>
            <div className="hb-field">
              <label className="hb-label">{t.newInvoice.lineDescription}</label>
              <input className="hb-input" value={l.description}
                     onChange={e => setLine(i, { description: e.target.value })} />
            </div>
            <div className="hb-field">
              <label className="hb-label">{t.newInvoice.lineAmount}</label>
              <input className="hb-input" inputMode="decimal" value={l.amount}
                     onChange={e => setLine(i, { amount: e.target.value })} />
            </div>
            <div className="hb-field">
              <label className="hb-label">{t.newInvoice.lineQty}</label>
              <input className="hb-input" inputMode="decimal" value={l.qty}
                     onChange={e => setLine(i, { qty: e.target.value })} />
            </div>
            <div className="hb-field">
              <label className="hb-label">{t.newInvoice.lineUnitPrice}</label>
              <input className="hb-input" inputMode="decimal" value={l.unitPrice}
                     onChange={e => setLine(i, { unitPrice: e.target.value })} />
              {/* The document prints the rate only when it multiplies out to
                  the amount - see `unitPricePrintable`. Said plainly so an
                  absent rate is not read as a fault. */}
              <p className="hb-note">{t.newInvoice.lineRateNote}</p>
            </div>
            {lines.length > 1 && (
              <button type="button" className="hb-btn"
                      onClick={() => setLines(ls => ls.filter((_, n) => n !== i))}>
                {t.newInvoice.removeLine}
              </button>
            )}
          </div>
        ))}
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
          {busy ? t.newInvoice.issuing : t.newInvoice.issueButton}
        </button>
        <Link href="/merchant/invoices" className="hb-btn">{t.newInvoice.toInvoices}</Link>
      </div>
      <p className="hb-note">{t.newInvoice.nothingSent}</p>
    </div>
  );
}
