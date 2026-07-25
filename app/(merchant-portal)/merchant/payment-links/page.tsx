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

const FEE_PCT = 0.02;
const FEE_FIXED_MINOR: Record<string, number> = { GBP: 20, EUR: 25 };
function grossUpMinor(netMinor: number, currency: string): number {
  const fixed = FEE_FIXED_MINOR[currency.toUpperCase()] ?? 25;
  return Math.ceil((netMinor + fixed) / (1 - FEE_PCT));
}

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  active: { cls: 'is-paid', label: 'Active' },
  expired: { cls: 'is-pending', label: 'Expired' },
  exhausted: { cls: 'is-pending', label: 'Exhausted' },
  disabled: { cls: 'is-neutral', label: 'Disabled' },
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
  const [fFeeMode, setFFeeMode] = useState<'merchant' | 'payer'>('merchant');

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
    setFFeeMode('merchant');
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
      if (!fOpenAmount) {
        const netMinor = Math.round(parseFloat(amountStr) * 100);
        const chargeMinor = fFeeMode === 'payer' ? grossUpMinor(netMinor, fCurrency) : netMinor;
        body.amount_minor = chargeMinor;
        body.fee_mode = fFeeMode;
        if (fFeeMode === 'payer') body.net_minor = netMinor;
      }
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
    if (!window.confirm('Disable this payment link? Anyone with this URL will no longer be able to pay. This cannot be undone — you\'ll need to create a new link.')) return;
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

  function openForm() {
    resetForm();
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    resetForm();
  }

  if (loading) return <p className="hb-skeleton">Loading…</p>;

  return (
    <>
      {toast && <div className="hb-toast">{toast}</div>}

      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">Payment links</h1>
          <p className="hb-sub">Create shareable links for your customers. Each link generates a unique checkout page.</p>
        </div>
        <div className="hb-actions">
          <button type="button" className="hb-btn primary" onClick={openForm}>
            + New payment link
          </button>
        </div>
      </div>

      {/* Create form — collapsed behind the button above */}
      {showForm && createdLink && (
        <div className="hb-card">
          <h2 className="hb-card-title">✅ Link created</h2>
          <p className="hb-card-sub">Share this link with your customer.</p>
          <p className="hb-urlbox">{createdLink.checkout_url}</p>
          <div className="hb-actions">
            <button
              type="button"
              className={`hb-btn ${copiedId === createdLink.id ? 'ok' : 'primary'}`}
              onClick={() => copyUrl(createdLink.checkout_url, createdLink.id)}
            >
              {copiedId === createdLink.id ? '✓ Copied!' : '⎘ Copy URL'}
            </button>
            <button type="button" className="hb-btn" onClick={() => sendByEmail(createdLink)}>
              ✉️ Send by email
            </button>
            <button type="button" className="hb-btn" onClick={resetForm}>Create another</button>
            <button type="button" className="hb-btn" onClick={closeForm}>Close</button>
          </div>
        </div>
      )}

      {showForm && !createdLink && (
        <div className="hb-card">
          <h2 className="hb-card-title">New payment link</h2>
          <p className="hb-card-sub">Fixed or open amount — the link works the same either way.</p>

          <form onSubmit={handleSubmit}>
            <label className="hb-check">
              <input
                type="checkbox"
                checked={fOpenAmount}
                onChange={e => setFOpenAmount(e.target.checked)}
              />
              Let payer enter amount
            </label>

            {fOpenAmount ? (
              <label className="hb-field">
                Currency
                <select className="hb-input" value={fCurrency} onChange={e => setFCurrency(e.target.value)}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ) : (
              <div className="hb-grid-2">
                <label className="hb-field">
                  Amount
                  <input
                    className="hb-input"
                    type="number"
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    value={fAmount}
                    onChange={e => setFAmount(e.target.value)}
                    required={!fOpenAmount}
                  />
                </label>
                <label className="hb-field">
                  Currency
                  <select className="hb-input" value={fCurrency} onChange={e => setFCurrency(e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
            )}

            {/* Who pays the fee — baked into the amount at creation time */}
            {!fOpenAmount && (
              <div className="hb-field">
                Who pays the fee
                <div className="hb-segment">
                  {([
                    { mode: 'merchant' as const, label: 'I cover it' },
                    { mode: 'payer' as const, label: 'Payer covers it' },
                  ]).map(opt => (
                    <button
                      key={opt.mode}
                      type="button"
                      className={`hb-btn${fFeeMode === opt.mode ? ' selected' : ''}`}
                      onClick={() => setFFeeMode(opt.mode)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {fFeeMode === 'payer' && (() => {
                  const netMinor = Math.round(parseFloat(fAmount.trim().replace(',', '.')) * 100);
                  if (!Number.isFinite(netMinor) || netMinor <= 0) return null;
                  return (
                    <p className="hb-note">
                      Payer pays {formatAmount(grossUpMinor(netMinor, fCurrency), fCurrency)} · you receive {formatAmount(netMinor, fCurrency)}. Assumes card/wallet; cheaper methods net you slightly more.
                    </p>
                  );
                })()}
              </div>
            )}

            <label className="hb-field">
              <span>Reference <span className="hb-optional">(optional)</span></span>
              <input
                className="hb-input"
                type="text"
                placeholder="e.g. Invoice #1234"
                value={fReference}
                onChange={e => setFReference(e.target.value)}
              />
            </label>

            <div className="hb-grid-2">
              <label className="hb-field">
                <span>Expires at <span className="hb-optional">(optional)</span></span>
                <input
                  className="hb-input"
                  type="datetime-local"
                  value={fExpiresAt}
                  onChange={e => setFExpiresAt(e.target.value)}
                />
              </label>
              <label className="hb-field">
                <span>Max uses <span className="hb-optional">(optional)</span></span>
                <input
                  className="hb-input"
                  type="number"
                  placeholder="Unlimited"
                  min="1"
                  step="1"
                  value={fMaxUses}
                  onChange={e => setFMaxUses(e.target.value)}
                />
              </label>
            </div>

            {formError && <p className="hb-msg err">{formError}</p>}

            <div className="hb-actions" style={{ marginTop: 14 }}>
              <button className="hb-btn primary" type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create link'}
              </button>
              <button className="hb-btn" type="button" onClick={closeForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="hb-card">
        {links.length === 0 ? (
          <div className="hb-empty">
            <p className="hb-empty-title">No payment links yet</p>
            <p>Create one and share the URL — your customer pays without needing an invoice.</p>
            <button type="button" className="hb-btn primary" onClick={openForm}>
              + New payment link
            </button>
          </div>
        ) : (
          <div className="hb-table-wrap">
            <table className="hb-table">
              <thead>
                <tr>
                  <th>Short ID</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Status</th>
                  <th>Uses</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {links.map(link => {
                  const badge = STATUS_BADGE[link.status] ?? STATUS_BADGE.disabled;
                  const isCopied = copiedId === link.id;
                  return (
                    <tr key={link.id}>
                      <td data-label="Short ID" className="hb-mono">{link.short_id}</td>
                      <td data-label="Amount" className="hb-num">{formatAmount(link.amount_minor, link.currency)}</td>
                      <td data-label="Reference">{link.reference || '—'}</td>
                      <td data-label="Status">
                        <span className={`hb-badge ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td data-label="Uses" className="hb-num">
                        {link.used_count}{link.max_uses != null ? ` / ${link.max_uses}` : ''}
                      </td>
                      <td data-label="Created">{formatDate(link.created_at)}</td>
                      <td data-label="">
                        <div className="hb-actions">
                          <button
                            type="button"
                            className={`hb-btn sm${isCopied ? ' ok' : ''}`}
                            onClick={() => copyUrl(link.checkout_url, link.id)}
                          >
                            {isCopied ? '✓' : 'Copy'}
                          </button>
                          {link.status === 'active' && (
                            <button type="button" className="hb-btn sm" onClick={() => sendByEmail(link)}>
                              Send
                            </button>
                          )}
                          {link.status === 'active' && (
                            <button
                              type="button"
                              className="hb-btn sm"
                              style={{ color: 'var(--hb-err)', borderColor: '#fca5a5' }}
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
    </>
  );
}
