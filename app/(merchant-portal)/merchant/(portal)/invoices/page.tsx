'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';
import { isSettledToNothing } from '@/lib/invoice-amount';

type Invoice = {
  id: string;
  payer_email: string | null;
  // Who the invoice is addressed to, as printed on it. Read at upload and
  // matched against the remembered list, so an address is asked for once per
  // person rather than once per invoice.
  payer_name: string | null;
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  due_date: string | null;
  status: string;
  email_subject: string | null;
  pdf_filename: string | null;
  paid_at: string | null;
  // 'hexabee' (a Stripe/Montonio webhook), 'manual' (ticked off by the merchant),
  // or null for rows paid before the column existed.
  paid_source: string | null;
  // The payer told us, from a reminder email, that they had already paid. It
  // stops the automatic reminders without asserting the invoice is settled.
  payer_claimed_at: string | null;
  created_at: string;
  reminders_sent: number | null;
  last_reminder_at: string | null;
};

type Outstanding = { currency: string; total: number };

// Whole days past the deadline, or null while it has not passed. Compared date
// to date in local time: an invoice due today is not late, whatever the hour.
function daysOverdue(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((midnight.getTime() - due.getTime()) / 86_400_000);
  return diff > 0 ? diff : null;
}

function formatAmount(amount: string | null, currency: string | null): string {
  if (amount === null || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency ?? 'EUR' }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

export default function MerchantInvoicesPage() {
  const router = useRouter();
  const { t } = useLang();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignEmail, setAssignEmail] = useState<Record<string, string>>({});
  const [assignMsg, setAssignMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [resumingId, setResumingId] = useState<string | null>(null);
  // Batch upload. One file per request, so a slow or unreadable PDF costs that
  // row and not the whole batch - and the merchant watches it happen instead of
  // waiting on a spinner that says nothing.
  const [uploadBusy, setUploadBusy] = useState<{ done: number; total: number } | null>(null);
  const [uploadFailed, setUploadFailed] = useState<{ filename: string; reason: string }[]>([]);
  const [uploadStored, setUploadStored] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [settleMsg, setSettleMsg] = useState<Record<string, string>>({});

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(t.locale, { day: '2-digit', month: 'short', year: 'numeric' });

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (!isOnboardingComplete(data)) {
          router.push('/merchant/onboarding');
          return;
        }
        loadInvoices();
      });
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadInvoices() {
    setLoading(true);
    fetch('/api/merchant/invoices')
      .then(r => r.ok ? r.json() : { invoices: [] })
      .then(data => {
        // The route also returns `outstanding`, but this page derives it from
        // the rows instead (see below), so that total never disagrees with the
        // table the merchant is looking at.
        setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
      })
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }

  async function handleSendReminder(id: string) {
    if (remindingId) return;
    setRemindingId(id);
    setRemindMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/remind`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const sent = typeof data.reminders_sent === 'number' ? data.reminders_sent : null;
        setInvoices(list => list.map(inv => inv.id === id
          ? { ...inv, reminders_sent: sent ?? (inv.reminders_sent ?? 0) + 1, last_reminder_at: new Date().toISOString() }
          : inv
        ));
        setRemindMsg(m => ({ ...m, [id]: { ok: true, text: t.invoices.sent } }));
        setTimeout(() => setRemindMsg(m => { const next = { ...m }; delete next[id]; return next; }), 3000);
      } else {
        const text = data.detail ?? data.error ?? t.invoices.sendFailed;
        setRemindMsg(m => ({ ...m, [id]: { ok: false, text: String(text) } }));
      }
    } catch {
      setRemindMsg(m => ({ ...m, [id]: { ok: false, text: t.invoices.sendFailed } }));
    } finally {
      setRemindingId(null);
    }
  }

  // Close an invoice that was settled outside HexaBee, or reopen one closed by
  // mistake. Nothing here creates a payment row: this is money we never handled,
  // and it must never reach the dashboard's takings or our monthly invoice.
  // Assign a recipient, and let the backend remember the name. The reply says
  // how many other invoices it filled in: that number is the whole point of the
  // feature, so it is shown rather than swallowed.
  async function handleAssignPayer(id: string) {
    const email = (assignEmail[id] ?? '').trim();
    if (!email || assigningId) return;
    setAssigningId(id);
    setAssignMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/payer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const name = data.payer_name as string | null;
        const key = (s: string | null) => (s ?? '').trim().toLowerCase();
        setInvoices(list => list.map(inv => {
          if (inv.id === id) return { ...inv, payer_email: email };
          // Mirror the backend's backfill locally so the table agrees with what
          // just happened, instead of waiting for a reload to tell the truth.
          if (!inv.payer_email && name && key(inv.payer_name) === key(name)) {
            return { ...inv, payer_email: email };
          }
          return inv;
        }));
        setAssignEmail(m => { const next = { ...m }; delete next[id]; return next; });
        if (data.ambiguous) {
          setAssignMsg(m => ({ ...m, [id]: { ok: false, text: t.invoices.payerAmbiguous } }));
        } else if (data.backfilled > 0) {
          setAssignMsg(m => ({ ...m, [id]: { ok: true, text: t.invoices.payerAlsoFilled(data.backfilled) } }));
        }
      } else {
        setAssignMsg(m => ({
          ...m,
          [id]: { ok: false, text: data.error === 'invalid_email' ? t.invoices.payerInvalidEmail : t.invoices.payerFailed },
        }));
      }
    } catch {
      setAssignMsg(m => ({ ...m, [id]: { ok: false, text: t.invoices.payerFailed } }));
    } finally {
      setAssigningId(null);
    }
  }

  async function handleSettle(id: string, paid: boolean) {
    if (settlingId) return;
    setSettlingId(id);
    setSettleMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/paid`, { method: paid ? 'POST' : 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInvoices(list => list.map(inv => inv.id === id
          ? paid
            ? { ...inv, status: 'paid', paid_at: data.paid_at ?? new Date().toISOString(), paid_source: 'manual' }
            : { ...inv, status: 'issued', paid_at: null, paid_source: null }
          : inv
        ));
      } else {
        setSettleMsg(m => ({ ...m, [id]: String(data.error ?? t.invoices.markFailed) }));
      }
    } catch {
      setSettleMsg(m => ({ ...m, [id]: t.invoices.markFailed }));
    } finally {
      setSettlingId(null);
    }
  }

  // The payer said they had paid and the merchant found no money. Without this
  // one false click would silence an unpaid invoice for good, and a customer who
  // wanted to stall would only have to press a button.
  async function handleResumeReminders(id: string) {
    if (resumingId) return;
    setResumingId(id);
    setSettleMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/resume-reminders`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInvoices(list => list.map(inv => inv.id === id
          ? { ...inv, payer_claimed_at: null, reminders_sent: 0 }
          : inv
        ));
      } else {
        setSettleMsg(m => ({ ...m, [id]: String(data.error ?? t.invoices.resumeFailed) }));
      }
    } catch {
      setSettleMsg(m => ({ ...m, [id]: t.invoices.resumeFailed }));
    } finally {
      setResumingId(null);
    }
  }

  async function handleUpload(files: FileList | File[] | null) {
    if (!files || uploadBusy) return;
    // A folder drag, or a stray screenshot alongside the invoices, should not
    // become a row of failures the merchant has to read past.
    const list = Array.from(files).filter(
      f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (list.length === 0) return;
    setUploadFailed([]);
    setUploadStored(null);
    setUploadBusy({ done: 0, total: list.length });

    const failed: { filename: string; reason: string }[] = [];
    let stored = 0;

    // Sequential on purpose. Sixty PDFs in parallel would hit the scanner and
    // the model all at once, and the first thing to break would be the ones at
    // the end - silently, which is the failure this screen exists to end.
    for (let i = 0; i < list.length; i++) {
      const fd = new FormData();
      fd.append('file', list[i]);
      try {
        const res = await fetch('/api/merchant/invoices/upload', { method: 'POST', body: fd });
        const data = await res.json().catch(() => null);
        if (data?.ok) stored++;
        else failed.push({ filename: list[i].name, reason: String(data?.reason ?? 'error') });
      } catch {
        failed.push({ filename: list[i].name, reason: 'error' });
      }
      setUploadBusy({ done: i + 1, total: list.length });
    }

    setUploadBusy(null);
    setUploadFailed(failed);
    setUploadStored(stored);
    loadInvoices();
  }

  function uploadReason(reason: string): string {
    if (reason === 'unreadable') return t.invoices.uploadReasonUnreadable;
    if (reason === 'not_a_pdf') return t.invoices.uploadReasonNotPdf;
    if (reason === 'too_large') return t.invoices.uploadReasonTooLarge;
    return t.invoices.uploadReasonError;
  }

  if (loading) return <p className="hb-skeleton">{t.common.loading}</p>;

  // A row without a number, amount or payer could not be read from the emailed
  // PDF: it can never be matched to a payment or reminded, so it is surfaced as
  // "needs a look" rather than counted as money owed.
  const isActionable = (inv: Invoice) => missingFields(inv).length === 0;

  // Which fields are missing, by name. A button that is simply dead, with a
  // tooltip saying "some details could not be read", leaves the merchant with
  // nowhere to go - and tooltips on a disabled button do not open at all on a
  // touch screen, so the reason is also rendered as text under it.
  function missingFields(inv: Invoice): string[] {
    const missing: string[] = [];
    if (!inv.invoice_number) missing.push(t.invoices.missingInvoiceNo);
    if (inv.amount === null) missing.push(t.invoices.missingAmount);
    if (!inv.payer_email) missing.push(t.invoices.missingPayer);
    return missing;
  }

  // Read fine, owes nothing. The merchant's own invoice settles it: a school
  // that applies a parent's prepayment prints "Mokėti: 0,00" under a total of
  // 1043,40, or a negative when the parent overpaid. Such a row is not unpaid,
  // not unreadable and not waiting for a recipient - it is simply finished, and
  // every count below has to agree with that or the merchant is chasing a
  // number this page invented (2026-10-02).
  const nothingToPay = (inv: Invoice) => isSettledToNothing(inv.amount);

  const unpaidCount = invoices.filter(
    inv => inv.status === 'issued' && isActionable(inv) && !nothingToPay(inv)
  ).length;
  // "Could not be read" means we failed to extract something from the invoice:
  // its number or its amount. A missing payer is a different thing entirely -
  // every uploaded invoice has none until recipients are matched, and calling
  // that a reading failure told the merchant their own upload had gone wrong.
  // The reminder button still needs a payer; that is what missingFields says.
  const unreadableCount = invoices.filter(
    inv => inv.status === 'issued' && (!inv.invoice_number || inv.amount === null)
  ).length;
  const awaitingPayerCount = invoices.filter(
    inv => inv.status === 'issued' && !!inv.invoice_number && inv.amount !== null
      && !inv.payer_email && !nothingToPay(inv)
  ).length;
  // Still counted as unpaid: a claim is the payer's word, not a settled invoice.
  // It is surfaced because it is the one row on this page that needs the
  // merchant to go and look at their bank.
  const claimedCount = invoices.filter(inv => inv.status === 'issued' && !!inv.payer_claimed_at).length;

  // Derived from the rows on screen, not from the server's copy. Marking an
  // invoice paid updates `invoices` in place, and the total used to be state
  // loaded once — so the yellow box kept showing the amount of an invoice the
  // merchant had just settled, and called it unpaid.
  const outstanding: Outstanding[] = (() => {
    const totals = new Map<string, number>();
    for (const inv of invoices) {
      if (inv.status !== 'issued') continue;
      const amount = Number(inv.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const cur = (inv.currency ?? 'EUR').toUpperCase();
      totals.set(cur, (totals.get(cur) ?? 0) + amount);
    }
    // Settling the last unpaid invoice would otherwise make the whole box
    // vanish at the moment the merchant most wants to see it worked. Show a
    // zero in the newest invoice's currency instead (rows are newest first).
    if (totals.size === 0 && invoices.length > 0) {
      totals.set((invoices[0].currency ?? 'EUR').toUpperCase(), 0);
    }
    return Array.from(totals.entries()).map(([currency, total]) => ({
      currency,
      total: Math.round(total * 100) / 100,
    }));
  })();

  // "Unpaid" is wrong for an invoice that asks for nothing: the merchant reads
  // the column, not the note under the button, and a row saying "Neapmokėta"
  // beside a zero reads as a problem to chase. It is also not "paid" - nobody
  // paid anything - so it gets its own badge (2026-10-02).
  const statusBadge = (inv: Invoice) =>
    inv.status === 'paid'
      ? { cls: 'is-paid', label: t.invoices.statusPaid }
      : nothingToPay(inv)
        ? { cls: 'is-neutral', label: t.invoices.statusNothingToPay }
        : { cls: 'is-pending', label: t.invoices.statusUnpaid };

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.invoices.title}</h1>
          <p className="hb-sub">{t.invoices.sub}</p>
        </div>
        <div className="hb-actions">
          <a className="hb-btn" href="/api/merchant/export?type=invoices">{t.invoices.exportCsv}</a>
          <a className="hb-btn" href="/merchant/settings">{t.invoices.inboxAddress}</a>
        </div>
      </div>

      {/* What is still owed, per currency — the reason to open this page */}
      {outstanding.length > 0 && (
        <div className={outstanding.length <= 2 ? 'hb-hero' : 'hb-stats'}>
          {outstanding.map((o, i) => (
            <div key={o.currency} className={`hb-stat${i === 0 ? ' accent' : ''}`}>
              <p className="hb-stat-label">{t.invoices.outstanding(o.currency)}</p>
              <p className="hb-stat-value">{formatAmount(String(o.total), o.currency)}</p>
              {i === 0 && (
                <p className="hb-stat-note">
                  {unpaidCount > 0 ? t.invoices.unpaidNote(unpaidCount) : t.invoices.nothingUnpaid}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* The upload box sits above the ledger because it is what fills it. The
          point of this screen is not the drop zone but the list of files that
          could not be read: on the BCC path that same failure is silent, and a
          lost invoice is a receivable nobody ever chases. */}
      <div className="hb-card" style={{ marginBottom: 16 }}>
        <p className="hb-subsection-label">{t.invoices.uploadTitle}</p>
        <p className="hb-card-sub">{t.invoices.uploadSub}</p>
        {/* Both ways in. The copy promises dragging, so dragging has to work -
            and a picker still matters, because a file manager is where some
            people live and a drop target is invisible to a keyboard. */}
        <div
          onDragOver={e => { e.preventDefault(); if (!uploadBusy) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            if (!uploadBusy) handleUpload(e.dataTransfer.files);
          }}
          style={{
            marginTop: 10,
            padding: '18px 16px',
            borderRadius: 12,
            border: `2px dashed ${dragOver ? 'var(--brand)' : 'var(--border)'}`,
            background: dragOver ? 'rgba(244,180,0,0.06)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap',
            transition: 'border-color .12s, background .12s',
          }}
        >
          <span className="hb-note" style={{ margin: 0 }}>{t.invoices.uploadDropHere}</span>
          <label className="hb-btn primary" style={{ cursor: uploadBusy ? 'default' : 'pointer', opacity: uploadBusy ? 0.6 : 1 }}>
            {t.invoices.uploadPick}
            <input
              type="file"
              accept="application/pdf"
              multiple
              disabled={!!uploadBusy}
              style={{ display: 'none' }}
              onChange={e => { handleUpload(e.target.files); e.target.value = ''; }}
            />
          </label>
          {uploadBusy && (
            <span className="hb-note" style={{ margin: 0 }}>{t.invoices.uploadBusy(uploadBusy.done, uploadBusy.total)}</span>
          )}
        </div>

        {uploadStored !== null && !uploadBusy && (
          <p className="hb-msg ok" style={{ marginTop: 10 }}>{t.invoices.uploadDoneAll(uploadStored)}</p>
        )}

        {uploadFailed.length > 0 && !uploadBusy && (
          <div style={{ marginTop: 10 }}>
            <p className="hb-msg err">{t.invoices.uploadFailedSome(uploadFailed.length)}</p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {uploadFailed.map(f => (
                <li key={f.filename} className="hb-note" style={{ listStyle: 'disc' }}>
                  {f.filename} - {uploadReason(f.reason)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {claimedCount > 0 && (
        <div className="hb-alert">
          <div>
            <p className="hb-alert-text">{t.invoices.claimedAlert(claimedCount)}</p>
            <p className="hb-alert-sub">{t.invoices.claimedAlertSub}</p>
          </div>
        </div>
      )}

      {awaitingPayerCount > 0 && (
        <div className="hb-alert">
          <div>
            <p className="hb-alert-text">{t.invoices.awaitingPayer(awaitingPayerCount)}</p>
            <p className="hb-alert-sub">{t.invoices.awaitingPayerSub}</p>
          </div>
        </div>
      )}

      {unreadableCount > 0 && (
        <div className="hb-alert">
          <div>
            <p className="hb-alert-text">{t.invoices.unreadable(unreadableCount)}</p>
            <p className="hb-alert-sub">{t.invoices.unreadableSub}</p>
          </div>
        </div>
      )}

      <div className="hb-card">
        {invoices.length === 0 ? (
          <div className="hb-empty">
            <p className="hb-empty-title">{t.invoices.emptyTitle}</p>
            <p>{t.invoices.emptySub}</p>
            <a className="hb-btn primary" href="/merchant/settings">{t.invoices.getBcc}</a>
          </div>
        ) : (
          <div className="hb-table-wrap">
            <table className="hb-table">
              <thead>
                <tr>
                  <th>{t.invoices.thDate}</th>
                  <th>{t.invoices.thPayer}</th>
                  <th>{t.invoices.thInvoiceNo}</th>
                  <th title={t.invoices.dueExplainer}>{t.invoices.thDue}</th>
                  <th>{t.invoices.thAmount}</th>
                  <th>{t.invoices.thStatus}</th>
                  <th>{t.invoices.thReminder}</th>
                  <th title={t.invoices.markPaidHint}>{t.invoices.thAction}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const badge = statusBadge(inv);
                  const msg = remindMsg[inv.id];
                  const overdue = daysOverdue(inv.due_date);
                  return (
                    <tr key={inv.id}>
                      <td data-label={t.invoices.thDate}>{formatDate(inv.created_at)}</td>
                      <td data-label={t.invoices.thPayer}>
                        {inv.payer_email ? (
                          inv.payer_email
                        ) : inv.payer_name ? (
                          // Known who, not known where. Asking here - beside the
                          // name the invoice itself prints - is the only moment
                          // the merchant has the answer in front of them.
                          <div>
                            <span>{inv.payer_name}</span>
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              <input
                                type="email"
                                className="hb-input sm"
                                placeholder={t.invoices.payerEmailPlaceholder}
                                value={assignEmail[inv.id] ?? ''}
                                onChange={e => setAssignEmail(m => ({ ...m, [inv.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') handleAssignPayer(inv.id); }}
                                style={{ minWidth: 0, flex: 1 }}
                              />
                              <button
                                type="button"
                                className="hb-btn sm"
                                onClick={() => handleAssignPayer(inv.id)}
                                disabled={assigningId !== null || !(assignEmail[inv.id] ?? '').trim()}
                              >
                                {assigningId === inv.id ? t.invoices.payerSaving : t.invoices.payerSave}
                              </button>
                            </div>
                            {/* The explanation lives in the banner above the
                                table, not here: with sixty invoices this line
                                would repeat sixty times and stop being read. */}
                            {assignMsg[inv.id] && (
                              <p className="hb-note" style={{ color: assignMsg[inv.id].ok ? '#15803d' : '#b45309' }}>
                                {assignMsg[inv.id].text}
                              </p>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td data-label={t.invoices.thInvoiceNo} className="hb-mono">{inv.invoice_number || '—'}</td>
                      <td data-label={t.invoices.thDue}>
                        {inv.due_date ? (
                          <div>
                            {formatDate(inv.due_date)}
                            {inv.status !== 'paid' && overdue !== null && (
                              <p className="hb-note" style={{ color: '#b45309' }}>
                                {t.invoices.overdueBy(overdue)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="hb-note">{t.invoices.noDueDate}</span>
                        )}
                      </td>
                      <td data-label={t.invoices.thAmount} className="hb-num">{formatAmount(inv.amount, inv.currency)}</td>
                      <td data-label={t.invoices.thStatus}>
                        <div>
                          <span
                            className={`hb-badge ${badge.cls}`}
                            title={inv.status === 'paid' && inv.paid_at ? t.invoices.paidOn(formatDate(inv.paid_at)) : undefined}
                          >
                            {badge.label}
                          </span>
                          {inv.status === 'paid' && inv.paid_at && (
                            <p className="hb-note">{formatDate(inv.paid_at)}</p>
                          )}
                          {/* Where the money came from matters to the merchant's
                              books: a manual tick has no HexaBee payment behind
                              it, so there is nothing to reconcile it against. */}
                          {inv.status === 'paid' && (
                            <p className="hb-note">
                              {inv.paid_source === 'manual' ? t.invoices.paidManually : t.invoices.paidViaHexabee}
                            </p>
                          )}
                          {inv.status === 'issued' && inv.payer_claimed_at && (
                            <p className="hb-note" style={{ color: '#b45309' }}
                               title={t.invoices.claimedOn(formatDate(inv.payer_claimed_at))}>
                              {t.invoices.claimedBadge}
                            </p>
                          )}
                        </div>
                      </td>
                      <td data-label={t.invoices.thReminder}>
                        {inv.status === 'issued' ? (
                          <div>
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleSendReminder(inv.id)}
                              disabled={remindingId !== null || !isActionable(inv) || nothingToPay(inv)}
                              title={
                                nothingToPay(inv)
                                  ? t.invoices.nothingToPayNote
                                  : isActionable(inv) ? undefined : t.invoices.missingDetails(missingFields(inv).join(', '))
                              }
                            >
                              {remindingId === inv.id ? t.invoices.sending : t.invoices.sendReminder}
                            </button>
                            {/* The backend refuses a reminder for an invoice
                                that owes nothing, so this says why rather than
                                leaving a dead button. Checked before
                                missingFields: such a row usually has no payer
                                either, and "missing: payer" would send the
                                merchant hunting for an address that would
                                change nothing. */}
                            {nothingToPay(inv) ? (
                              <p className="hb-note">{t.invoices.nothingToPayNote}</p>
                            ) : !isActionable(inv) && (
                              <p className="hb-note">{t.invoices.missingShort(missingFields(inv).join(', '))}</p>
                            )}
                            {/* The payer stopped the automatic loop by claiming
                                they had paid. If no money arrived, the merchant
                                has to be able to start it again. */}
                            {inv.payer_claimed_at && (
                              <button
                                type="button"
                                className="hb-btn sm"
                                onClick={() => handleResumeReminders(inv.id)}
                                disabled={resumingId !== null}
                                title={t.invoices.resumeHint}
                              >
                                {resumingId === inv.id ? t.invoices.resuming : t.invoices.resumeReminders}
                              </button>
                            )}
                            {msg && (
                              <p className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>
                            )}
                            {(inv.reminders_sent ?? 0) > 0 && (
                              <p className="hb-note">
                                {t.invoices.sentTimes(inv.reminders_sent ?? 0, inv.last_reminder_at ? formatDate(inv.last_reminder_at) : null)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="hb-note">—</span>
                        )}
                      </td>
                      <td data-label={t.invoices.thAction}>
                        <div>
                          {/* Nothing to settle against the bank when nothing was
                              owed. Marking such a row paid would assert a
                              payment that never happened and cannot have. */}
                          {inv.status === 'issued' && !nothingToPay(inv) ? (
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleSettle(inv.id, true)}
                              disabled={settlingId !== null}
                              title={t.invoices.markPaidHint}
                            >
                              {settlingId === inv.id ? t.invoices.marking : t.invoices.markPaid}
                            </button>
                          ) : inv.status === 'issued' ? (
                            <span className="hb-note">—</span>
                          ) : inv.paid_source === 'manual' ? (
                            // Only a manual tick can be undone. A webhook-settled
                            // row records money that really arrived.
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleSettle(inv.id, false)}
                              disabled={settlingId !== null}
                            >
                              {settlingId === inv.id ? t.invoices.marking : t.invoices.undo}
                            </button>
                          ) : (
                            <span className="hb-note">—</span>
                          )}
                          {settleMsg[inv.id] && <p className="hb-msg err">{settleMsg[inv.id]}</p>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
