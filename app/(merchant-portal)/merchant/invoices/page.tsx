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

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  issued: { bg: '#fffbeb', color: '#b45309', label: 'Unpaid' },
  paid:   { bg: '#f0fdf4', color: '#15803d', label: 'Paid' },
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

  async function handleLogout() {
    await fetch('/api/merchant/auth/logout', { method: 'POST' });
    router.push('/merchant/login');
  }

  if (loading) {
    return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</main>;
  }

  return (
    <main style={s.page}>
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 36 }} />
          <nav style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a href="/merchant/dashboard" style={s.navLink}>Dashboard</a>
            <a href="/merchant/payment_methods" style={s.navLink}>Payment Methods</a>
            <a href="/merchant/payment-links" style={s.navLink}>Payment Links</a>
            <a href="/merchant/invoices" style={s.navActive}>Invoices</a>
            <a href="/merchant/settings" style={s.navLink}>Settings</a>
            <button style={s.logoutBtn} onClick={handleLogout}>Log out</button>
          </nav>
        </div>

        <div style={{ marginBottom: 24 }}>
          <h1 style={s.title}>Invoices</h1>
          <p style={s.sub}>
            Invoices appear here automatically when you BCC them to your invoice inbox address (shown on Settings).
            Payments are matched by invoice number.
          </p>
        </div>

        {/* Outstanding summary chips */}
        {outstanding.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            {outstanding.map(o => (
              <div key={o.currency} style={s.chip}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Outstanding ({o.currency})
                </span>
                <span style={{ fontSize: 20, fontWeight: 800 }}>
                  {formatAmount(String(o.total), o.currency)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Invoices table */}
        <div style={s.card}>
          {invoices.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>
              No invoices yet — add your BCC address to your accounting software (see{' '}
              <a href="/merchant/settings" style={{ color: 'var(--text)', fontWeight: 600 }}>Settings</a>).
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Date', 'Payer', 'Invoice #', 'Amount', 'Status', 'Reminder'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => {
                    const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.issued;
                    return (
                      <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatDate(inv.created_at)}</td>
                        <td style={{ padding: '10px 12px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inv.payer_email || '—'}
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {inv.invoice_number || '—'}
                        </td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{formatAmount(inv.amount, inv.currency)}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{ background: st.bg, color: st.color, borderRadius: 6, padding: '2px 8px', fontWeight: 600, fontSize: 11 }}
                            title={inv.status === 'paid' && inv.paid_at ? `Paid on ${formatDate(inv.paid_at)}` : undefined}
                          >
                            {st.label}
                          </span>
                          {inv.status === 'paid' && inv.paid_at && (
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                              {formatDate(inv.paid_at)}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          {inv.status === 'issued' && (
                            <>
                              <button
                                style={{ ...s.remindBtn, cursor: remindingId === inv.id ? 'wait' : 'pointer', opacity: remindingId === inv.id ? 0.6 : 1 }}
                                onClick={() => handleSendReminder(inv.id)}
                                disabled={remindingId !== null}
                              >
                                {remindingId === inv.id ? 'Sending...' : 'Send reminder'}
                              </button>
                              {remindMsg[inv.id] && (
                                <span style={{ display: 'block', fontSize: 11, color: remindMsg[inv.id].ok ? '#16a34a' : '#dc2626', marginTop: 3, whiteSpace: 'normal', maxWidth: 160 }}>
                                  {remindMsg[inv.id].text}
                                </span>
                              )}
                              {(inv.reminders_sent ?? 0) > 0 && (
                                <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                                  Sent {inv.reminders_sent}×{inv.last_reminder_at ? ` · last ${formatDate(inv.last_reminder_at)}` : ''}
                                </span>
                              )}
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
        </div>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px' },
  container: { maxWidth: 900, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 800, margin: '0 0 6px' },
  sub: { color: 'var(--muted)', fontSize: 14, margin: 0 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px', marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.04)' },
  chip: { display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' },
  navLink: { fontSize: 14, color: 'var(--muted)', textDecoration: 'none' },
  navActive: { fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' },
  logoutBtn: { fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' },
  remindBtn: { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
};
