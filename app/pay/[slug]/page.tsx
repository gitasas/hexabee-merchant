'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

type Merchant = { business_name: string; iban?: string | null; sort_code?: string | null; account_number?: string | null; slug: string; enabled_methods?: string[] | null; currency?: string | null; fee_mode?: string | null };
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
};

type PayMethod = {
  id: string;
  name: string;
  icon: string;
  description: string;
  fee: string;
  type: 'stripe' | 'stripe_bank' | 'bank_soon';
};

// Displayed fees mirror calculateHexabeeFee in the payments backend (index.js):
// 2% + 20 minor units (GBP) / 25 minor units (other currencies); iDEAL and
// bank transfer are a flat 50 minor units.
const GBP_METHODS: PayMethod[] = [
  { id: 'pay_by_bank', name: 'Pay By Bank', icon: '🏦', description: 'Instant bank transfer', fee: '2% + £0.20', type: 'stripe_bank' },
  { id: 'bacs', name: 'Bacs Direct Debit', icon: '🔁', description: 'UK direct debit', fee: '2% + £0.20', type: 'stripe_bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + £0.20', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + £0.20', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + £0.20', type: 'stripe' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '2% + £0.20', type: 'stripe' },
  { id: 'afterpay', name: 'Afterpay / Clearpay', icon: '📦', description: 'Pay in 4 instalments', fee: '2% + £0.20', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '£0.50 flat', type: 'stripe_bank' },
];

const EUR_METHODS: PayMethod[] = [
  { id: 'sepa', name: 'SEPA Direct Debit', icon: '🔁', description: 'EU direct debit', fee: '2% + €0.25', type: 'stripe_bank' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '€0.50 flat', type: 'stripe_bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + €0.25', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + €0.25', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + €0.25', type: 'stripe' },
  { id: 'ideal', name: 'iDEAL', icon: '🇳🇱', description: 'Netherlands instant bank payment', fee: '€0.50 flat', type: 'stripe_bank' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '2% + €0.25', type: 'stripe' },
  { id: 'billie', name: 'Billie', icon: '🏢', description: 'B2B buy now pay later', fee: '2% + €0.25', type: 'stripe' },
];

const OTHER_METHODS: PayMethod[] = [
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + 0.25', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + 0.25', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + 0.25', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '0.50 flat', type: 'stripe_bank' },
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

// ── Fee gross-up (payer covers the HexaBee fee) ───────────────────────────────
// Mirrors the backend's calculateHexabeeFee: ideal/bank_transfer = flat 50 minor
// units, everything else = 2% + fixed (20 GBP / 25 other).
const FEE_PCT = 0.02;
const FEE_FIXED_MINOR: Record<string, number> = { GBP: 20, EUR: 25 };
const FLAT_FEE_METHODS = new Set(['ideal', 'bank_transfer']);

function grossUpMinor(netMinor: number, currency: string, methodId: string): number {
  if (FLAT_FEE_METHODS.has(methodId)) return netMinor + 50;
  const fixed = FEE_FIXED_MINOR[currency.toUpperCase()] ?? 25;
  return Math.ceil((netMinor + fixed) / (1 - FEE_PCT));
}

function grossUpAmountStr(amountStr: string, currency: string, methodId: string): string {
  const netMinor = Math.round(Number(amountStr) * 100);
  return (grossUpMinor(netMinor, currency, methodId) / 100).toFixed(2);
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

  const payerCoversFee = merchant.fee_mode === 'payer';
  const netMinorEntered = Math.round(Number(amount.trim().replace(',', '.')) * 100);
  const posGrossMinor = payerCoversFee && Number.isFinite(netMinorEntered) && netMinorEntered > 0
    ? grossUpMinor(netMinorEntered, currency, 'card')
    : null;

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
          amount: payerCoversFee ? grossUpAmountStr(amt, currency, 'card') : amt,
          currency,
          reference: reference.trim() || null,
          email: 'pos@hexabee.com',
          admin_invoice_id: null,
          merchantSlug: slug,
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

        {posGrossMinor !== null && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
            Customer pays {currencySymbol}{(posGrossMinor / 100).toFixed(2)} (incl. processing fee)
          </p>
        )}

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
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAmount, setManualAmount] = useState('');
  const [manualReference, setManualReference] = useState('');

  // BCC invoice-ledger lookup: note shown under the reference field
  const [invoiceNote, setInvoiceNote] = useState<{ kind: 'found' | 'paid'; number: string } | null>(null);

  // Invoice PDF dropped/uploaded by the payer (no-extension flow)
  const [dropped, setDropped] = useState<ParsedPdf | null>(null);
  const [dropParsing, setDropParsing] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dropInputRef = useRef<HTMLInputElement>(null);
  const [showExtHint, setShowExtHint] = useState(false);

  // Ref mirror of `dropped` so async lookup callbacks see the current value —
  // an amount that came from a dropped PDF must never be overridden.
  const droppedStateRef = useRef<ParsedPdf | null>(null);
  useEffect(() => { droppedStateRef.current = dropped; }, [dropped]);

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
  const currency = (pdf?.currency && pdf.currency !== 'null')
    ? pdf.currency
    : (dropped?.currency && dropped.currency !== 'null')
      ? dropped.currency
      : (merchant?.currency ?? 'EUR');
  const reference = (pdf?.reference && pdf.reference !== 'null' && pdf.reference !== '-') ? pdf.reference : (pdf?.invoice_number && pdf.invoice_number !== 'null' && pdf.invoice_number !== '-' ? pdf.invoice_number : null);
  const invoiceIban =
    ((pdf?.iban && pdf.iban !== 'null') ? pdf.iban : null) ??
    ((dropped?.iban && dropped.iban !== 'null') ? dropped.iban : null);
  const iban = invoiceIban ?? (merchant?.iban ?? null);
  // Fraud/typo guard: the invoice shows a different account than the one the
  // merchant registered with HexaBee.
  const ibanMismatch = !!(
    invoiceIban && merchant?.iban &&
    invoiceIban.replace(/\s/g, '').toUpperCase() !== merchant.iban.replace(/\s/g, '').toUpperCase()
  );

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
      return;
    }

    // Prefill from mail-merge URL params: ?a=<amount>&r=<reference>
    // (accounting software substitutes these per recipient at send time)
    const a = searchParams.get('a');
    const r = searchParams.get('r');
    if (a) {
      const n = Number(String(a).replace(',', '.'));
      if (Number.isFinite(n) && n > 0 && n <= 100000) setManualAmount(n.toFixed(2));
    }
    if (r) {
      const prefill = String(r).trim().slice(0, 100);
      setManualReference(prefill);
      lookupInvoice(prefill);
    }

    // Extension is an accelerator, not a gate — only used to hide the hint.
    setTimeout(() => setShowExtHint(!hasExtension()), 600);
  }, [slug, isPosMode, plShortId]); // eslint-disable-line react-hooks/exhaustive-deps

  const payerCoversFee = merchant?.fee_mode === 'payer';

  // Look up a BCC-ingested invoice by reference. Fills the amount when the
  // invoice is unpaid; warns when it's already paid. Silent when not found
  // (most merchants don't use the BCC inbox) or on any error.
  async function lookupInvoice(ref: string) {
    const trimmed = ref.trim();
    if (!trimmed) return;
    setInvoiceNote(null);
    try {
      const res = await fetch(`/api/pay/${slug}/invoice-lookup?ref=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.found) return;
      const invNumber = String(data.invoice_number ?? trimmed);
      if (data.status === 'issued') {
        // Dropped-PDF amount wins — only fill when no PDF was dropped
        const amountNum = Number(data.amount);
        if (!droppedStateRef.current && Number.isFinite(amountNum) && amountNum > 0) {
          setManualAmount(amountNum.toFixed(2));
        }
        setInvoiceNote({ kind: 'found', number: invNumber });
      } else if (data.status === 'paid') {
        setInvoiceNote({ kind: 'paid', number: invNumber });
      }
    } catch { /* silent — lookup is best-effort */ }
  }

  async function handleInvoiceFile(file: File) {
    if (!file || dropParsing) return;
    setDropError(null);
    setDropParsing(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('merchantSlug', slug);
      const res = await fetch('/api/invoice/parse', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) { setDropError(data.error || 'Could not read the invoice — please enter details below.'); return; }
      setDropped(data);
      if (data.amount && data.amount !== 'null' && Number(data.amount) > 0) {
        setManualAmount(String(data.amount));
      } else {
        setDropError('Amount not found in the invoice — please enter it below.');
      }
      const refFromPdf = (data.invoice_number && data.invoice_number !== 'null' && data.invoice_number !== '-') ? String(data.invoice_number) : null;
      if (refFromPdf) setManualReference(refFromPdf);
    } catch {
      setDropError('Could not read the invoice — please enter details below.');
    } finally {
      setDropParsing(false);
    }
  }

  async function handleStripe(methodId: string) {
    // Merchant IBAN is display-only (manual transfer info) — card/Stripe
    // payments resolve the Connect account server-side and must not require it.
    if (!effectiveAmount) return;
    setError(null); setLoading(methodId);
    try {
      const chargedAmount = payerCoversFee
        ? grossUpAmountStr(effectiveAmount, currency, methodId)
        : effectiveAmount;
      const res = await fetch('/api/payment/stripe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: chargedAmount, currency, reference: effectiveReference, email: payload?.email ?? 'demo@hexabee.com', admin_invoice_id: payload?.admin_invoice_id ?? null, merchantSlug: slug, payment_method_type: methodId }),
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) { setError(data.error || 'Could not create payment session'); return; }
      window.location.href = data.payment_url;
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(null); }
  }

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

  const enabledMethods = merchant.enabled_methods ?? ['cards', 'apple_pay', 'google_pay', 'revolut_pay', 'bacs', 'bank_transfer', 'klarna', 'afterpay'];

  const allMethods = methodsForCurrency(currency);
  const visibleMethods = allMethods.filter(m =>
    enabledMethods.some(e =>
      e === m.id ||
      (m.id === 'card' && e === 'cards') ||
      (m.id === 'card' && e === 'cartes_bancaires')
    )
  );

  // Extension payload → full payment screen
  if (payload) return (
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
              iban ? <Row label="IBAN" value={iban} mono /> : null
            )}
          </div>
          {ibanMismatch && (
            <p style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', margin: '10px 0 0' }}>
              ⚠️ The IBAN on this invoice differs from {merchant.business_name}&apos;s registered account. Double-check before paying.
            </p>
          )}
          {error && <p style={s.errorText}>{error}</p>}
          <p style={s.howToPay}>How would you like to pay?</p>
          {payerCoversFee && effectiveAmount && (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', margin: '-4px 0 10px' }}>
              Totals include a small payment processing fee.
            </p>
          )}
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
                    {loading === method.id
                      ? 'Redirecting...'
                      : payerCoversFee && effectiveAmount
                        ? `Pay ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'EUR' }).format(Number(grossUpAmountStr(effectiveAmount, currency, method.id)))}`
                        : 'Pay'}
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

  // Default screen (no extension payload) — PDF drop + prefillable manual entry
  return (
    <>
      <main style={{ ...s.page, minHeight: '100vh', height: 'auto' }}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
          <p style={s.subtitle}>Invoice payment</p>

          {/* Invoice PDF drop zone — fills amount/reference via /api/invoice/parse */}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleInvoiceFile(f); }}
            onClick={() => dropInputRef.current?.click()}
            style={{ border: `2px dashed ${dropped ? '#86efac' : 'var(--border)'}`, borderRadius: 12, padding: '16px 14px', textAlign: 'center', cursor: 'pointer', margin: '14px 0 12px', background: dropped ? '#f0fdf4' : 'var(--bg)' }}
          >
            <input
              ref={dropInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleInvoiceFile(f); e.target.value = ''; }}
            />
            {dropParsing ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Reading invoice…</p>
            ) : dropped ? (
              <p style={{ margin: 0, fontSize: 13, color: '#15803d', fontWeight: 600 }}>✓ Invoice read — details filled in below</p>
            ) : (
              <>
                <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 600 }}>📄 Got the invoice? Drop the PDF here</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>or click to choose the file — amount and reference fill in automatically</p>
              </>
            )}
          </div>
          {dropError && <p style={{ fontSize: 12, color: '#b45309', textAlign: 'center', margin: '0 0 10px' }}>{dropError}</p>}

          <div style={{ margin: '4px 0 20px' }}>
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Amount</p>
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
                onBlur={e => lookupInvoice(e.target.value)}
              />
              {invoiceNote && (
                <p style={{ fontSize: 12, margin: 0, color: invoiceNote.kind === 'found' ? '#15803d' : '#b45309' }}>
                  {invoiceNote.kind === 'found'
                    ? `✓ Invoice ${invoiceNote.number} found — amount filled from the invoice`
                    : 'This invoice is already marked as paid — double-check before paying again.'}
                </p>
              )}
            </div>
            {merchant.sort_code ? (
              <>
                <Row label="Sort Code" value={merchant.sort_code} mono />
                <Row label="Account Number" value={merchant.account_number ?? ''} mono />
              </>
            ) : (
              merchant.iban ? <Row label="IBAN" value={merchant.iban} mono /> : null
            )}
          </div>
          {ibanMismatch && (
            <p style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', margin: '10px 0 0' }}>
              ⚠️ The IBAN on this invoice differs from {merchant.business_name}&apos;s registered account. Double-check before paying.
            </p>
          )}
          {error && <p style={s.errorText}>{error}</p>}
          <p style={s.howToPay}>How would you like to pay?</p>
          {payerCoversFee && effectiveAmount && (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', margin: '-4px 0 10px' }}>
              Totals include a small payment processing fee.
            </p>
          )}
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
                    {loading === method.id
                      ? 'Redirecting...'
                      : payerCoversFee && effectiveAmount
                        ? `Pay ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'EUR' }).format(Number(grossUpAmountStr(effectiveAmount, currency, method.id)))}`
                        : 'Pay'}
                  </button>
                ) : (
                  <span style={s.soonBadge}>Soon</span>
                )}
              </div>
            ))}
          </div>

          {showExtHint && (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 14 }}>
              💡 Pay invoices often?{' '}
              <a
                href="https://chromewebstore.google.com/detail/hexabee/phlljefgiaedlndgcmkgnaaagpdahmpb"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--muted)', textDecoration: 'underline' }}
              >
                Get the HexaBee extension
              </a>{' '}
              — invoices auto-fill right from Gmail.
            </p>
          )}
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
