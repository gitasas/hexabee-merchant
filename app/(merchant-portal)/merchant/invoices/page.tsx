'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  issued: { cls: 'is-pending', label: 'Unpaid' },
  paid: { cls: 'is-paid', label: 'Paid' },
};

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function MerchantInvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [outstanding, setOutstanding] = useState<Outstanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

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
        setRemindMsg(m => ({ ...m, [id]: { ok: true, text: 'Sent ✓' } }));
        setTimeout(() => setRemindMsg(m => { const next = { ...m }; delete next[id]; return next; }), 3000);
      } else {
        const text = data.detail ?? data.error ?? 'Failed to send';
        setRemindMsg(m => ({ ...m, [id]: { ok: false, text: String(text) } }));
      }
    } catch {
      setRemindMsg(m => ({ ...m, [id]: { ok: false, text: 'Failed to send' } }));
    } finally {
      setRemindingId(null);
    }
  }

  if (loading) return <p className="hb-skeleton">Loading…</p>;

  const unpaidCount = invoices.filter(inv => inv.status === 'issued').length;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">Invoices</h1>
          <p className="hb-sub">
            Invoices appear here automatically when you BCC them to your invoice inbox address
            (shown on Settings). Payments are matched by invoice number.
          </p>
        </div>
        <div className="hb-actions">
          <a className="hb-btn" href="/merchant/settings">⚙️ Invoice inbox address</a>
        </div>
      </div>

      {/* What is still owed, per currency — the reason to open this page */}
      {outstanding.length > 0 && (
        <div className={outstanding.length <= 2 ? 'hb-hero' : 'hb-stats'}>
          {outstanding.map((o, i) => (
            <div key={o.currency} className={`hb-stat${i === 0 ? ' accent' : ''}`}>
              <p className="hb-stat-label">Outstanding ({o.currency})</p>
              <p className="hb-stat-value">{formatAmount(String(o.total), o.currency)}</p>
              {i === 0 && (
                <p className="hb-stat-note">
                  {unpaidCount > 0
                    ? `${unpaidCount} unpaid invoice${unpaidCount === 1 ? '' : 's'}`
                    : 'Nothing unpaid'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="hb-card">
        {invoices.length === 0 ? (
          <div className="hb-empty">
            <p className="hb-empty-title">No invoices yet</p>
            <p>Add your BCC address to your accounting software and invoices will land here on their own.</p>
            <a className="hb-btn primary" href="/merchant/settings">Get my BCC address</a>
          </div>
        ) : (
          <div className="hb-table-wrap">
            <table className="hb-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payer</th>
                  <th>Invoice #</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reminder</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.issued;
                  const msg = remindMsg[inv.id];
                  return (
                    <tr key={inv.id}>
                      <td data-label="Date">{formatDate(inv.created_at)}</td>
                      <td data-label="Payer">{inv.payer_email || '—'}</td>
                      <td data-label="Invoice #" className="hb-mono">{inv.invoice_number || '—'}</td>
                      <td data-label="Amount" className="hb-num">{formatAmount(inv.amount, inv.currency)}</td>
                      <td data-label="Status">
                        <div>
                          <span
                            className={`hb-badge ${badge.cls}`}
                            title={inv.status === 'paid' && inv.paid_at ? `Paid on ${formatDate(inv.paid_at)}` : undefined}
                          >
                            {badge.label}
                          </span>
                          {inv.status === 'paid' && inv.paid_at && (
                            <p className="hb-note">{formatDate(inv.paid_at)}</p>
                          )}
                        </div>
                      </td>
                      <td data-label="Reminder">
                        {inv.status === 'issued' ? (
                          <div>
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleSendReminder(inv.id)}
                              disabled={remindingId !== null}
                            >
                              {remindingId === inv.id ? 'Sending…' : 'Send reminder'}
                            </button>
                            {msg && (
                              <p className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>
                            )}
                            {(inv.reminders_sent ?? 0) > 0 && (
                              <p className="hb-note">
                                Sent {inv.reminders_sent}×{inv.last_reminder_at ? ` · last ${formatDate(inv.last_reminder_at)}` : ''}
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
