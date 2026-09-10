'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';

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
  fee_mode?: string | null;   // 'merchant' | 'payer' | null on links made before the choice existed
};

// Only the currencies of the countries HexaBee can actually take a payment in:
// GBP for the UK on Stripe, EUR and PLN for Montonio's countries. Offering USD or
// a Scandinavian currency produced a link nothing could settle.
const CURRENCIES = ['EUR', 'GBP', 'PLN'];

// Mirrors calculateHexabeeFee's standard (card) tier in the payments backend
// (index.js): GBP → 2% + 20 minor units, other currencies → 2.9% + 25.
// Gross-up solves gross − fee(gross) = net.
function grossUpMinor(netMinor: number, currency: string): number {
  if (currency.toUpperCase() === 'GBP') {
    return Math.ceil((netMinor + 20) / (1 - 0.02));
  }
  return Math.ceil((netMinor + 25) / (1 - 0.029));
}

/**
 * What a Montonio payer is charged on top, in minor units.
 *
 * HexaBee's EUR 0.39 platform fee is always theirs; the fee mode decides only
 * whether they also cover the EUR 0.10 bank cost. Nothing is baked into a
 * Montonio link's amount — /api/payment/montonio adds this at checkout, for
 * fixed and open amounts alike, because the fee is the same number whatever the
 * payer eventually enters. Grossing up here as well charged the payer a card
 * percentage *and* the flat fee.
 */
function montonioFeeMinor(feeMode: 'merchant' | 'payer'): number {
  return feeMode === 'payer' ? 49 : 39;
}

const STATUS_CLS: Record<string, string> = {
  active: 'is-paid',
  expired: 'is-pending',
  exhausted: 'is-pending',
  disabled: 'is-neutral',
};

export default function PaymentLinksPage() {
  const router = useRouter();
  const { t } = useLang();

  const statusLabels: Record<string, string> = {
    active: t.links.statusActive,
    expired: t.links.statusExpired,
    exhausted: t.links.statusExhausted,
    disabled: t.links.statusDisabled,
  };

  const formatAmount = (amountMinor: number | null, currency: string): string => {
    if (amountMinor === null) return t.links.openAmount;
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amountMinor / 100);
  };

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(t.locale, { day: '2-digit', month: 'short', year: 'numeric' });

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
  const [isMontonio, setIsMontonio] = useState(false);

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
        if (!isOnboardingComplete(data)) {
          router.push('/merchant/onboarding');
          return;
        }
        const cur = data.business_currency || 'GBP';
        setDefaultCurrency(cur);
        setFCurrency(cur);
        setMerchantName(data.business_name || '');
        setIsMontonio(data.payment_rail === 'montonio');
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
        ? t.links.emailAnyAmount
        : formatAmount(link.amount_minor, link.currency);
    const referenceOrDash =
      link.reference && link.reference.trim() ? link.reference : '—';
    const subject = t.links.emailSubject(merchantName);
    const body = t.links.emailBody(link.checkout_url, amountDisplay, referenceOrDash, merchantName);
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
        setFormError(t.links.errInvalidAmount);
        return;
      }
      if (Math.round(num * 100) > 10_000_000) {
        setFormError(t.links.errAmountTooLarge);
        return;
      }
    }

    setSubmitting(true);
    try {
      // fee_mode goes up either way: on Stripe a fixed amount has it baked in
      // and an open amount needs it stored so the pay page can gross up later;
      // on Montonio the checkout adds the flat fee itself, so the stored amount
      // stays the invoice amount and fee_mode is what tells it whether to.
      const body: Record<string, unknown> = { currency: fCurrency, fee_mode: fFeeMode };
      if (!fOpenAmount) {
        const netMinor = Math.round(parseFloat(amountStr) * 100);
        body.amount_minor = fFeeMode === 'payer' && !isMontonio
          ? grossUpMinor(netMinor, fCurrency)
          : netMinor;
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
        setFormError(data.detail || data.error || t.links.errCreateFailed);
        return;
      }
      setCreatedLink(data);
      setLinks(prev => [data, ...prev]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t.common.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisable(id: string) {
    if (!window.confirm(t.links.confirmDisable)) return;
    try {
      const res = await fetch(`/api/admin/payment-links/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'disabled' }),
      });
      if (res.ok) {
        setLinks(prev => prev.map(l => l.id === id ? { ...l, status: 'disabled' } : l));
        showToast(t.links.linkDisabled);
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

  if (loading) return <p className="hb-skeleton">{t.common.loading}</p>;

  return (
    <>
      {toast && <div className="hb-toast">{toast}</div>}

      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.links.title}</h1>
          <p className="hb-sub">{t.links.sub}</p>
        </div>
        <div className="hb-actions">
          <button type="button" className="hb-btn primary" onClick={openForm}>
            {t.links.newLink}
          </button>
        </div>
      </div>

      {/* Create form — collapsed behind the button above */}
      {showForm && createdLink && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.links.createdTitle}</h2>
          <p className="hb-card-sub">{t.links.createdSub}</p>
          <p className="hb-urlbox">{createdLink.checkout_url}</p>
          <div className="hb-actions">
            <button
              type="button"
              className={`hb-btn ${copiedId === createdLink.id ? 'ok' : 'primary'}`}
              onClick={() => copyUrl(createdLink.checkout_url, createdLink.id)}
            >
              {copiedId === createdLink.id ? t.links.copiedUrl : t.links.copyUrl}
            </button>
            <button type="button" className="hb-btn" onClick={() => sendByEmail(createdLink)}>
              {t.links.sendByEmail}
            </button>
            <button type="button" className="hb-btn" onClick={resetForm}>{t.links.createAnother}</button>
            <button type="button" className="hb-btn" onClick={closeForm}>{t.common.close}</button>
          </div>
        </div>
      )}

      {showForm && !createdLink && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.links.formTitle}</h2>
          <p className="hb-card-sub">{t.links.formSub}</p>

          <form onSubmit={handleSubmit}>
            <label className="hb-check">
              <input
                type="checkbox"
                checked={fOpenAmount}
                onChange={e => setFOpenAmount(e.target.checked)}
              />
              {t.links.letPayerEnter}
            </label>

            {fOpenAmount ? (
              <label className="hb-field">
                {t.links.currency}
                <select className="hb-input" value={fCurrency} onChange={e => setFCurrency(e.target.value)}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ) : (
              <div className="hb-grid-2">
                <label className="hb-field">
                  {t.links.amount}
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
                  {t.links.currency}
                  <select className="hb-input" value={fCurrency} onChange={e => setFCurrency(e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
            )}

            {/* Who pays the fee. A fixed amount bakes it in here; an open amount
                cannot, so the choice is stored on the link and applied when the
                payer finally enters a number. Hiding the option for open amounts
                silently forced the merchant to absorb the fee. */}
            {(
              <div className="hb-field">
                {t.links.whoPaysFee}
                <div className="hb-segment">
                  {([
                    { mode: 'merchant' as const, label: t.links.iCoverIt },
                    { mode: 'payer' as const, label: t.links.payerCoversIt },
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
                {/* On Montonio the payer is charged something either way — the
                    EUR 0.39 platform fee is theirs whoever covers the bank cost
                    — so the preview shows for both modes, not just 'payer'. */}
                {(fFeeMode === 'payer' || isMontonio) && fOpenAmount && (
                  <p className="hb-note">
                    {isMontonio
                      ? t.links.feeNoteOpenFlat(formatAmount(montonioFeeMinor(fFeeMode), 'EUR'))
                      : t.links.feeNoteOpen}
                  </p>
                )}
                {(fFeeMode === 'payer' || isMontonio) && !fOpenAmount && (() => {
                  const netMinor = Math.round(parseFloat(fAmount.trim().replace(',', '.')) * 100);
                  if (!Number.isFinite(netMinor) || netMinor <= 0) return null;
                  // Flat on the Baltic rail, a percentage on Stripe. Quoting the
                  // wrong one tells the merchant a total their payer never sees.
                  const grossMinor = isMontonio
                    ? netMinor + montonioFeeMinor(fFeeMode)
                    : grossUpMinor(netMinor, fCurrency);
                  const feeCurrency = isMontonio ? 'EUR' : fCurrency;
                  return (
                    <p className="hb-note">
                      {t.links.feeNote(formatAmount(grossMinor, feeCurrency), formatAmount(netMinor, feeCurrency))}
                    </p>
                  );
                })()}
              </div>
            )}

            <label className="hb-field">
              <span>{t.links.reference} <span className="hb-optional">{t.common.optional}</span></span>
              <input
                className="hb-input"
                type="text"
                placeholder={t.links.referencePlaceholder}
                value={fReference}
                onChange={e => setFReference(e.target.value)}
              />
            </label>

            <div className="hb-grid-2">
              <label className="hb-field">
                <span>{t.links.expiresAt} <span className="hb-optional">{t.common.optional}</span></span>
                <input
                  className="hb-input"
                  type="datetime-local"
                  value={fExpiresAt}
                  onChange={e => setFExpiresAt(e.target.value)}
                />
              </label>
              <label className="hb-field">
                <span>{t.links.maxUses} <span className="hb-optional">{t.common.optional}</span></span>
                <input
                  className="hb-input"
                  type="number"
                  placeholder={t.links.unlimited}
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
                {submitting ? t.links.creating : t.links.create}
              </button>
              <button className="hb-btn" type="button" onClick={closeForm}>{t.common.cancel}</button>
            </div>
          </form>
        </div>
      )}

      <div className="hb-card">
        {links.length === 0 ? (
          <div className="hb-empty">
            <p className="hb-empty-title">{t.links.emptyTitle}</p>
            <p>{t.links.emptySub}</p>
            <button type="button" className="hb-btn primary" onClick={openForm}>
              {t.links.newLink}
            </button>
          </div>
        ) : (
          <div className="hb-table-wrap">
            <table className="hb-table">
              <thead>
                <tr>
                  <th>{t.links.thShortId}</th>
                  <th>{t.links.thAmount}</th>
                  <th>{t.links.thReference}</th>
                  <th>{t.links.thStatus}</th>
                  <th>{t.links.thFee}</th>
                  <th>{t.links.thUses}</th>
                  <th>{t.links.thCreated}</th>
                  <th>{t.links.thActions}</th>
                </tr>
              </thead>
              <tbody>
                {links.map(link => {
                  const badgeCls = STATUS_CLS[link.status] ?? STATUS_CLS.disabled;
                  const badgeLabel = statusLabels[link.status] ?? link.status;
                  const isCopied = copiedId === link.id;
                  return (
                    <tr key={link.id}>
                      <td data-label={t.links.thShortId} className="hb-mono">{link.short_id}</td>
                      <td data-label={t.links.thAmount} className="hb-num">{formatAmount(link.amount_minor, link.currency)}</td>
                      <td data-label={t.links.thReference}>{link.reference || '—'}</td>
                      <td data-label={t.links.thStatus}>
                        <span className={`hb-badge ${badgeCls}`}>{badgeLabel}</span>
                      </td>
                      {/* A saved link had to be taken on trust: the choice was
                          stored but never shown, so a merchant could not tell a
                          link where they absorb the fee from one where the payer
                          does. Older links genuinely have no answer. */}
                      <td data-label={t.links.thFee}>
                        {link.fee_mode === 'payer'
                          ? t.links.feePaidByPayer
                          : link.fee_mode === 'merchant'
                            ? t.links.feePaidByMerchant
                            : '—'}
                      </td>
                      <td data-label={t.links.thUses} className="hb-num">
                        {link.used_count}{link.max_uses != null ? ` / ${link.max_uses}` : ''}
                      </td>
                      <td data-label={t.links.thCreated}>{formatDate(link.created_at)}</td>
                      <td data-label="">
                        <div className="hb-actions">
                          <button
                            type="button"
                            className={`hb-btn sm${isCopied ? ' ok' : ''}`}
                            onClick={() => copyUrl(link.checkout_url, link.id)}
                          >
                            {isCopied ? '✓' : t.links.rowCopy}
                          </button>
                          {link.status === 'active' && (
                            <button type="button" className="hb-btn sm" onClick={() => sendByEmail(link)}>
                              {t.links.rowSend}
                            </button>
                          )}
                          {link.status === 'active' && (
                            <button
                              type="button"
                              className="hb-btn sm"
                              style={{ color: 'var(--hb-err)', borderColor: '#fca5a5' }}
                              onClick={() => handleDisable(link.id)}
                            >
                              {t.links.rowDisable}
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
