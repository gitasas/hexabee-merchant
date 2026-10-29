'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLang, type Dict } from '../../../../i18n';

/**
 * Issue a month of invoices from the merchant's own spreadsheet.
 *
 * **The point of this screen is the failure list, not the drop zone.** A row
 * HexaBee cannot be sure of is shown to the merchant, who is standing right
 * here, instead of becoming an invoice nobody can explain. So the refusals are
 * rendered above the ready rows, with the reason and the cell, and the issue
 * button says exactly how many will go.
 *
 * ⚠️ **Nothing here sends anything.** Issuing creates ledger rows; sending is
 * the separate step on the Invoices page, with its own preview. Half a parent
 * list receiving an invoice while the school believes everyone did is the worst
 * failure this product has had, and owning the document does not relax it.
 *
 * ⚠️ **Every message state holds `(t: Dict) => string`, never a string.** A
 * stored sentence keeps the language it was born in, so the portal's language
 * toggle has nothing left to translate - and putting a plain string into one of
 * these states throws `text is not a function` and replaces the whole page with
 * a blank error, which is how seven of these were live at once on 2026-10-19.
 */

type Msg = { ok: boolean; text: (t: Dict) => string };

type ColumnRole =
  | 'ignore' | 'payer_name' | 'payer_email' | 'payer_phone' | 'subject_name'
  | 'line_amount' | 'line_discount' | 'total_check' | 'due_date' | 'reference';

type ColumnMapping = {
  role: ColumnRole;
  description?: string;
  descriptionFrom?: string;
  qtyFrom?: string;
  unit?: string;
  unitPrice?: number;
};

type Mapping = {
  mode: 'row_per_invoice' | 'row_per_line';
  sheet?: string | number;
  headerRow: number;
  firstDataRow: number;
  columns: Record<string, ColumnMapping>;
  /**
   * One invoice per payer rather than per row. Ten of Baltijos licėjus' 46
   * payers have two children and pay for both together - see `mergeByPayer`
   * in lib/invoice-import.ts for why this reversed the original design.
   */
  mergeByPayer?: boolean;
};

type Row = {
  sheetRow: number;
  payerName: string;
  payerEmail: string | null;
  subjectName: string | null;
  payable: number;
  balanceKnown: boolean;
  issueKey: string;
  alreadyIssued: { invoice_number: string; sent: boolean } | null;
};

type Preview = {
  needsMapping: boolean;
  batch?: string;
  sheetNames: string[];
  mapping: Mapping | null;
  headers: { col: string; label: string }[];
  /** A draft read off the headings and the figures - see the Suggest button. */
  suggested?: Record<string, ColumnMapping>;
  rows?: Row[];
  toIssue?: number;
  alreadyIssued?: number;
  batchTotal?: number;
  refused: { sheetRow: number; label: string; reason: string; detail: string }[];
  ignored: { sheetRow: number; detail: string }[];
  skipped: number;
  unreadable: string[];
  blockers: string[];
  currency?: string;
};

const ROLES: ColumnRole[] = [
  'ignore', 'payer_name', 'payer_email', 'payer_phone', 'subject_name',
  'line_amount', 'line_discount', 'total_check', 'due_date', 'reference',
];

/** A line role carries a description and may carry a quantity and a rate. */
const isLineRole = (r: ColumnRole) => r === 'line_amount' || r === 'line_discount';

const money = (cents: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

/**
 * ⚠️ The backend's own error codes are used as dictionary KEYS, never as text.
 * Displaying `data.error` would answer a Lithuanian merchant in English, which
 * is what login did from the day it was written.
 */
const errMsg = (code: unknown): Msg => ({
  ok: false,
  text: (t: Dict) => t.issue.errors[String(code)] ?? t.common.genericError,
});

export default function IssueInvoicesPage() {
  const { t, lang } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draft, setDraft] = useState<Mapping | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState('');

  const currency = preview?.currency ?? 'EUR';

  async function runPreview(f: File, mapping: Mapping | null) {
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('file', f);
      if (mapping) form.append('mapping', JSON.stringify(mapping));
      const res = await fetch('/api/merchant/invoices/import/preview', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[issue] preview failed', res.status, data);
        setMsg(errMsg(data.error));
        // A missing sheet still tells us which sheets exist, which is exactly
        // what the merchant needs in order to fix it.
        if (data.sheetNames) {
          setPreview(prev => ({
            ...(prev ?? {
              needsMapping: true, headers: [], refused: [], ignored: [], skipped: 0,
              unreadable: [], blockers: [], mapping: null,
            }),
            sheetNames: data.sheetNames,
            needsMapping: true,
          }));
          setMappingOpen(true);
        }
        return;
      }
      setPreview(data as Preview);
      const next: Mapping | null =
        (data.mapping as Mapping | null) ??
        (data.sheetNames?.length
          ? { mode: 'row_per_invoice', sheet: data.sheetNames[0], headerRow: 1, firstDataRow: 2, columns: {} }
          : null);
      setDraft(next);
      if (data.needsMapping) setMappingOpen(true);
    } catch (err) {
      console.error('[issue] preview threw', String(err));
      setMsg({ ok: false, text: (tt: Dict) => tt.common.networkError });
    } finally {
      setBusy(false);
    }
  }

  async function saveMapping() {
    if (!draft || !file) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/merchant/invoices/issue-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_import_mapping: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[issue] mapping save failed', res.status, data);
        setMsg(errMsg(data.error));
        return;
      }
      setMsg({ ok: true, text: (tt: Dict) => tt.issue.mappingSaved });
      setMappingOpen(false);
      await runPreview(file, draft);
    } catch (err) {
      console.error('[issue] mapping save threw', String(err));
      setMsg({ ok: false, text: (tt: Dict) => tt.common.networkError });
    } finally {
      setBusy(false);
    }
  }

  /**
   * The chunked loop, the same shape as the invoice send.
   *
   * ⚠️ It stops when a pass issues nothing, NOT when `remaining` reaches zero.
   * A row that keeps failing would make the second condition loop for ever.
   */
  async function issueAll() {
    if (!file || !draft || !preview?.toIssue) return;
    setBusy(true);
    setMsg(null);
    const total = preview.toIssue;
    setProgress({ done: 0, total });
    let done = 0;
    let failed = 0;
    try {
      for (;;) {
        const form = new FormData();
        form.append('file', file);
        form.append('mapping', JSON.stringify(draft));
        form.append('issueDate', issueDate);
        if (dueDate) form.append('dueDate', dueDate);
        const res = await fetch('/api/merchant/invoices/import/issue', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error('[issue] issue failed', res.status, data);
          setMsg(errMsg(data.error));
          break;
        }
        done += data.issued ?? 0;
        failed += data.failed ?? 0;
        setProgress({ done, total });
        if (!data.issued) break;
        if (data.remaining <= 0) break;
      }
      const issuedCount = done;
      const failedCount = failed;
      setMsg({
        ok: failedCount === 0,
        text: (tt: Dict) =>
          failedCount === 0
            ? tt.issue.issuedAll(issuedCount)
            : `${tt.issue.issuedAll(issuedCount)}. ${tt.issue.issueFailed(failedCount)}`,
      });
      await runPreview(file, draft);
    } catch (err) {
      console.error('[issue] issue threw', String(err));
      setMsg({ ok: false, text: (tt: Dict) => tt.common.networkError });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  function setCol(col: string, patch: Partial<ColumnMapping>) {
    setDraft(d => {
      if (!d) return d;
      const current = d.columns[col] ?? { role: 'ignore' as ColumnRole };
      return { ...d, columns: { ...d.columns, [col]: { ...current, ...patch } } };
    });
  }

  const blockers = preview?.blockers ?? [];

  return (
    <div>
      <div className="hb-page-head">
        <div>
          <Link href="/merchant/invoices" className="hb-backlink">{t.issue.back}</Link>
          <h1 className="hb-title">{t.issue.title}</h1>
          <p className="hb-sub">{t.issue.sub}</p>
        </div>
      </div>

      {msg && <p className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text(t)}</p>}

      {/* Answers that go on every invoice, so they are never guessed. */}
      {blockers.length > 0 && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.issue.blockersTitle}</h2>
          <p className="hb-card-sub">{t.issue.blockersSub}</p>
          <ul>
            {blockers.map(b => (
              <li key={b}>{t.issue.blockerNames[b] ?? b}</li>
            ))}
          </ul>
          <p className="hb-note">{t.issue.blockersOwner}</p>
          <div className="hb-actions">
            <Link href="/merchant/settings/business" className="hb-btn">{t.issue.toSettings}</Link>
          </div>
        </div>
      )}

      <div className="hb-card">
        <h2 className="hb-card-title">{file ? file.name : t.issue.pick}</h2>
        <input
          className="hb-input"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          onChange={e => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setPreview(null);
            setProgress(null);
            if (f) void runPreview(f, null);
          }}
        />
        {busy && !progress && <p className="hb-skeleton">{t.issue.reading}</p>}
      </div>

      {/* The column mapping: set once, then it maps itself. */}
      {preview && draft && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.issue.mappingTitle}</h2>
          <p className="hb-card-sub">{t.issue.mappingSub}</p>
          {!mappingOpen ? (
            <div className="hb-actions">
              <button type="button" className="hb-btn" onClick={() => setMappingOpen(true)}>
                {t.issue.mappingShow}
              </button>
            </div>
          ) : (
            <>
              <div className="hb-grid-2">
                <div className="hb-field">
                  <label className="hb-label">{t.issue.sheetLabel}</label>
                  <select
                    className="hb-input"
                    value={String(draft.sheet ?? '')}
                    onChange={e => setDraft(d => (d ? { ...d, sheet: e.target.value } : d))}
                  >
                    {preview.sheetNames.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="hb-field">
                  <label className="hb-label">{t.issue.headerRow}</label>
                  <input
                    className="hb-input"
                    type="number"
                    min={1}
                    value={draft.headerRow}
                    onChange={e => setDraft(d => (d ? { ...d, headerRow: Number(e.target.value) || 1 } : d))}
                  />
                </div>
                <div className="hb-field">
                  <label className="hb-label">{t.issue.firstDataRow}</label>
                  <input
                    className="hb-input"
                    type="number"
                    min={1}
                    value={draft.firstDataRow}
                    onChange={e => setDraft(d => (d ? { ...d, firstDataRow: Number(e.target.value) || 1 } : d))}
                  />
                </div>
              </div>
              <p className="hb-note">{t.issue.rowHint}</p>
              <div className="hb-actions">
                <button
                  type="button"
                  className="hb-btn"
                  disabled={busy || !file}
                  onClick={() => file && void runPreview(file, draft)}
                >
                  {t.issue.previewTitle}
                </button>
                {/* ⚠️ A draft, applied only by this press. What makes guessing
                    acceptable here is that nothing is stored until the merchant
                    saves, the preview shows every figure first, and the totals
                    check refuses any row the guess got wrong. */}
                {preview.suggested && (
                  <button
                    type="button"
                    className="hb-btn"
                    disabled={busy}
                    onClick={() => setDraft(d => (d && preview.suggested ? { ...d, columns: preview.suggested } : d))}
                  >
                    {t.issue.suggest}
                  </button>
                )}
              </div>
              {preview.suggested && <p className="hb-note">{t.issue.suggestNote}</p>}

              <label className="hb-check">
                <input
                  type="checkbox"
                  checked={draft.mergeByPayer ?? false}
                  onChange={e => setDraft(d => (d ? { ...d, mergeByPayer: e.target.checked } : d))}
                />
                {t.issue.mergeByPayer}
              </label>
              <p className="hb-note">{t.issue.mergeByPayerNote}</p>

              {preview.headers.length > 0 && (
                <div className="hb-table-wrap">
                  <table className="hb-table">
                    <thead>
                      <tr>
                        <th>{t.issue.colHeading}</th>
                        <th>{t.issue.colMeans}</th>
                        <th>{t.issue.colDetail}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.headers.map(h => {
                        const m = draft.columns[h.col] ?? { role: 'ignore' as ColumnRole };
                        return (
                          <tr key={h.col}>
                            <td>
                              <span className="hb-mono">{h.col}</span> {h.label}
                            </td>
                            <td>
                              <select
                                className="hb-input"
                                value={m.role}
                                onChange={e => setCol(h.col, { role: e.target.value as ColumnRole })}
                              >
                                {ROLES.map(r => (
                                  <option key={r} value={r}>{t.issue.roles[r]}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              {isLineRole(m.role) && (
                                <>
                                  <input
                                    className="hb-input"
                                    placeholder={t.issue.descriptionPlaceholder}
                                    value={m.description ?? ''}
                                    onChange={e => setCol(h.col, { description: e.target.value })}
                                  />
                                  {/* The description may come from another
                                      column instead - a comments column is how
                                      this merchant labels their "other" line. */}
                                  <select
                                    className="hb-input"
                                    value={m.descriptionFrom ?? ''}
                                    onChange={e => setCol(h.col, { descriptionFrom: e.target.value || undefined })}
                                  >
                                    <option value="">{t.issue.colDescFrom}: {t.issue.noneOption}</option>
                                    {preview.headers.map(o => (
                                      <option key={o.col} value={o.col}>
                                        {t.issue.colDescFrom}: {o.col} {o.label}
                                      </option>
                                    ))}
                                  </select>
                                  {/* ⚠️ Quantity and unit price are printed, never
                                      used in arithmetic - the amount column is the
                                      authority, and a rate that does not multiply
                                      out to it is left off the document entirely. */}
                                  <select
                                    className="hb-input"
                                    value={m.qtyFrom ?? ''}
                                    onChange={e => setCol(h.col, { qtyFrom: e.target.value || undefined })}
                                  >
                                    <option value="">{t.issue.colQty}: {t.issue.noneOption}</option>
                                    {preview.headers.map(o => (
                                      <option key={o.col} value={o.col}>
                                        {t.issue.colQty}: {o.col} {o.label}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    className="hb-input"
                                    placeholder={t.issue.colUnit}
                                    value={m.unit ?? ''}
                                    onChange={e => setCol(h.col, { unit: e.target.value || undefined })}
                                  />
                                  <input
                                    className="hb-input"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    placeholder={t.issue.colUnitPrice}
                                    value={m.unitPrice === undefined ? '' : (m.unitPrice / 100).toFixed(2)}
                                    onChange={e => setCol(h.col, {
                                      unitPrice: e.target.value === ''
                                        ? undefined
                                        : Math.round(Number(e.target.value) * 100),
                                    })}
                                  />
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="hb-actions">
                <button type="button" className="hb-btn primary" disabled={busy} onClick={() => void saveMapping()}>
                  {t.issue.mappingSave}
                </button>
                <button type="button" className="hb-btn" onClick={() => setMappingOpen(false)}>
                  {t.issue.mappingHide}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ⚠️ The failure list comes FIRST. It is what the screen is for. */}
      {preview && !preview.needsMapping && (
        <>
          {preview.unreadable.length > 0 && (
            <div className="hb-card">
              <h2 className="hb-card-title">{t.issue.unreadableTitle(preview.unreadable.length)}</h2>
              <p className="hb-note-warn">{t.issue.unreadableSub}</p>
              <p className="hb-mono">{preview.unreadable.join(', ')}</p>
            </div>
          )}

          {preview.refused.length > 0 && (
            <div className="hb-card">
              <h2 className="hb-card-title">{t.issue.refusedTitle(preview.refused.length)}</h2>
              <p className="hb-card-sub">{t.issue.refusedSub}</p>
              <div className="hb-table-wrap">
                <table className="hb-table">
                  <tbody>
                    {preview.refused.map(r => (
                      <tr key={r.sheetRow}>
                        <td className="hb-num">{r.sheetRow}</td>
                        <td>{r.label}</td>
                        <td>{t.issue.reasons[r.reason] ?? r.reason}</td>
                        <td className="hb-mono">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.ignored.length > 0 && (
            <div className="hb-card">
              <h2 className="hb-card-title">{t.issue.ignoredTitle(preview.ignored.length)}</h2>
              <p className="hb-card-sub">{t.issue.ignoredSub}</p>
              <div className="hb-table-wrap">
                <table className="hb-table">
                  <tbody>
                    {preview.ignored.map(r => (
                      <tr key={r.sheetRow}>
                        <td className="hb-num">{r.sheetRow}</td>
                        <td className="hb-mono">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="hb-card">
            <h2 className="hb-card-title">{t.issue.readyTitle(preview.toIssue ?? 0)}</h2>
            {(preview.alreadyIssued ?? 0) > 0 && (
              <p className="hb-card-sub">{t.issue.alreadyIssuedNote(preview.alreadyIssued ?? 0)}</p>
            )}
            {/* ⚠️ Said out loud, because the document cannot say it: these
                invoices carry this period only. The carried-over balance lives
                in the merchant's accounting, not in the spreadsheet. */}
            <p className="hb-note-warn">{t.issue.balanceNote}</p>

            <div className="hb-grid-2">
              <div className="hb-field">
                <label className="hb-label">{t.issue.issueDateLabel}</label>
                <input className="hb-input" type="date" value={issueDate}
                       onChange={e => setIssueDate(e.target.value)} />
              </div>
              <div className="hb-field">
                <label className="hb-label">{t.issue.dueDateLabel}</label>
                <input className="hb-input" type="date" value={dueDate}
                       onChange={e => setDueDate(e.target.value)} />
              </div>
            </div>

            {(preview.rows?.length ?? 0) > 0 && (
              <div className="hb-table-wrap">
                <table className="hb-table">
                  <thead>
                    <tr>
                      <th>{t.issue.thRow}</th>
                      <th>{t.issue.thFor}</th>
                      <th>{t.issue.thPayer}</th>
                      <th>{t.issue.thAmount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows?.map(r => (
                      <tr key={r.sheetRow} style={r.alreadyIssued ? { opacity: 0.55 } : undefined}>
                        <td className="hb-num">{r.sheetRow}</td>
                        <td>{r.subjectName ?? '-'}</td>
                        <td>
                          {r.payerName}
                          {r.payerEmail ? <span className="hb-row-sub"> {r.payerEmail}</span> : null}
                        </td>
                        <td className="hb-num">
                          {money(r.payable, currency, t.locale)}
                          {r.alreadyIssued && (
                            <span className="hb-badge"> {t.issue.issuedAlready} {r.alreadyIssued.invoice_number}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="hb-stat">
              <span className="hb-stat-label">{t.issue.batchTotal}</span>{' '}
              <span className="hb-stat-value">{money(preview.batchTotal ?? 0, currency, t.locale)}</span>
            </p>

            <div className="hb-actions">
              <button
                type="button"
                className="hb-btn primary"
                disabled={busy || blockers.length > 0 || !(preview.toIssue ?? 0)}
                onClick={() => void issueAll()}
              >
                {progress
                  ? t.issue.issuing(progress.done, progress.total)
                  : t.issue.issueButton(preview.toIssue ?? 0)}
              </button>
              <Link href="/merchant/invoices" className="hb-btn">{t.issue.toInvoices}</Link>
            </div>
            {!(preview.toIssue ?? 0) && <p className="hb-note">{t.issue.nothingToIssue}</p>}
            {/* Nothing has gone out: say so, every time. */}
            <p className="hb-note">{t.issue.nextStep}</p>
          </div>
        </>
      )}

      {/* `lang` is read so switching language re-renders every resolved message. */}
      <span hidden>{lang}</span>
    </div>
  );
}
