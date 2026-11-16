'use client';

import { useState } from 'react';
import { useLang, type Dict } from '../../../i18n';

/**
 * What the "documents (ZIP)" button opens (2026-11-16): which period, and
 * which documents - the invoices HexaBee issued, the 0,49 EUR fee documents
 * (`<invoice>-M`) the bookkeeper books as income, or both. Asked for so the
 * bookkeeper takes them herself whenever she closes a month.
 *
 * Fetched rather than a plain link, so an empty period is said on this card
 * instead of the browser opening a page of JSON.
 */
function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The last 18 months, newest first. A select rather than <input type="month">,
// whose picker always speaks the BROWSER's language - an English calendar on a
// Lithuanian screen (2026-11-16).
function recentMonths(): string[] {
  const d = new Date();
  d.setDate(1);
  return Array.from({ length: 18 }, () => {
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    d.setMonth(d.getMonth() - 1);
    return v;
  });
}

export default function ExportDocuments({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const [month, setMonth] = useState(lastMonth());
  const [all, setAll] = useState(false);
  const [invoices, setInvoices] = useState(true);
  const [fees, setFees] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: (t: Dict) => string } | null>(null);

  async function download() {
    if (!invoices && !fees) return;
    setBusy(true);
    setMsg(null);
    try {
      const qs = new URLSearchParams({ invoices: invoices ? '1' : '0', fees: fees ? '1' : '0' });
      if (!all && month) qs.set('month', month);
      const res = await fetch(`/api/merchant/invoices/export-pdfs?${qs}`);
      if (!res.ok) {
        setMsg({ ok: false, text: res.status === 404 ? (t) => t.exportDocs.empty : (t) => t.exportDocs.failed });
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const name = /filename="([^"]+)"/.exec(cd)?.[1] || 'dokumentai.zip';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      const inv = Number(res.headers.get('X-Invoice-Included') || 0);
      const missing = Number(res.headers.get('X-Invoice-Missing') || 0);
      const fee = Number(res.headers.get('X-Fee-Included') || 0);
      const skipped = Number(res.headers.get('X-Fee-Skipped') || 0);
      setMsg({ ok: true, text: (t) => t.exportDocs.done(invoices ? inv : null, invoices ? missing : 0, fees ? fee : null, fees ? skipped : 0) });
    } catch {
      setMsg({ ok: false, text: (t) => t.exportDocs.failed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hb-card">
      <h2 className="hb-card-title">{t.exportDocs.title}</h2>
      <p className="hb-card-sub">{t.exportDocs.sub}</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', margin: '12px 0' }}>
        <label className="hb-note" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
          {t.exportDocs.month}
          <select className="hb-input" value={month} disabled={all} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
            {recentMonths().map((m) => (
              <option key={m} value={m}>
                {new Intl.DateTimeFormat(t.locale, { year: 'numeric', month: 'long' }).format(new Date(`${m}-01T12:00:00`))}
              </option>
            ))}
          </select>
        </label>
        <label className="hb-note" style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t.exportDocs.all}
        </label>
      </div>

      <div style={{ display: 'grid', gap: 6, margin: '0 0 12px' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={invoices} onChange={(e) => setInvoices(e.target.checked)} />
          <span><b>{t.exportDocs.invoices}</b><br /><span className="hb-note" style={{ margin: 0 }}>{t.exportDocs.invoicesHint}</span></span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={fees} onChange={(e) => setFees(e.target.checked)} />
          <span><b>{t.exportDocs.fees}</b><br /><span className="hb-note" style={{ margin: 0 }}>{t.exportDocs.feesHint}</span></span>
        </label>
      </div>

      <div className="hb-actions">
        <button type="button" className="hb-btn primary" disabled={busy || (!invoices && !fees)} onClick={download}>
          {busy ? t.exportDocs.preparing : t.exportDocs.download}
        </button>
        <button type="button" className="hb-btn" onClick={onClose}>{t.exportDocs.close}</button>
      </div>
      {msg && <p className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text(t)}</p>}
    </div>
  );
}
