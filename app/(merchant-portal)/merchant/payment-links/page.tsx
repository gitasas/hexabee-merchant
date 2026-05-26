'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type PaymentLink = {
  id: string;
  short_id: string;
  checkout_url: string;
  amount_minor: number | null;
  currency: string;
  reference: string | null;
  status: string;
  used_count: number;
  max_uses: number | null;
  created_at: string;
  updated_at: string;
};

const CURRENCIES = ['GBP', 'EUR', 'USD', 'PLN', 'SEK', 'DKK', 'NOK', 'CHF'];

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  active:    { bg: '#f0fdf4', color: '#15803d', label: 'Active' },
  expired:   { bg: '#fefce8', color: '#854d0e', label: 'Expired' },
  exhausted: { bg: '#fff7ed', color: '#9a3412', label: 'Exhausted' },
  disabled:  { bg: '#f4f4f5', color: '#71717a', label: 'Disabled' },
};

function formatAmount(amountMinor: number | null, currency: string): string {
  if (amountMinor === null) return 'Open';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amountMinor / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PaymentLinksPage() {
  const router = useRouter();
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<PaymentLink | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [defaultCurrency, setDefaultCurrency] = useState('GBP');
  const [merchantName, setMerchantName] = useState('');

  // Form state
  const [fOpenAmount, setFOpenAmount] = useState(false);
  const [fAmount, setFAmount] = useState('');
  const [fCurrency, setFCurrency] = useState('GBP');
  const [fReference, setFReference] = useState('');
  const [fExpiresAt, setFExpiresAt] = useState('');
  const [fMaxUses, setFMaxUses] = useState('');

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
        const cur = data.business_currency || 'GBP';
        setDefaultCurrency(cur);
        setFCurrency(cur);
        setMerchantName(data.business_name || '');
        loadLinks();
      });
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadLinks() {
    setLoading(true);
    fetch('/api/admin/payment-links')
      .then(r => r.ok ? r.json() : [])
      .then(data => setLinks(Array.isArray(data) ? data : []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  function copyUrl(url: string, id: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function sendByEmail(link: PaymentLink) {
    const amountDisplay =
      link.amount_minor === null
        ? 'Any amount'
        : formatAmount(link.amount_minor, link.currency);
    const referenceOrDash =
      link.reference && link.reference.trim() ? link.reference : '—';
    const subject = `Payment request from ${merchantName}`;
    const body =
      `Hi,\n` +
      `\n` +
      `You can pay this invoice securely via the link below:\n` +
      `${link.checkout_url}\n` +
      `\n` +
      `Amount: ${amountDisplay}\n` +
      `Reference: ${referenceOrDash}\n` +
      `\n` +
      `Thanks,\n` +
      `${merchantName}`;
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  function resetForm() {
    setFOpenAmount(false);
    setFAmount('');
    setFCurrency(defaultCurrency);
    setFReference('');
    setFExpiresAt('');
    setFMaxUses('');
    setFormError(null);
    setCreatedLink(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const amountStr = fAmount.trim().replace(',', '.');
    if (!fOpenAmount) {
      const num = parseFloat(amountStr);
      if (!amountStr || isNaN(num) || num <= 0) {
        setFormError('Enter a valid amount, or tick "Let payer enter amount".');
        return;
      }
      if (Math.round(num * 100) > 10_000_000) {
        setFormError('Amount too large (max £/€100,000).');
        return;
      }
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { currency: fCurrency };
      if (!fOpenAmount) body.amount_minor = Math.round(parseFloat(amountStr) * 100);
      if (fReference.trim()) body.reference = fReference.trim();
      if (fExpiresAt) body.expires_at = new Date(fExpiresAt).toISOString();
      if (fMaxUses.trim()) {
        const mu = parseInt(fMaxUses, 10);
        if (!isNaN(mu) && mu > 0) body.max_uses = mu;
      }

      const res = await fetch('/api/admin/payment-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.detail || data.error || 'Failed to create payment link');
        return;
      }
      setCreatedLink(data);
      setLinks(prev => [data, ...prev]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisable(id: string) {
    try {
      const res = await fetch(`/api/admin/payment-links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'disabled' }),
      });
      if (res.ok) {
        setLinks(prev => prev.map(l => l.id === id ? { ...l, status: 'disabled' } : l));
        showToast('Link disabled');
      }
    } catch { /* silent */ }
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
      {toast && <div style={s.toast}>{toast}</div>}

      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 36 }} />
          <nav style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a href="/merchant/dashboard" style={s.navLink}>Dashboard</a>
            <a href="/merchant/payment_methods" style={s.navLink}>Payment Methods</a>
            <a href="/merchant/payment-links" style={s.navActive}>Payment Links</a>
            <a href="/merchant/settings" style={s.navLink}>Settings</a>
            <button style={s.logoutBtn} onClick={handleLogout}>Log out</button>
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={s.title}>Payment Links</h1>
            <p style={s.sub}>Create shareable links for your customers. Each link generates a unique checkout page.</p>
          </div>
          <button style={s.btn} onClick={() => { resetForm(); setShowForm(true); }}>
            + New Payment Link
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div style={s.card}>
            <h2 style={s.cardTitle}>{createdLink ? '✅ Link created' : 'New Payment Link'}</h2>

            {createdLink ? (
              <>
                <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 12 }}>Share this link with your customer:</p>
                <div style={s.urlBox}>{createdLink.checkout_url}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    style={{ ...s.secondaryBtn, background: copiedId === createdLink.id ? '#16a34a' : undefined, color: copiedId === createdLink.id ? '#fff' : undefined }}
                    onClick={() => copyUrl(createdLink.checkout_url, createdLink.id)}
                  >
                    {copiedId === createdLink.id ? '✓ Copied!' : 'Copy URL'}
                  </button>
                  <button style={s.secondaryBtn} onClick={() => { setShowForm(false); resetForm(); }}>
                    Close
                  </button>
                  <button style={s.secondaryBtn} onClick={resetForm}>
                    Create another
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Open amount toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={fOpenAmount}
                    onChange={e => setFOpenAmount(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  Let payer enter amount
                </label>

                {/* Amount + Currency */}
                {!fOpenAmount && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <label style={{ ...s.label, flex: 1 }}>Amount
                      <input
                        style={s.input}
                        type="number"
                        placeholder="0.00"
                        min="0.01"
                        step="0.01"
                        value={fAmount}
                        onChange={e => setFAmount(e.target.value)}
                        required={!fOpenAmount}
                      />
                    </label>
                    <label style={s.label}>Currency
                      <select style={s.input} value={fCurrency} onChange={e => setFCurrency(e.target.value)}>
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                  </div>
                )}
                {fOpenAmount && (
                  <label style={s.label}>Currency
                    <select style={s.input} value={fCurrency} onChange={e => setFCurrency(e.target.value)}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                )}

                <label style={s.label}>Reference <span style={s.optional}>(optional)</span>
                  <input style={s.input} type="text" placeholder="e.g. Invoice #1234" value={fReference} onChange={e => setFReference(e.target.value)} />
                </label>

                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ ...s.label, flex: 1 }}>Expires at <span style={s.optional}>(optional)</span>
                    <input style={s.input} type="datetime-local" value={fExpiresAt} onChange={e => setFExpiresAt(e.target.value)} />
                  </label>
                  <label style={{ ...s.label, flex: 1 }}>Max uses <span style={s.optional}>(optional)</span>
                    <input style={s.input} type="number" placeholder="Unlimited" min="1" step="1" value={fMaxUses} onChange={e => setFMaxUses(e.target.value)} />
                  </label>
                </div>

                {formError && <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>{formError}</p>}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ ...s.btn, opacity: submitting ? 0.6 : 1 }} type="submit" disabled={submitting}>
                    {submitting ? 'Creating...' : 'Create Link'}
                  </button>
                  <button style={s.secondaryBtn} type="button" onClick={() => { setShowForm(false); resetForm(); }}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Links table */}
        <div style={s.card}>
          {links.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>
              No payment links yet. Create your first one above.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Short ID', 'Amount', 'Reference', 'Status', 'Uses', 'Created', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {links.map(link => {
                    const st = STATUS_STYLE[link.status] ?? STATUS_STYLE.disabled;
                    const isCopied = copiedId === link.id;
                    return (
                      <tr key={link.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{link.short_id}</td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{formatAmount(link.amount_minor, link.currency)}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {link.reference || '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: '2px 8px', fontWeight: 600, fontSize: 11 }}>
                            {st.label}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          {link.used_count}{link.max_uses != null ? ` / ${link.max_uses}` : ''}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatDate(link.created_at)}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              style={{ ...s.actionBtn, background: isCopied ? '#16a34a' : undefined, color: isCopied ? '#fff' : undefined }}
                              onClick={() => copyUrl(link.checkout_url, link.id)}
                            >
                              {isCopied ? '✓' : 'Copy'}
                            </button>
                            {link.status === 'active' && (
                              <button
                                style={s.actionBtn}
                                onClick={() => sendByEmail(link)}
                              >
                                Send
                              </button>
                            )}
                            {link.status === 'active' && (
                              <button
                                style={{ ...s.actionBtn, color: '#dc2626', borderColor: '#fca5a5' }}
                                onClick={() => handleDisable(link.id)}
                              >
                                Disable
                              </button>
                            )}
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
  cardTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 16px' },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14, fontWeight: 600 },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--bg)', fontWeight: 400 },
  optional: { fontWeight: 400, color: 'var(--muted)', fontSize: 12 },
  btn: { padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  secondaryBtn: { padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  actionBtn: { padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  urlBox: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' as const, color: 'var(--text)' },
  toast: { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#111', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 100, pointerEvents: 'none' as const },
  navLink: { fontSize: 14, color: 'var(--muted)', textDecoration: 'none' },
  navActive: { fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' },
  logoutBtn: { fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' },
};
