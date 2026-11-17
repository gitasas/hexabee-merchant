'use client';

import { useEffect, useState } from 'react';
import { useLang, type Dict } from '../../../i18n';

/**
 * "Sinchronizuoti su apskaita" (2026-11-17).
 *
 * Shown only when the merchant has an accounting key we can use (Rivilė or
 * Centas) - which the backend answers from the keys stored, not from the
 * program chosen in Settings. A merchant on a program without an API keeps the
 * file export and never sees a button that could do nothing.
 *
 * The case it exists for: the bookkeeper sends the month from Rivilė, payers
 * start paying within minutes, and the daily import has not run yet - so a
 * payer opening the pay link finds nothing. Pressing this right after sending
 * brings the invoices in now.
 *
 * Every message is resolved at render (`(t) => string`), never stored as a
 * translated sentence, and the backend's own error text is never shown.
 */
type Msg = { ok: boolean; text: (t: Dict) => string };

export default function AccountingSync({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const [available, setAvailable] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    fetch('/api/merchant/accounting-sync')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setAvailable(Array.isArray(d.systems) && d.systems.length > 0);
        setLast(d.last_manual_sync_at ?? null);
      })
      .catch(() => { /* no button rather than a broken one */ });
  }, []);

  if (!available) return null;

  async function run() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/merchant/accounting-sync', { method: 'POST' });
      const d = await res.json().catch(() => null);
      if (res.status === 429) {
        const min = Math.max(1, Math.ceil(Number(d?.wait_seconds ?? 60) / 60));
        setMsg({ ok: false, text: (tt) => tt.accSync.tooSoon(min) });
        return;
      }
      if (!res.ok || !d) {
        console.error('[invoices/accounting-sync] failed', res.status, d?.error);
        setMsg({ ok: false, text: (tt) => tt.accSync.failed });
        return;
      }
      setLast(new Date().toISOString());
      const { imported = 0, written = 0, closed = 0, readFailed = false, writeFailed = false } = d;
      // What was done is always said first; a failure is added to it, never
      // put in its place - the rows that did arrive are real.
      setMsg({
        ok: !readFailed && !writeFailed,
        text: (tt) => [
          imported + written + closed === 0 ? tt.accSync.nothing : tt.accSync.done(imported, written, closed),
          readFailed ? tt.accSync.readFailed : '',
          writeFailed ? tt.accSync.writeFailed : '',
        ].filter(Boolean).join(' '),
      });
      onDone();
    } catch (err) {
      console.error('[invoices/accounting-sync] unreachable', String(err));
      setMsg({ ok: false, text: (tt) => tt.accSync.failed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="hb-btn" onClick={run} disabled={busy}>
        {busy ? t.accSync.busy : t.accSync.button}
      </button>
      {(msg || last) && (
        <p className={`hb-msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`} style={{ flexBasis: '100%', margin: '4px 0 0' }}>
          {msg ? msg.text(t) : t.accSync.last(new Date(last as string).toLocaleString(t.locale))}
        </p>
      )}
    </>
  );
}
