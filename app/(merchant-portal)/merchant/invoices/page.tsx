'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '../../i18n';

type Invoice = {
  id: string;
  payer_email: string | null;
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  email_subject: string | null;
  pdf_filename: string | null;
  paid_at: string | null;
  created_at: string;
  reminders_sent: number | null;
  last_reminder_at: string | null;
};

type Outstanding = { currency: string; total: number };

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
  const [outstanding, setOutstanding] = useState<Outstanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

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
        if (!data.stripe_account_id || !data.business_country) {
          router.push('/merchant/onboarding');
          return;
        }
        loadInvoices();
      });
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadInvoices() {
    setLoading(true);
    fetch('/api/merchant/invoices')
      .then(r => r.ok ? r.json() : { invoices: [], outstanding: [] })
      .then(data => {
        setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
        setOutstanding(Array.isArray(data.outstanding) ? data.outstanding : []);
      })
      .catch(() => { setInvoices([]); setOutstanding([]); })
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

  if (loading) return <p className="hb-skeleton">{t.common.loading}</p>;

  // A row without a number, amount or payer could not be read from the emailed
  // PDF: it can never be matched to a payment or reminded, so it is surfaced as
  // "needs a look" rather than counted as money owed.
  const isActionable = (inv: Invoice) =>
    !!inv.invoice_number && inv.amount !== null && !!inv.payer_email;

  const unpaidCount = invoices.filter(inv => inv.status === 'issued' && isActionable(inv)).length;
  const unreadableCount = invoices.filter(inv => inv.status === 'issued' && !isActionable(inv)).length;

  const statusBadge = (status: string) =>
    status === 'paid'
      ? { cls: 'is-paid', label: t.invoices.statusPaid }
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
                  <th>{t.invoices.thAmount}</th>
                  <th>{t.invoices.thStatus}</th>
                  <th>{t.invoices.thReminder}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const badge = statusBadge(inv.status);
                  const msg = remindMsg[inv.id];
                  return (
                    <tr key={inv.id}>
                      <td data-label={t.invoices.thDate}>{formatDate(inv.created_at)}</td>
                      <td data-label={t.invoices.thPayer}>{inv.payer_email || '—'}</td>
                      <td data-label={t.invoices.thInvoiceNo} className="hb-mono">{inv.invoice_number || '—'}</td>
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
                        </div>
                      </td>
                      <td data-label={t.invoices.thReminder}>
                        {inv.status === 'issued' ? (
                          <div>
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleSendReminder(inv.id)}
                              disabled={remindingId !== null || !isActionable(inv)}
                              title={isActionable(inv) ? undefined : t.invoices.missingDetails}
                            >
                              {remindingId === inv.id ? t.invoices.sending : t.invoices.sendReminder}
                            </button>
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
