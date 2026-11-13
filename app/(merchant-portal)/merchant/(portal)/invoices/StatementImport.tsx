'use client';

import { useRef, useState } from 'react';
import { useLang, type Dict } from '../../../i18n';

type Inv = { id: string; invoiceNumber: string; amount: string; currency: string; payerName: string | null };
type Line = { amount: string; currency: string; bookedOn: string | null; debtor: string | null; text: string };
type Result = {
  credits: number; debitsSkipped: number; seenBefore: number;
  closed: { line: Line; invoice: Inv }[];
  suggested: { line: Line; why: 'amount_differs' | 'amount_and_name' | 'several'; invoices: Inv[] }[];
  already: { line: Line; invoice: Inv }[];
  unmatched: { line: Line }[];
};

/**
 * Bank statement upload on the Invoices page (2026-11-12). The merchant's own
 * XML statement closes the invoices it proves paid; what it cannot prove is
 * listed for a person to confirm with the ordinary "mark paid" route.
 */
export default function StatementImport({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { t } = useLang();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<((d: Dict) => string) | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  async function upload(file: File) {
    setBusy(true); setErr(null); setRes(null); setConfirmed(new Set());
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await fetch('/api/merchant/invoices/statement', { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('[statement] upload failed', r.status, data);
        const code = String(data?.error ?? '');
        setErr(() => (d: Dict) => code === 'not_camt' ? d.statement.errNotCamt
          : code === 'too_large' ? d.statement.errTooLarge
          : code === 'not_ready' ? d.statement.errNotReady : d.statement.errGeneric);
        return;
      }
      setRes(data as Result);
      onDone();
    } catch {
      setErr(() => (d: Dict) => d.statement.errGeneric);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function markPaid(id: string) {
    const r = await fetch(`/api/merchant/invoices/${id}/paid`, { method: 'POST' });
    if (r.ok || r.status === 409) { setConfirmed(s => new Set(s).add(id)); onDone(); }
  }

  const lineText = (l: Line) =>
    `${l.bookedOn ?? ''} · ${l.amount} ${l.currency}${l.debtor ? ` · ${l.debtor}` : ''}${l.text ? ` · ${l.text}` : ''}`;
  const invText = (i: Inv) => `${i.invoiceNumber} · ${i.amount} ${i.currency}${i.payerName ? ` · ${i.payerName}` : ''}`;
  const why = (w: Result['suggested'][number]['why']) =>
    w === 'amount_differs' ? t.statement.whyAmount : w === 'amount_and_name' ? t.statement.whyName : t.statement.whySeveral;

  return (
    <div className="hb-card">
      <h2 className="hb-card-title">{t.statement.title}</h2>
      <p className="hb-card-sub">{t.statement.sub}</p>
      <p className="hb-note">{t.statement.how}</p>
      <input ref={fileRef} type="file" accept=".xml,application/xml,text/xml" style={{ display: 'none' }}
             onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <div className="hb-actions">
        <button type="button" className="hb-btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? t.statement.reading : t.statement.pick}
        </button>
        <button type="button" className="hb-btn" onClick={onClose}>{t.statement.close}</button>
      </div>
      {err && <p className="hb-msg err">{err(t)}</p>}

      {res && (
        <div style={{ marginTop: 12 }}>
          <p className="hb-msg ok">{t.statement.summary(res.closed.length, res.suggested.length, res.unmatched.length)}</p>
          {res.seenBefore > 0 && <p className="hb-note">{t.statement.seenBefore(res.seenBefore)}</p>}

          {res.suggested.length > 0 && (
            <div className="hb-subsection">
              <p className="hb-subsection-label">{t.statement.suggestTitle}</p>
              {res.suggested.map((s, k) => (
                <div key={k} style={{ margin: '8px 0' }}>
                  <p className="hb-note" style={{ margin: 0 }}>{lineText(s.line)}</p>
                  <p className="hb-note" style={{ margin: '0 0 4px', color: '#b45309' }}>{why(s.why)}</p>
                  {s.invoices.map(i => (
                    <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="hb-note" style={{ margin: 0 }}>{invText(i)}</span>
                      {confirmed.has(i.id)
                        ? <span className="hb-note" style={{ margin: 0 }}>✓ {t.statement.confirmed}</span>
                        : <button type="button" className="hb-btn sm" onClick={() => void markPaid(i.id)}>{t.statement.confirm}</button>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {res.closed.length > 0 && (
            <div className="hb-subsection">
              <p className="hb-subsection-label">{t.statement.closedTitle}</p>
              {res.closed.map((c, k) => <p key={k} className="hb-note" style={{ margin: '2px 0' }}>✓ {invText(c.invoice)}</p>)}
            </div>
          )}

          {res.already.length > 0 && (
            <div className="hb-subsection">
              <p className="hb-subsection-label">{t.statement.alreadyTitle}</p>
              {res.already.map((c, k) => <p key={k} className="hb-note" style={{ margin: '2px 0' }}>{invText(c.invoice)}</p>)}
            </div>
          )}

          {res.unmatched.length > 0 && (
            <details className="hb-subsection">
              <summary className="hb-subsection-label" style={{ cursor: 'pointer' }}>{t.statement.unmatchedTitle} ({res.unmatched.length})</summary>
              {res.unmatched.map((u, k) => <p key={k} className="hb-note" style={{ margin: '2px 0' }}>{lineText(u.line)}</p>)}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
