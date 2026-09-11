'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PayLangProvider, usePayLang, PayLangToggle } from '../i18n';
import {
  MONTONIO_METHODS,
  MONTONIO_PREFERRED,
  MONTONIO_METHOD_MAP,
  montonioVisible,
  montonioFee,
  grossUpMinor,
  grossUpAmountStr,
  visibleMethods as visibleMethodsFor,
} from '../methods';

type Merchant = { business_name: string; iban?: string | null; sort_code?: string | null; account_number?: string | null; slug: string; enabled_methods?: string[] | null; currency?: string | null; fee_mode?: string | null; payment_rail?: string | null; accepting_payments?: boolean };
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
  fee_mode?: string | null;      // 'merchant' | 'payer' | null on older links
};

const EUR = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });

// Deliberately wider than the currencies a merchant can choose: this only decides
// how a number is drawn, and the resolved currency can come from a payer's own
// PDF. An unknown code falls back to the code itself, which is still readable.
const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', EUR: '€', USD: '$', PLN: 'zł', SEK: 'kr', DKK: 'kr', NOK: 'kr', CHF: 'CHF',
};

/**
 * One place that knows which rail a payment goes down.
 *
 * Without this the pay page would always call Stripe, and a merchant switched to
 * Montonio in the admin would keep settling into the wrong account with nothing
 * on screen to suggest it.
 */
async function createPaymentSession(opts: {
  rail?: string | null;
  slug: string;
  methodId: string;
  amount: string;
  currency: string;
  reference: string | null;
  email: string;
  paymentLinkShortId?: string | null;
  adminInvoiceId?: string | null;
}) {
  if (opts.rail === 'montonio') {
    return fetch('/api/payment/montonio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantSlug: opts.slug,
        amount: opts.amount,
        currency: 'EUR',
        reference: opts.reference,
        method: MONTONIO_METHOD_MAP[opts.methodId] ?? 'paymentInitiation',
        preferred_method: MONTONIO_PREFERRED[opts.methodId],
        preferred_country: 'LT',
        locale: typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'lt',
        // Not a hint the browser is trusted on: the route re-reads the link to
        // decide who covers the flat fee, and this only names which link.
        ...(opts.paymentLinkShortId ? { payment_link_short_id: opts.paymentLinkShortId } : {}),
      }),
    });
  }

  return fetch('/api/payment/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: opts.amount,
      currency: opts.currency,
      reference: opts.reference,
      email: opts.email,
      admin_invoice_id: opts.adminInvoiceId ?? null,
      merchantSlug: opts.slug,
      payment_method_type: opts.methodId,
      ...(opts.paymentLinkShortId ? { payment_link_short_id: opts.paymentLinkShortId } : {}),
    }),
  });
}

function hasExtension(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as Record<string, unknown>)['__hexabee_extension'];
}

// ── POS / QR mode screen ──────────────────────────────────────────────────────
function PosScreen({ merchant, slug }: { merchant: Merchant; slug: string }) {
  const { t } = usePayLang();
  // Derive currency from merchant data — DB value takes precedence
  const currency = merchant.currency ?? (merchant.sort_code ? 'GBP' : 'EUR');
  const currencySymbol = CURRENCY_SYMBOLS[currency] ?? currency;

  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payerCoversFee = merchant.fee_mode === 'payer';
  const isMontonio = merchant.payment_rail === 'montonio';
  // Which buttons the till shows. On Stripe one button is right: Stripe's own
  // checkout offers every enabled method behind it. On Montonio the method is
  // chosen *before* redirecting, so a single hard-wired card button sent a
  // bank-only merchant's customers to a card form they had switched off.
  const posMethods = isMontonio
    ? montonioVisible(MONTONIO_METHODS, merchant.enabled_methods ?? [])
    : null;
  const posFlatFee = montonioFee(merchant.payment_rail, merchant.fee_mode);
  const netMinorEntered = Math.round(Number(amount.trim().replace(',', '.')) * 100);
  // The Baltic rail adds a flat fee, not a percentage — grossing up at the card
  // tier here quoted the till a total the payment would never charge.
  const posGrossMinor = Number.isFinite(netMinorEntered) && netMinorEntered > 0
    ? (isMontonio
        ? (posFlatFee > 0 ? netMinorEntered + Math.round(posFlatFee * 100) : null)
        : (payerCoversFee ? grossUpMinor(netMinorEntered, currency, 'card') : null))
    : null;

  async function handlePay(methodId: string) {
    const amt = amount.trim().replace(',', '.');
    if (!amt || Number(amt) <= 0) { setError(t.pos.invalidAmount); return; }
    setError(null);
    setLoading(methodId);
    try {
      const res = await createPaymentSession({
        rail: merchant.payment_rail,
        slug,
        methodId,
        // On the Montonio rail the flat fee is added server-side, so the amount
        // sent is always the plain invoice amount — grossing up here too would
        // charge it twice.
        amount: payerCoversFee && merchant.payment_rail !== 'montonio'
          ? grossUpAmountStr(amt, currency, 'card')
          : amt,
        currency,
        reference: reference.trim() || null,
        email: 'pos@hexabee.com',
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) { setError(data.error || t.sessionError); return; }
      window.location.href = data.payment_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t.networkError);
    } finally {
      setLoading(null);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 16px' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 32px', maxWidth: 420, width: '100%', boxSizing: 'border-box', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
        <PayLangToggle />
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
        <h2 style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>{merchant.business_name}</h2>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', margin: '0 0 24px' }}>{t.pos.title}</p>

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
            {t.pos.customerPays(`${currencySymbol}${(posGrossMinor / 100).toFixed(2)}`)}
          </p>
        )}

        {/* Reference */}
        <input
          style={{ width: '100%', padding: '11px 14px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)', marginBottom: 20, boxSizing: 'border-box' }}
          type="text"
          placeholder={t.pos.referencePlaceholder}
          value={reference}
          onChange={e => setReference(e.target.value)}
        />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>}

        {posMethods ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {posMethods.map(method => (
              <button
                key={method.id}
                style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: loading ? 'var(--border)' : 'var(--brand)', color: '#111', fontWeight: 800, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer' }}
                onClick={() => handlePay(method.id)}
                disabled={!!loading}
              >
                {loading === method.id ? t.redirecting : `${method.icon}  ${t.methodNames[method.id] ?? method.name}`}
              </button>
            ))}
          </div>
        ) : (
          <button
            style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: loading ? 'var(--border)' : 'var(--brand)', color: '#111', fontWeight: 800, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer' }}
            onClick={() => handlePay('card')}
            disabled={!!loading}
          >
            {loading ? t.redirecting : t.pos.payButton}
          </button>
        )}
      </div>
    </main>
  );
}

// ── Payment Link checkout screen ──────────────────────────────────────────────
function PayLinkScreen({ payLink, merchant, slug }: { payLink: PayLinkData; merchant: Merchant; slug: string }) {
  const { t } = usePayLang();
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

  // The link's own choice, made at creation, ahead of the merchant default —
  // and zero on the Stripe rail, which has no flat fee.
  const flatFee = montonioFee(merchant.payment_rail, payLink.fee_mode, merchant.fee_mode);

  const visibleMethods = visibleMethodsFor(merchant.payment_rail, payLink.currency, merchant.enabled_methods);

  /**
   * A fixed-amount link already has the fee inside its amount, baked in when the
   * link was made. An open-amount link cannot: there was no number to gross up
   * yet. So the gross-up happens here, once the payer has typed one — and by then
   * the method is known too, which makes it more accurate than the standard tier
   * a fixed link has to assume.
   *
   * Not on the Montonio rail: there the fee is flat and added server-side, for
   * fixed and open amounts alike, so the plain amount always goes out.
   */
  function amountToCharge(methodId: string): string | null {
    if (!effectiveAmount) return null;
    if (merchant.payment_rail === 'montonio') return effectiveAmount;
    if (!isOpenAmount) return effectiveAmount;
    if (payLink.fee_mode !== 'payer') return effectiveAmount;
    return grossUpAmountStr(effectiveAmount, payLink.currency, methodId);
  }

  /** What the payer's total will be, once this rail's flat fee is added. */
  function totalWithFlatFee(): string {
    return EUR.format(Number(effectiveAmount) + flatFee);
  }

  async function handlePay(methodId: string) {
    if (!effectiveAmount) return;
    setError(null);
    setLoading(methodId);
    try {
      const res = await createPaymentSession({
        rail: merchant.payment_rail,
        slug,
        methodId,
        amount: amountToCharge(methodId) ?? effectiveAmount,
        currency: payLink.currency,
        reference: effectiveReference,
        email: 'payer@hexabee.com',
        paymentLinkShortId: payLink.short_id,  // for webhook → increment
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) { setError(data.error || t.sessionError); return; }
      window.location.href = data.payment_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t.networkError);
    } finally {
      setLoading(null);
    }
  }

  return (
    <main style={{ ...s.page, minHeight: '100vh', height: 'auto' }}>
      <div style={s.card}>
        <PayLangToggle />
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
        <p style={s.subtitle}>{t.checkout.payment}</p>

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
          <Row label={t.checkout.payTo} value={payLink.merchant_name} />
          {payLink.reference ? (
            // Link has a pre-set reference — show read-only
            <Row label={t.checkout.reference} value={payLink.reference} />
          ) : (
            // Link has no reference — payer may optionally enter one
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>{t.checkout.reference} <span style={{ fontSize: 12 }}>{t.checkout.optional}</span></span>
              <input
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--surface)', color: 'var(--text)' }}
                type="text"
                placeholder={t.checkout.linkReferencePlaceholder}
                value={manualReference}
                onChange={e => setManualReference(e.target.value)}
              />
            </div>
          )}
        </div>

        {error && <p style={s.errorText}>{error}</p>}
        <p style={s.howToPay}>{t.checkout.howToPay}</p>
        {(flatFee > 0 || (isOpenAmount && payLink.fee_mode === 'payer')) && effectiveAmount && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', margin: '-4px 0 10px' }}>
            {t.checkout.feeIncluded}
          </p>
        )}
        <div style={s.methodList}>
          {visibleMethods.map(method => (
            <div key={method.id} style={s.methodCard}>
              <div style={s.methodInfo}>
                <span style={s.methodName}>{t.methodNames[method.id] ?? method.name}</span>
                <span style={s.methodDesc}>{t.methodDescs[method.id] ?? method.description}</span>
              </div>
              {method.type === 'stripe' || method.type === 'stripe_bank' || method.type === 'montonio' ? (
                <button
                  style={{ ...s.payBtn, opacity: (!!loading || !effectiveAmount) ? 0.6 : 1, cursor: (!!loading || !effectiveAmount) ? 'not-allowed' : 'pointer' }}
                  onClick={() => handlePay(method.id)}
                  disabled={!!loading || !effectiveAmount}
                >
                  {loading === method.id
                    ? t.redirecting
                    : (() => {
                        // Show the real total whenever it differs from what the
                        // payer typed. Charging more than the number on screen,
                        // without saying so, is the one thing a checkout must
                        // never do.
                        if (flatFee > 0 && effectiveAmount) {
                          return t.checkout.payAmount(totalWithFlatFee());
                        }
                        const charge = amountToCharge(method.id);
                        if (charge && charge !== effectiveAmount) {
                          return t.checkout.payAmount(
                            new Intl.NumberFormat('en-GB', { style: 'currency', currency: payLink.currency })
                              .format(Number(charge))
                          );
                        }
                        return t.checkout.pay;
                      })()}
                </button>
              ) : (
                <span style={s.soonBadge}>{t.checkout.soon}</span>
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
  const { t } = usePayLang();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAmount, setManualAmount] = useState('');
  const [manualReference, setManualReference] = useState('');

  // BCC invoice-ledger lookup: note shown under the reference field
  const [invoiceNote, setInvoiceNote] = useState<{ kind: 'found' | 'paid'; number: string } | null>(null);
  // Currency of the BCC-ingested invoice matched by reference — lets one
  // merchant invoice in several currencies (e.g. GBP UK clients + EUR Baltic
  // clients) with the right methods and fees per invoice.
  const [ledgerCurrency, setLedgerCurrency] = useState<string | null>(null);

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
  // Per-invoice currency resolution: a payer-provided PDF wins, then the
  // BCC-ledger invoice matched by reference, then an explicit ?c= template
  // param, then the merchant's default. Single-currency merchants never hit
  // anything past the last step.
  const cParamRaw = searchParams.get('c');
  const cParam = cParamRaw && /^[A-Za-z]{3}$/.test(cParamRaw) ? cParamRaw.toUpperCase() : null;
  const pdfCurrency = (pdf?.currency && pdf.currency !== 'null') ? pdf.currency : null;
  const droppedCurrency = (dropped?.currency && dropped.currency !== 'null') ? dropped.currency : null;
  const currency = pdfCurrency ?? droppedCurrency ?? ledgerCurrency ?? cParam ?? merchant?.currency ?? 'EUR';
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
          else setPayLinkError(data.detail || t.checkout.linkFetchError);
        })
        .catch(() => setPayLinkError(t.checkout.linkFetchError))
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
  // Flat on the Baltic rail, and zero when the merchant absorbs it.
  const flatFee = montonioFee(merchant?.payment_rail, merchant?.fee_mode);

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
      if (data.currency && /^[A-Za-z]{3}$/.test(String(data.currency))) {
        setLedgerCurrency(String(data.currency).toUpperCase());
      }
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
      if (!data.success) { setDropError(data.error || t.checkout.dropReadError); return; }
      setDropped(data);
      if (data.amount && data.amount !== 'null' && Number(data.amount) > 0) {
        setManualAmount(String(data.amount));
      } else {
        setDropError(t.checkout.dropNoAmount);
      }
      const refFromPdf = (data.invoice_number && data.invoice_number !== 'null' && data.invoice_number !== '-') ? String(data.invoice_number) : null;
      if (refFromPdf) setManualReference(refFromPdf);
    } catch {
      setDropError(t.checkout.dropReadError);
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
      // On the Montonio rail the flat fee is added server-side, so the plain
      // invoice amount goes out — grossing up here as well would charge twice.
      const chargedAmount = payerCoversFee && merchant?.payment_rail !== 'montonio'
        ? grossUpAmountStr(effectiveAmount, currency, methodId)
        : effectiveAmount;
      const res = await createPaymentSession({
        rail: merchant?.payment_rail,
        slug,
        methodId,
        amount: chargedAmount,
        currency,
        reference: effectiveReference,
        email: payload?.email ?? 'demo@hexabee.com',
        adminInvoiceId: payload?.admin_invoice_id ?? null,
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) { setError(data.error || t.sessionError); return; }
      window.location.href = data.payment_url;
    } catch (err) { setError(err instanceof Error ? err.message : t.networkError); }
    finally { setLoading(null); }
  }

  if (notFound) return (
    <main style={s.page}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
        <p style={{ textAlign: 'center', color: 'var(--muted)' }}>{t.checkout.linkNotFound}</p>
      </div>
    </main>
  );

  if (!merchant) return <main style={s.page}><p style={{ color: 'var(--muted)' }}>{t.loading}</p></main>;

  // ── POS mode: clean in-person form, no extension logic ──
  if (isPosMode) return <PosScreen merchant={merchant} slug={slug} />;

  // ── Payment link mode (?pl=xxx) ──
  if (plShortId) {
    if (payLinkLoading) return <main style={s.page}><div style={s.card}><img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} /><p style={{ textAlign: 'center', color: 'var(--muted)' }}>{t.loading}</p></div></main>;
    if (payLinkError) return (
      <main style={s.page}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
          <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, margin: '0 0 8px' }}>{t.checkout.linkUnavailable}</p>
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>{payLinkError}</p>
        </div>
      </main>
    );
    if (payLink) return <PayLinkScreen payLink={payLink} merchant={merchant} slug={slug} />;
  }

  const visibleMethods = visibleMethodsFor(merchant.payment_rail, currency, merchant.enabled_methods);

  // Part-way through onboarding: no rail works yet. Rendering pay buttons here
  // would hand the payer a failure that is not theirs to understand.
  const notAcceptingYet = merchant.accepting_payments === false;

  // Extension payload → full payment screen
  if (payload) return (
    <>
      <main style={{ ...s.page, minHeight: '100vh', height: 'auto' }}>
        <div style={s.card}>
          <PayLangToggle />
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
          <p style={s.subtitle}>{t.checkout.invoicePayment}</p>
          {parsedAmount ? (
            <div style={s.amountBlock}>{formattedAmount}</div>
          ) : (
            <div style={{ margin: '16px 0 20px' }}>
              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{t.checkout.amountNotDetected}</p>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 32, fontWeight: 800, color: 'var(--muted)', pointerEvents: 'none' }}>
                  {CURRENCY_SYMBOLS[currency] ?? currency}
                </span>
                <input
                  style={{ ...s.amountInput, textAlign: 'right', paddingLeft: 44 }}
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  value={manualAmount}
                  onChange={e => setManualAmount(e.target.value)}
                />
              </div>
            </div>
          )}
          <div style={s.details}>
            <Row label={t.checkout.payee} value={merchant.business_name} />
            {reference ? (
              <Row label={t.checkout.reference} value={reference} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--muted)', fontSize: 14 }}>{t.checkout.reference} {t.checkout.optional}</span>
                <input
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--surface)', color: 'var(--text)' }}
                  type="text"
                  placeholder={t.checkout.referencePlaceholder}
                  value={manualReference}
                  onChange={e => setManualReference(e.target.value)}
                />
              </div>
            )}
            {merchant.sort_code ? (
              <>
                <Row label={t.checkout.sortCode} value={merchant.sort_code} mono />
                <Row label={t.checkout.accountNumber} value={merchant.account_number ?? ''} mono />
              </>
            ) : (
              iban ? <Row label={t.checkout.iban} value={iban} mono /> : null
            )}
          </div>
          {ibanMismatch && (
            <p style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', margin: '10px 0 0' }}>
              {t.checkout.ibanMismatch(merchant.business_name)}
            </p>
          )}
          {error && <p style={s.errorText}>{error}</p>}
          <p style={s.howToPay}>{t.checkout.howToPay}</p>
          {notAcceptingYet && (
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', margin: '8px 0 14px' }}>
              {t.checkout.notAcceptingYet}
            </p>
          )}
          {!notAcceptingYet && (payerCoversFee || flatFee > 0) && effectiveAmount && (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', margin: '-4px 0 10px' }}>
              {t.checkout.feeIncluded}
            </p>
          )}
          <div style={s.methodList}>
            {(notAcceptingYet ? [] : visibleMethods).map(method => (
              <div key={method.id} style={s.methodCard}>
                <div style={s.methodInfo}>
                  <span style={s.methodName}>{t.methodNames[method.id] ?? method.name}</span>
                  <span style={s.methodDesc}>{t.methodDescs[method.id] ?? method.description}</span>
                </div>
                {method.type === 'stripe' || method.type === 'stripe_bank' || method.type === 'montonio' ? (
                  <button
                    style={{ ...s.payBtn, opacity: (!!loading || !effectiveAmount) ? 0.6 : 1, cursor: (!!loading || !effectiveAmount) ? 'not-allowed' : 'pointer' }}
                    onClick={() => handleStripe(method.id)}
                    disabled={!!loading || !effectiveAmount}
                  >
                    {loading === method.id
                      ? t.redirecting
                      : method.type === 'montonio' && effectiveAmount
                        ? (flatFee > 0
                            ? t.checkout.payAmount(EUR.format(Number(effectiveAmount) + flatFee))
                            : t.checkout.pay)
                        : payerCoversFee && effectiveAmount
                          ? t.checkout.payAmount(new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'EUR' }).format(Number(grossUpAmountStr(effectiveAmount, currency, method.id))))
                          : t.checkout.pay}
                  </button>
                ) : (
                  <span style={s.soonBadge}>{t.checkout.soon}</span>
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
          <PayLangToggle />
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
          <p style={s.subtitle}>{t.checkout.invoicePayment}</p>

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
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{t.checkout.dropReading}</p>
            ) : dropped ? (
              <p style={{ margin: 0, fontSize: 13, color: '#15803d', fontWeight: 600 }}>{t.checkout.dropDone}</p>
            ) : (
              <>
                <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 600 }}>{t.checkout.dropTitle}</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>{t.checkout.dropSub}</p>
              </>
            )}
          </div>
          {dropError && <p style={{ fontSize: 12, color: '#b45309', textAlign: 'center', margin: '0 0 10px' }}>{dropError}</p>}

          <div style={{ margin: '4px 0 20px' }}>
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{t.checkout.amount}</p>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 32, fontWeight: 800, color: 'var(--muted)', pointerEvents: 'none' }}>
                {CURRENCY_SYMBOLS[currency] ?? currency}
              </span>
              <input
                style={{ ...s.amountInput, textAlign: 'right', paddingLeft: 44 }}
                type="number"
                placeholder="0.00"
                min="0"
                step="0.01"
                value={manualAmount}
                onChange={e => setManualAmount(e.target.value)}
              />
            </div>
          </div>
          <div style={s.details}>
            <Row label={t.checkout.payee} value={merchant.business_name} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>{t.checkout.reference} {t.checkout.optional}</span>
              <input
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--surface)', color: 'var(--text)' }}
                type="text"
                placeholder={t.checkout.referencePlaceholder}
                value={manualReference}
                onChange={e => setManualReference(e.target.value)}
                onBlur={e => lookupInvoice(e.target.value)}
              />
              {invoiceNote && (
                <p style={{ fontSize: 12, margin: 0, color: invoiceNote.kind === 'found' ? '#15803d' : '#b45309' }}>
                  {invoiceNote.kind === 'found'
                    ? t.checkout.invoiceFound(invoiceNote.number)
                    : t.checkout.invoicePaid}
                </p>
              )}
            </div>
            {merchant.sort_code ? (
              <>
                <Row label={t.checkout.sortCode} value={merchant.sort_code} mono />
                <Row label={t.checkout.accountNumber} value={merchant.account_number ?? ''} mono />
              </>
            ) : (
              merchant.iban ? <Row label={t.checkout.iban} value={merchant.iban} mono /> : null
            )}
          </div>
          {ibanMismatch && (
            <p style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', margin: '10px 0 0' }}>
              {t.checkout.ibanMismatch(merchant.business_name)}
            </p>
          )}
          {error && <p style={s.errorText}>{error}</p>}
          <p style={s.howToPay}>{t.checkout.howToPay}</p>
          {notAcceptingYet && (
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', margin: '8px 0 14px' }}>
              {t.checkout.notAcceptingYet}
            </p>
          )}
          {!notAcceptingYet && (payerCoversFee || flatFee > 0) && effectiveAmount && (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', margin: '-4px 0 10px' }}>
              {t.checkout.feeIncluded}
            </p>
          )}
          <div style={s.methodList}>
            {(notAcceptingYet ? [] : visibleMethods).map(method => (
              <div key={method.id} style={s.methodCard}>
                <div style={s.methodInfo}>
                  <span style={s.methodName}>{t.methodNames[method.id] ?? method.name}</span>
                  <span style={s.methodDesc}>{t.methodDescs[method.id] ?? method.description}</span>
                </div>
                {method.type === 'stripe' || method.type === 'stripe_bank' || method.type === 'montonio' ? (
                  <button
                    style={{ ...s.payBtn, opacity: (!!loading || !effectiveAmount) ? 0.6 : 1, cursor: (!!loading || !effectiveAmount) ? 'not-allowed' : 'pointer' }}
                    onClick={() => handleStripe(method.id)}
                    disabled={!!loading || !effectiveAmount}
                  >
                    {loading === method.id
                      ? t.redirecting
                      : method.type === 'montonio' && effectiveAmount
                        ? (flatFee > 0
                            ? t.checkout.payAmount(EUR.format(Number(effectiveAmount) + flatFee))
                            : t.checkout.pay)
                        : payerCoversFee && effectiveAmount
                          ? t.checkout.payAmount(new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'EUR' }).format(Number(grossUpAmountStr(effectiveAmount, currency, method.id))))
                          : t.checkout.pay}
                  </button>
                ) : (
                  <span style={s.soonBadge}>{t.checkout.soon}</span>
                )}
              </div>
            ))}
          </div>

          {showExtHint && (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 14 }}>
              {t.checkout.extHintPrefix}{' '}
              <a
                href="https://chromewebstore.google.com/detail/hexabee/phlljefgiaedlndgcmkgnaaagpdahmpb"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--muted)', textDecoration: 'underline' }}
              >
                {t.checkout.extHintLink}
              </a>{' '}
              {t.checkout.extHintSuffix}
            </p>
          )}

          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
            {t.checkout.loopPrefix}{' '}
            <a
              href="https://hexabee.buzz/?utm_source=checkout&utm_medium=referral&utm_campaign=payer_loop"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--muted)', textDecoration: 'underline' }}
            >
              {t.checkout.loopLink}
            </a>
          </p>
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
      <PayLangProvider>
        <PaySlugContent />
      </PayLangProvider>
    </Suspense>
  );
}
