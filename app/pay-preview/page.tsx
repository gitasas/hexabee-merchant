'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { PayLangProvider, usePayLang, PayLangToggle } from '../pay/i18n';

type ParsedPdf = {
  success?: boolean;
  amount?: string | null;
  currency?: string | null;
  invoice_number?: string | null;
  payment_purpose?: string | null;
  payment_reference_template?: string | null;
  iban?: string | null;
  error?: string;
};

type ExtensionPayload = {
  source?: string;
  subject?: string;
  admin_invoice_id?: string;
  email?: string;
  parsedPdf?: ParsedPdf;
};

type MerchantInfo = {
  businessName: string | null;
  slug: string | null;
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
// iDEAL/bank transfer = 1% (min 50 minor units); BNPL (Klarna/Afterpay/Billie)
// = 6.9% + 30 minor units; everything else = 2% + 20 (GBP) / 2.9% + 25 (other).
const GBP_METHODS: PayMethod[] = [
  { id: 'pay_by_bank', name: 'Pay By Bank', icon: '🏦', description: 'Instant bank transfer', fee: '2% + £0.20', type: 'stripe_bank' },
  { id: 'bacs', name: 'Bacs Direct Debit', icon: '🔁', description: 'UK direct debit', fee: '2% + £0.20', type: 'stripe_bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + £0.20', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + £0.20', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + £0.20', type: 'stripe' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '6.9% + £0.30', type: 'stripe' },
  { id: 'afterpay', name: 'Afterpay / Clearpay', icon: '📦', description: 'Pay in 4 instalments', fee: '6.9% + £0.30', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '1% (min £0.50)', type: 'stripe_bank' },
];

const EUR_METHODS: PayMethod[] = [
  { id: 'sepa', name: 'SEPA Direct Debit', icon: '🔁', description: 'EU direct debit', fee: '2.9% + €0.25', type: 'stripe_bank' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '1% (min €0.50)', type: 'stripe_bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2.9% + €0.25', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2.9% + €0.25', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2.9% + €0.25', type: 'stripe' },
  { id: 'ideal', name: 'iDEAL', icon: '🇳🇱', description: 'Netherlands instant bank payment', fee: '1% (min €0.50)', type: 'stripe_bank' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '6.9% + €0.30', type: 'stripe' },
  { id: 'billie', name: 'Billie', icon: '🏢', description: 'B2B buy now pay later', fee: '6.9% + €0.30', type: 'stripe' },
];

const OTHER_METHODS: PayMethod[] = [
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2.9% + 0.25', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2.9% + 0.25', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2.9% + 0.25', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '1% (min 0.50)', type: 'stripe_bank' },
];

function methodsForCurrency(cur: string): PayMethod[] {
  const c = cur.toUpperCase();
  if (c === 'GBP') return GBP_METHODS;
  if (c === 'EUR') return EUR_METHODS;
  return OTHER_METHODS;
}

function PayPreviewContent() {
  const params = useSearchParams();
  const { t } = usePayLang();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [referenceInput, setReferenceInput] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [lookupDone, setLookupDone] = useState(false);
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [copied, setCopied] = useState(false);

  let parsed: ExtensionPayload | null = null;
  try {
    const raw = params.get('payload');
    parsed = raw ? JSON.parse(decodeURIComponent(raw)) : null;
  } catch { /* invalid payload */ }

  const pdf = parsed?.parsedPdf;
  const amount = (pdf?.amount && pdf.amount !== 'null') ? pdf.amount : null;
  const effectiveAmount = amount ?? (manualAmount.trim() ? manualAmount.trim().replace(',', '.') : null);
  const currency = (pdf?.currency && pdf.currency !== 'null') ? pdf.currency : 'EUR';
  const invoiceNumber = (pdf?.invoice_number && pdf.invoice_number !== 'null') ? pdf.invoice_number : null;
  const paymentPurpose = (pdf?.payment_purpose && pdf.payment_purpose !== 'null') ? pdf.payment_purpose : null;
  const referenceTemplate = (pdf?.payment_reference_template && pdf.payment_reference_template !== 'null') ? pdf.payment_reference_template : null;
  const iban = (pdf?.iban && pdf.iban !== 'null') ? pdf.iban : null;

  const effectiveReference = referenceTemplate
    ? referenceInput.trim() || null
    : (paymentPurpose ?? invoiceNumber);

  const formattedAmount = effectiveAmount
    ? new Intl.NumberFormat('en-EU', { style: 'currency', currency: currency || 'EUR' }).format(Number(effectiveAmount))
    : null;

  const canPay = !!effectiveAmount && (!referenceTemplate || !!referenceInput.trim());

  // IBAN lookup
  useEffect(() => {
    if (!iban) { setLookupDone(true); return; }
    fetch('/api/pay/preview-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban }),
    })
      .then(r => r.json())
      .then(data => { if (data.found) setMerchant(data.merchant); })
      .catch(() => {})
      .finally(() => setLookupDone(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStripe(methodId: string) {
    if (!canPay) return;
    setError(null);
    setLoadingId(methodId);
    try {
      const res = await fetch('/api/payment/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: effectiveAmount,
          currency,
          reference: effectiveReference,
          email: parsed?.email ?? 'demo@hexabee.com',
          admin_invoice_id: parsed?.admin_invoice_id ?? null,
          merchantSlug: merchant?.slug ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) {
        setError(data.error || t.sessionError);
        return;
      }
      window.location.href = data.payment_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t.networkError);
    } finally {
      setLoadingId(null);
    }
  }

  function copyPaymentDetails() {
    const recipientName = merchant?.businessName ?? paymentPurpose ?? '—';
    const bankLine = [`IBAN: ${iban ?? '—'}`];
    const text = [
      `${t.preview.copyPayTo}: ${recipientName}`,
      ...bankLine,
      `${t.preview.copyAmount}: ${effectiveAmount ?? '?'} ${currency}`,
      `${t.preview.copyReference}: ${effectiveReference ?? '—'}`,
    ].join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Invalid payload
  if (!parsed || !pdf?.success) {
    return (
      <main style={s.page}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--muted)', textAlign: 'center' }}>
            {pdf?.error ?? t.preview.noData}
          </p>
        </div>
      </main>
    );
  }

  // Loading lookup
  if (!lookupDone) {
    return (
      <main style={s.page}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--muted)', textAlign: 'center' }}>{t.loading}</p>
        </div>
      </main>
    );
  }

  // Shared invoice summary block
  const invoiceSummary = (
    <>
      {formattedAmount ? (
        <div style={s.amountBlock}>{formattedAmount}</div>
      ) : (
        <div style={{ margin: '16px 0' }}>
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
            {t.checkout.amountNotDetected}
          </p>
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
        {(merchant?.businessName ?? paymentPurpose) && (
          <Row label={t.checkout.payTo} value={merchant?.businessName ?? paymentPurpose!} />
        )}
        {invoiceNumber && <Row label={t.preview.invoiceNo} value={invoiceNumber} />}
        {paymentPurpose && !referenceTemplate && !merchant?.businessName && (
          <Row label={t.preview.purpose} value={paymentPurpose} />
        )}
        {iban && <Row label={t.checkout.iban} value={iban} mono />}
        {effectiveReference && <Row label={t.checkout.reference} value={effectiveReference} />}
      </div>

      {referenceTemplate && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            {t.preview.fillReference}
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontStyle: 'italic' }}>
            {t.preview.template} {referenceTemplate}
          </p>
          <input
            style={s.refInput}
            placeholder={referenceTemplate}
            value={referenceInput}
            onChange={e => setReferenceInput(e.target.value)}
          />
        </div>
      )}
    </>
  );

  // Mode 2: merchant NOT found — copy payment details
  if (!merchant) {
    return (
      <main style={s.page}>
        <div style={s.card}>
          <PayLangToggle />
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 4px' }} />
          <p style={s.subtitle}>{t.preview.payThisInvoice}</p>

          {invoiceSummary}

          <button style={s.copyDetailsBtn} onClick={copyPaymentDetails}>
            {copied ? t.preview.copiedDetails : t.preview.copyDetails}
          </button>

          <p style={s.notOnHexabee}>
            {t.preview.notOnHexabee}
          </p>
          <a href="https://merchant.hexabee.buzz/register" style={s.registerLink}>
            {t.preview.registerLink}
          </a>
        </div>
      </main>
    );
  }

  // Mode 1: merchant found — show payment methods
  const methods = methodsForCurrency(currency);

  return (
    <main style={s.page}>
      <div style={s.card}>
        <PayLangToggle />
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 4px' }} />
        <p style={s.subtitle}>{t.checkout.invoicePayment}</p>

        {invoiceSummary}

        {error && <p style={s.errorText}>{error}</p>}

        <p style={s.howToPay}>{t.checkout.howToPay}</p>

        <div style={s.methodList}>
          {methods.map(method => (
            <div key={method.id} style={s.methodCard}>
              <div style={s.methodInfo}>
                <span style={s.methodName}>{method.name}</span>
                <span style={s.methodDesc}>{t.methodDescs[method.id] ?? method.description}</span>
              </div>
              {method.type === 'stripe' || method.type === 'stripe_bank' ? (
                <button
                  style={{
                    ...s.payBtn,
                    opacity: (!canPay || !!loadingId) ? 0.6 : 1,
                    cursor: (!canPay || !!loadingId) ? 'not-allowed' : 'pointer',
                  }}
                  disabled={!canPay || !!loadingId}
                  onClick={() => handleStripe(method.id)}
                >
                  {loadingId === method.id ? '...' : t.checkout.pay}
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, fontSize: 14 }}>
      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right', wordBreak: 'break-all', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 16px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '32px 28px', maxWidth: 460, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  subtitle: { color: 'var(--muted)', fontSize: 14, margin: '4px 0 0', textAlign: 'center' },
  amountBlock: { fontSize: 42, fontWeight: 800, letterSpacing: '-0.03em', margin: '20px 0 20px', color: 'var(--text)', textAlign: 'center' },
  amountInput: { width: '100%', textAlign: 'center', fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', padding: '10px 14px', borderRadius: 12, border: '2px solid var(--border)', outline: 'none', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' },
  details: { display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg)', borderRadius: 12, padding: '14px 16px', marginBottom: 20 },
  refInput: { width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--bg)', boxSizing: 'border-box' },
  errorText: { color: '#dc2626', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  howToPay: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  methodList: { display: 'flex', flexDirection: 'column', gap: 8 },
  methodCard: { display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' },
  methodInfo: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 },
  methodName: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  methodDesc: { fontSize: 11, color: 'var(--muted)' },
  feeBadge: { fontSize: 10, fontWeight: 600, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 5, padding: '2px 6px', flexShrink: 0 },
  payBtn: { padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 13, flexShrink: 0 },
  soonBadge: { fontSize: 10, fontWeight: 600, background: '#f5f5f5', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px', flexShrink: 0 },
  copyDetailsBtn: { width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 16 },
  notOnHexabee: { fontSize: 13, color: 'var(--muted)', textAlign: 'center', margin: '0 0 10px' },
  registerLink: { display: 'block', textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--brand)', textDecoration: 'none' },
};

export default function PayPreview() {
  return (
    <Suspense fallback={
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </main>
    }>
      <PayLangProvider>
        <PayPreviewContent />
      </PayLangProvider>
    </Suspense>
  );
}
