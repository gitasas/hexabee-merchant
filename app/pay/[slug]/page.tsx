'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

type Merchant = { business_name: string; iban?: string | null; sort_code?: string | null; account_number?: string | null; slug: string; enabled_methods?: string[] | null; stripe_account_id?: string | null; currency?: string | null };
type ParsedPdf = { success?: boolean; amount?: string | null; currency?: string | null; reference?: string | null; iban?: string | null; invoice_number?: string | null };
type Payload = { parsedPdf?: ParsedPdf; email?: string; admin_invoice_id?: string };

// Payment link data — fetched when ?pl=xxx is in the URL
type PayLinkData = {
  short_id: string;
  amount_minor: number | null;   // null = open amount, payer enters
  currency: string;              // always resolved, never null
  reference: string | null;
  merchant_slug: string;
  merchant_name: string;
  merchant_stripe_account_id: string | null;
  merchant_stripe_account_id_live: string | null;
};

type PayMethod = {
  id: string;
  name: string;
  icon: string;
  description: string;
  fee: string;
  type: 'stripe' | 'stripe_bank' | 'bank_soon';
};

const GBP_METHODS: PayMethod[] = [
  { id: 'pay_by_bank', name: 'Pay By Bank', icon: '🏦', description: 'Instant bank transfer', fee: '0.8%', type: 'stripe_bank' },
  { id: 'bacs', name: 'Bacs Direct Debit', icon: '🔁', description: 'UK direct debit, max £4 fee', fee: '0.8% max £4', type: 'stripe_bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + £0.20', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + £0.20', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + £0.20', type: 'stripe' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '2% + £0.20', type: 'stripe' },
  { id: 'afterpay', name: 'Afterpay / Clearpay', icon: '📦', description: 'Pay in 4 instalments', fee: '2% + £0.20', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '£1.50 flat', type: 'stripe_bank' },
];

const EUR_METHODS: PayMethod[] = [
  { id: 'sepa', name: 'SEPA Direct Debit', icon: '🔁', description: 'EU direct debit, max €5 fee', fee: '0.8% max €5', type: 'stripe_bank' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '€1.50 flat', type: 'stripe_bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + €0.25', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + €0.25', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + €0.25', type: 'stripe' },
  { id: 'ideal', name: 'iDEAL', icon: '🇳🇱', description: 'Netherlands instant bank payment', fee: '€0.59 flat', type: 'stripe_bank' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '2% + €0.25', type: 'stripe' },
  { id: 'billie', name: 'Billie', icon: '🏢', description: 'B2B buy now pay later', fee: '2% + €0.25', type: 'stripe' },
];

const OTHER_METHODS: PayMethod[] = [
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: 'Standard rate', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: 'Standard rate', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: 'Standard rate', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: 'Flat fee', type: 'stripe_bank' },
];

function methodsForCurrency(cur: string): PayMethod[] {
  const c = cur.toUpperCase();
  if (c === 'GBP') return GBP_METHODS;
  if (c === 'EUR') return EUR_METHODS;
  return OTHER_METHODS;
}

function hasExtension(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as Record<string, unknown>)['__hexabee_extension'];
}

// ── POS / QR mode screen ──────────────────────────────────────────────────────
function PosScreen({ merchant, slug }: { merchant: Merchant; slug: string }) {
  // Derive currency from merchant data — DB value takes precedence
  const currency = merchant.currency ?? (merchant.sort_code ? 'GBP' : 'EUR');
  const CURRENCY_SYMBOLS: Record<string, string> = {
    GBP: '£', EUR: '€', USD: '$', PLN: 'zł', SEK: 'kr', DKK: 'kr', NOK: 'kr', CHF: 'CHF',
  };
  const currencySymbol = CURRENCY_SYMBOLS[currency] ?? currency;

  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    const amt = amount.trim().replace(',', '.');
    if (!amt || Number(amt) <= 0) { setError('Please enter a valid amount'); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/payment/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          currency,
          reference: reference.trim() || null,
          email: 'pos@hexabee.com',
          admin_invoice_id: null,
          merchantSlug: slug,
          stripeConnectAccountId: merchant.stripe_account_id ?? undefined,
          payment_method_type: 'card',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) { setError(data.error || 'Could not create payment session'); return; }
      window.location.href = data.payment_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 16px' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 32px', maxWidth: 420, width: '100%', boxSizing: 'border-box', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 64, display: 'block', margin: '0 auto 20px' }} />
        <h2 style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>{merchant.business_name}</h2>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', margin: '0 0 24px' }}>In-person payment</p>

        {/* Amount with static currency prefix */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 32, fontWeight: 800, color: 'var(--muted)', pointerEvents: 'none', userSelect: 'none' }}>
            {currencySymbol}
          </span>
          <input
            style={{ width: '100%', textAlign: 'right', fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', padding: '12px 16px 12px 44px', borderRadius: 12, border: '2px solid var(--border)', outline: 'none', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }}
            type="number"
            placeholder="0.00"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            autoFocus
          />
        </div>

        {/* Reference */}
        <input
          style={{ width: '100%', padding: '11px 14px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)', marginBottom: 20, boxSizing: 'border-box' }}
          type="text"
          placeholder="Reference (optional)"
          value={reference}
          onChange={e => setReference(e.target.value)}
        />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>}

        <button
          style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: loading ? 'var(--border)' : 'var(--brand)', color: '#111', fontWeight: 800, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer' }}
          onClick={handlePay}
          disabled={loading}
        >
          {loading ? 'Redirecting...' : '💳  Pay by Card / Apple Pay / Google Pay'}
        </button>
      </div>
    </main>
  );
}

// ── Payment Link checkout screen ──────────────────────────────────────────────
function PayLinkScreen({ payLink, merchant, slug }: { payLink: PayLinkData; merchant: Merchant; slug: string }) {
  const isLive = !!(process.env.NEXT_PUBLIC_STRIPE_ENV === 'live');
  const stripeConnectAccountId = isLive
    ? (payLink.merchant_stripe_account_id_live ?? undefined)
    : (payLink.merchant_stripe_account_id ?? undefined);

  const CURRENCY_SYMBOLS: Record<string, string> = {
    GBP: '£', EUR: '€', USD: '$', PLN: 'zł', SEK: 'kr', DKK: 'kr', NOK: 'kr', CHF: 'CHF',
  };
  const currencySymbol = CURRENCY_SYMBOLS[payLink.currency] ?? payLink.currency;

  const isOpenAmount = payLink.amount_minor === null;
  const fixedAmountFormatted = isOpenAmount
    ? null
    : new Intl.NumberFormat('en-EU', { style: 'currency', currency: payLink.currency })
        .format(payLink.amount_minor! / 100);

  const [manualAmount, setManualAmount] = useState('');
  // Reference: editable only when link has no pre-set reference
  const [manualReference, setManualReference] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = isOpenAmount
    ? (manualAmount.trim().replace(',', '.') || null)
    : String(payLink.amount_minor! / 100);
  // readonly-if-set: reference field is read-only when the link specifies a reference
  const effectiveReference = payLink.reference ?? (manualReference.trim() || null);

  const allMethods = methodsForCurrency(payLink.currency);
  const enabledMethods = merchant.enabled_methods ?? ['cards', 'apple_pay', 'google_pay', 'revolut_pay', 'bacs', 'bank_transfer', 'klarna', 'afterpay'];
  const visibleMethods = allMethods.filter(m =>
    enabledMethods.some(e =>
      e === m.id || (m.id === 'card' && e === 'cards') || (m.id === 'card' && e === 'cartes_bancaires')
    )
  );

  async function handlePay(methodId: string) {
    if (!effectiveAmount) return;
    setError(null);
    setLoading(methodId);
    try {
      const res = await fetch('/api/payment/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: effectiveAmount,
          currency: payLink.currency,
          reference: effectiveReference,
          email: 'payer@hexabee.com',
          admin_invoice_id: null,
          merchantSlug: slug,
          stripeConnectAccountId,
          payment_method_type: methodId,
          payment_link_short_id: payLink.short_id,  // for webhook → increment
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) { setError(data.error || 'Could not create payment session'); return; }
      window.location.href = data.payment_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(null);
    }
  }

  return (
    <main style={{ ...s.page, minHeight: '100vh', height: 'auto' }}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
        <p style={s.subtitle}>Payment</p>

        {/* Amount — fixed or open */}
        {isOpenAmount ? (
          <div style={{ margin: '16px 0 20px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 32, fontWeight: 800, color: 'var(--muted)', pointerEvents: 'none' }}>
              {currencySymbol}
            </span>
            <input
              style={{ ...s.amountInput, textAlign: 'right', paddingLeft: 44 }}
              type="number" placeholder="0.00" min="0.01" step="0.01"
              value={manualAmount} onChange={e => setManualAmount(e.target.value)} autoFocus
            />
          </div>
        ) : (
          <div style={s.amountBlock}>{fixedAmountFormatted}</div>
        )}

        {/* Details */}
        <div style={s.details}>
          <Row label="Pay to" value={payLink.merchant_name} />
          {payLink.reference ? (
            // Link has a pre-set reference — show read-only
            <Row label="Reference" value={payLink.reference} />
          ) : (
            // Link has no reference — payer may optionally enter one
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>Reference <span style={{ fontSize: 12 }}>(optional)</span></span>
              <input
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--surface)', color: 'var(--text)' }}
                type="text"
                placeholder="e.g. Invoice #1234"
                value={manualReference}
                onChange={e => setManualReference(e.target.value)}
              />
            </div>
          )}
        </div>

        {error && <p style={s.errorText}>{error}</p>}
        <p style={s.howToPay}>How would you like to pay?</p>
        <div style={s.methodList}>
          {visibleMethods.map(method => (
            <div key={method.id} style={s.methodCard}>
              <div style={s.methodInfo}>
                <span style={s.methodName}>{method.name}</span>
                <span style={s.methodDesc}>{method.description}</span>
              </div>
              {method.type === 'stripe' || method.type === 'stripe_bank' ? (
                <button
                  style={{ ...s.payBtn, opacity: (!!loading || !effectiveAmount) ? 0.6 : 1, cursor: (!!loading || !effectiveAmount) ? 'not-allowed' : 'pointer' }}
                  onClick={() => handlePay(method.id)}
                  disabled={!!loading || !effectiveAmount}
                >
                  {loading === method.id ? 'Redirecting...' : 'Pay'}
                </button>
              ) : (
                <span style={s.soonBadge}>Soon</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function PaySlugContent() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAmount, setManualAmount] = useState('');
  const [manualReference, setManualReference] = useState('');
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [institutions, setInstitutions] = useState<{ id: string; name: string; countries: string[]; logo: string | null }[]>([]);
  const [bankSearch, setBankSearch] = useState('');
  const [institutionsLoading, setInstitutionsLoading] = useState(false);

  const isPosMode = searchParams.get('mode') === 'pos';
  const plShortId = searchParams.get('pl');

  // Payment link state — only populated when ?pl= is present
  const [payLink, setPayLink] = useState<PayLinkData | null>(null);
  const [payLinkError, setPayLinkError] = useState<string | null>(null);
  const [payLinkLoading, setPayLinkLoading] = useState(false);

  let payload: Payload | null = null;
  try {
    const raw = searchParams.get('payload');
    if (raw) payload = JSON.parse(raw);
  } catch { /* ignore */ }

  const pdf = payload?.parsedPdf;
  const parsedAmount = (pdf?.amount && pdf.amount !== 'null') ? pdf.amount : null;
  const currency = (pdf?.currency && pdf.currency !== 'null') ? pdf.currency : 'EUR';
  const reference = (pdf?.reference && pdf.reference !== 'null' && pdf.reference !== '-') ? pdf.reference : (pdf?.invoice_number && pdf.invoice_number !== 'null' && pdf.invoice_number !== '-' ? pdf.invoice_number : null);
  const iban = (pdf?.iban && pdf.iban !== 'null') ? pdf.iban : (merchant?.iban ?? null);

  const effectiveReference = reference || manualReference || null;
  const effectiveAmount = parsedAmount || (manualAmount.trim() ? manualAmount.trim().replace(',', '.') : null);

  const formattedAmount = effectiveAmount
    ? new Intl.NumberFormat('en-EU', { style: 'currency', currency: currency || 'EUR' }).format(Number(effectiveAmount))
    : null;

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/pay/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!data) setNotFound(true); else setMerchant(data); });

    // POS mode: skip extension detection entirely
    if (isPosMode) return;

    // Payment link mode: fetch link data, bypass extension detection
    if (plShortId) {
      setPayLinkLoading(true);
      fetch(`/api/pay/payment-link/${plShortId}`)
        .then(async r => ({ data: await r.json(), status: r.status }))
        .then(({ data, status }) => {
          if (status === 200) setPayLink(data);
          else setPayLinkError(data.detail || 'Payment link not found');
        })
        .catch(() => setPayLinkError('Payment link not found'))
        .finally(() => setPayLinkLoading(false));
      setExtensionDetected(true); // bypass extension gate for payment link flow
      return;
    }

    const hasPayload = !!searchParams.get('payload');
    setTimeout(() => setExtensionDetected(hasPayload || hasExtension()), 500);
  }, [slug, isPosMode, plShortId]);

  async function handleStripe(methodId: string) {
    if (!effectiveAmount || !iban) return;
    setError(null); setLoading(methodId);
    const stripeConnectAccountId = merchant?.stripe_account_id ?? undefined;
    try {
      const res = await fetch('/api/payment/stripe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: effectiveAmount, currency, reference: effectiveReference, email: payload?.email ?? 'demo@hexabee.com', admin_invoice_id: payload?.admin_invoice_id ?? null, merchantSlug: slug, stripeConnectAccountId, payment_method_type: methodId }),
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) { setError(data.error || 'Could not create payment session'); return; }
      window.location.href = data.payment_url;
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(null); }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function openBankPicker() {
    setShowBankPicker(true);
    if (institutions.length > 0) return;
    setInstitutionsLoading(true);
    try {
      const res = await fetch('/api/payment/bank/institutions');
      const data = await res.json();
      setInstitutions(Array.isArray(data) ? data : []);
    } catch { setInstitutions([]); }
    finally { setInstitutionsLoading(false); }
  }

  async function handleBankSelect(institutionId: string) {
    if (!effectiveAmount || !iban) return;
    setShowBankPicker(false); setError(null); setLoading('bank');
    try {
      const res = await fetch('/api/payment/bank', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: effectiveAmount, currency, reference: effectiveReference, iban, institutionId, email: payload?.email ?? 'demo@hexabee.com', adminInvoiceId: payload?.admin_invoice_id ?? null, merchantSlug: slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.authorisationUrl) { setError(data.error || 'Could not initiate bank payment'); return; }
      window.location.href = data.authorisationUrl;
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(null); }
  }

  const filteredInstitutions = institutions.filter(i => i.name.toLowerCase().includes(bankSearch.toLowerCase()));

  if (notFound) return (
    <main style={s.page}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
        <p style={{ textAlign: 'center', color: 'var(--muted)' }}>Payment link not found.</p>
      </div>
    </main>
  );

  if (!merchant) return <main style={s.page}><p style={{ color: 'var(--muted)' }}>Loading...</p></main>;

  // ── POS mode: clean in-person form, no extension logic ──
  if (isPosMode) return <PosScreen merchant={merchant} slug={slug} />;

  // ── Payment link mode (?pl=xxx) ──
  if (plShortId) {
    if (payLinkLoading) return <main style={s.page}><div style={s.card}><img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} /><p style={{ textAlign: 'center', color: 'var(--muted)' }}>Loading...</p></div></main>;
    if (payLinkError) return (
      <main style={s.page}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
          <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, margin: '0 0 8px' }}>Payment link unavailable</p>
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>{payLinkError}</p>
        </div>
      </main>
    );
    if (payLink) return <PayLinkScreen payLink={payLink} merchant={merchant} slug={slug} />;
  }

  // No extension → install screen
  if (!extensionDetected) return (
    <main style={s.page}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 24px' }} />
        <h2 style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, margin: '0 0 10px' }}>Install HexaBee to pay</h2>
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, margin: '0 0 20px' }}>
          To pay this invoice from <strong>{merchant.business_name}</strong>, install the free HexaBee Chrome extension.
        </p>
        <div style={s.info}>
          <Row label="Payee" value={merchant.business_name} />
          {merchant.sort_code ? (
            <>
              <Row label="Sort Code" value={merchant.sort_code} mono />
              <Row label="Account Number" value={merchant.account_number ?? ''} mono />
            </>
          ) : (
            <Row label="IBAN" value={merchant.iban ?? ''} mono />
          )}
        </div>
        <a
          href="https://chromewebstore.google.com/detail/hexabee/phlljefgiaedlndgcmkgnaaagpdahmpb"
          target="_blank"
          rel="noreferrer"
          style={s.installBtn}
        >
          Install HexaBee for Chrome
        </a>
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Already installed? Refresh this page.</p>
        <button
          type="button"
          onClick={() => setExtensionDetected(true)}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', marginTop: 8, textDecoration: 'underline', display: 'block', margin: '8px auto 0' }}
        >
          Pay without extension
        </button>
      </div>
    </main>
  );

  const enabledMethods = merchant.enabled_methods ?? ['cards', 'apple_pay', 'google_pay', 'revolut_pay', 'bacs', 'bank_transfer', 'klarna', 'afterpay'];
  const showBank = enabledMethods.some(m => ['pay_by_bank', 'sepa', 'bacs', 'bank_transfer', 'ideal', 'bancontact', 'blik', 'eps', 'przelewy24'].includes(m));

  const allMethods = methodsForCurrency(currency);
  const visibleMethods = allMethods.filter(m =>
    enabledMethods.some(e =>
      e === m.id ||
      (m.id === 'card' && e === 'cards') ||
      (m.id === 'card' && e === 'cartes_bancaires')
    )
  );

  // Extension detected + payload → full payment screen
  if (extensionDetected && payload) return (
    <>
      <main style={{ ...s.page, minHeight: '100vh', height: 'auto' }}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
          <p style={s.subtitle}>Invoice payment</p>
          {parsedAmount ? (
            <div style={s.amountBlock}>{formattedAmount}</div>
          ) : (
            <div style={{ margin: '16px 0 20px' }}>
              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Amount not detected — enter manually</p>
              <input
                style={s.amountInput}
                type="number"
                placeholder="0.00"
                min="0"
                step="0.01"
                value={manualAmount}
                onChange={e => setManualAmount(e.target.value)}
              />
            </div>
          )}
          <div style={s.details}>
            <Row label="Payee" value={merchant.business_name} />
            {reference ? (
              <Row label="Reference" value={reference} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--muted)', fontSize: 14 }}>Reference (optional)</span>
                <input
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--surface)', color: 'var(--text)' }}
                  type="text"
                  placeholder="e.g. INV-2024-001"
                  value={manualReference}
                  onChange={e => setManualReference(e.target.value)}
                />
              </div>
            )}
            {merchant.sort_code ? (
              <>
                <Row label="Sort Code" value={merchant.sort_code} mono />
                <Row label="Account Number" value={merchant.account_number ?? ''} mono />
              </>
            ) : (
              <Row label="IBAN" value={iban ?? ''} mono />
            )}
          </div>
          {error && <p style={s.errorText}>{error}</p>}
          <p style={s.howToPay}>How would you like to pay?</p>
          <div style={s.methodList}>
            {visibleMethods.map(method => (
              <div key={method.id} style={s.methodCard}>
                <div style={s.methodInfo}>
                  <span style={s.methodName}>{method.name}</span>
                  <span style={s.methodDesc}>{method.description}</span>
                </div>
                {method.type === 'stripe' || method.type === 'stripe_bank' ? (
                  <button
                    style={{ ...s.payBtn, opacity: (!!loading || !effectiveAmount) ? 0.6 : 1, cursor: (!!loading || !effectiveAmount) ? 'not-allowed' : 'pointer' }}
                    onClick={() => handleStripe(method.id)}
                    disabled={!!loading || !effectiveAmount}
                  >
                    {loading === method.id ? 'Redirecting...' : 'Pay'}
                  </button>
                ) : (
                  <span style={s.soonBadge}>Soon</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
      {showBank && showBankPicker && (
        <div style={s.overlay} onClick={() => setShowBankPicker(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Select your bank</span>
              <button style={s.closeBtn} onClick={() => setShowBankPicker(false)}>✕</button>
            </div>
            <input style={s.searchInput} placeholder="Search banks..." value={bankSearch} onChange={e => setBankSearch(e.target.value)} autoFocus />
            <div style={s.institutionList}>
              {institutionsLoading && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>Loading banks...</p>}
              {!institutionsLoading && filteredInstitutions.length === 0 && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>No banks found</p>}
              {filteredInstitutions.map(inst => (
                <button key={inst.id} style={s.institutionBtn} onClick={() => handleBankSelect(inst.id)}>
                  {inst.logo ? <img src={inst.logo} alt="" style={s.institutionLogo} /> : <div style={s.institutionLogoPlaceholder}>🏦</div>}
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{inst.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{inst.countries.slice(0, 3).join(', ')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Extension detected but no payload — manual entry screen
  return (
    <>
      <main style={{ ...s.page, minHeight: '100vh', height: 'auto' }}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
          <p style={s.subtitle}>Invoice payment</p>
          <div style={{ margin: '16px 0 20px' }}>
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Enter amount manually</p>
            <input
              style={s.amountInput}
              type="number"
              placeholder="0.00"
              min="0"
              step="0.01"
              value={manualAmount}
              onChange={e => setManualAmount(e.target.value)}
            />
          </div>
          <div style={s.details}>
            <Row label="Payee" value={merchant.business_name} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>Reference (optional)</span>
              <input
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--surface)', color: 'var(--text)' }}
                type="text"
                placeholder="e.g. INV-2024-001"
                value={manualReference}
                onChange={e => setManualReference(e.target.value)}
              />
            </div>
            {merchant.sort_code ? (
              <>
                <Row label="Sort Code" value={merchant.sort_code} mono />
                <Row label="Account Number" value={merchant.account_number ?? ''} mono />
              </>
            ) : (
              <Row label="IBAN" value={merchant.iban ?? ''} mono />
            )}
          </div>
          {error && <p style={s.errorText}>{error}</p>}
          <p style={s.howToPay}>How would you like to pay?</p>
          <div style={s.methodList}>
            {visibleMethods.map(method => (
              <div key={method.id} style={s.methodCard}>
                <div style={s.methodInfo}>
                  <span style={s.methodName}>{method.name}</span>
                  <span style={s.methodDesc}>{method.description}</span>
                </div>
                {method.type === 'stripe' || method.type === 'stripe_bank' ? (
                  <button
                    style={{ ...s.payBtn, opacity: (!!loading || !effectiveAmount) ? 0.6 : 1, cursor: (!!loading || !effectiveAmount) ? 'not-allowed' : 'pointer' }}
                    onClick={() => handleStripe(method.id)}
                    disabled={!!loading || !effectiveAmount}
                  >
                    {loading === method.id ? 'Redirecting...' : 'Pay'}
                  </button>
                ) : (
                  <span style={s.soonBadge}>Soon</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, gap: 16 }}>
      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 16px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 32px', maxWidth: 460, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  subtitle: { color: 'var(--muted)', fontSize: 14, margin: '0 0 4px', textAlign: 'center' },
  amountBlock: { fontSize: 42, fontWeight: 800, letterSpacing: '-0.03em', margin: '16px 0 20px', color: 'var(--text)', textAlign: 'center' },
  details: { display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)', borderRadius: 12, padding: '16px 18px', marginBottom: 24 },
  info: { background: 'var(--bg)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 },
  installBtn: { display: 'block', textAlign: 'center', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 15, padding: '14px', borderRadius: 12, textDecoration: 'none' },
  errorText: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  amountInput: { width: '100%', textAlign: 'center', fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', padding: '12px 16px', borderRadius: 12, border: '2px solid var(--border)', outline: 'none', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px 16px' },
  modal: { background: 'var(--surface)', borderRadius: 20, width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 20px 12px', borderBottom: '1px solid var(--border)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--muted)', padding: 4 },
  searchInput: { margin: '12px 16px', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--bg)' },
  institutionList: { overflowY: 'auto', flex: 1, padding: '4px 8px 16px' },
  institutionBtn: { position: 'relative', display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' },
  institutionLogo: { width: 36, height: 36, borderRadius: 8, objectFit: 'contain', flexShrink: 0, border: '1px solid var(--border)' },
  institutionLogoPlaceholder: { width: 36, height: 36, borderRadius: 8, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 },
  howToPay: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  methodList: { display: 'flex', flexDirection: 'column', gap: 8 },
  methodCard: { display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' },
  methodInfo: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 },
  methodName: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  methodDesc: { fontSize: 11, color: 'var(--muted)' },
  feeBadge: { fontSize: 10, fontWeight: 600, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 5, padding: '2px 6px', flexShrink: 0 },
  payBtn: { padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 13, flexShrink: 0 },
  soonBadge: { fontSize: 10, fontWeight: 600, background: '#f5f5f5', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px', flexShrink: 0 },
};

export default function PaySlugPage() {
  return (
    <Suspense fallback={<main style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</main>}>
      <PaySlugContent />
    </Suspense>
  );
}
