'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

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

type PayMethod = {
  id: string;
  name: string;
  icon: string;
  description: string;
  fee: string;
  type: 'stripe' | 'bank';
};

const GBP_METHODS: PayMethod[] = [
  { id: 'pay_by_bank', name: 'Pay By Bank', icon: '🏦', description: 'Instant bank transfer', fee: '0.8%', type: 'bank' },
  { id: 'bacs', name: 'Bacs Direct Debit', icon: '🔁', description: 'UK direct debit, max £4 fee', fee: '0.8% max £4', type: 'bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + £0.20', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + £0.20', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + £0.20', type: 'stripe' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '2% + £0.20', type: 'stripe' },
  { id: 'afterpay', name: 'Afterpay / Clearpay', icon: '📦', description: 'Pay in 4 instalments', fee: '2% + £0.20', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '£1.50 flat', type: 'bank' },
];

const EUR_METHODS: PayMethod[] = [
  { id: 'sepa', name: 'SEPA Direct Debit', icon: '🔁', description: 'EU direct debit, max €5 fee', fee: '0.8% max €5', type: 'bank' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: '€1.50 flat', type: 'bank' },
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: '2% + €0.25', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: '2% + €0.25', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: '2% + €0.25', type: 'stripe' },
  { id: 'ideal', name: 'iDEAL', icon: '🇳🇱', description: 'Netherlands instant bank payment', fee: '€0.59 flat', type: 'bank' },
  { id: 'klarna', name: 'Klarna', icon: '🛍️', description: 'Pay in 3 interest-free instalments', fee: '2% + €0.25', type: 'stripe' },
  { id: 'billie', name: 'Billie', icon: '🏢', description: 'B2B buy now pay later', fee: '2% + €0.25', type: 'stripe' },
];

const OTHER_METHODS: PayMethod[] = [
  { id: 'card', name: 'Card', icon: '💳', description: 'Visa, Mastercard and more', fee: 'Standard rate', type: 'stripe' },
  { id: 'google_pay', name: 'Google Pay', icon: '🔵', description: 'One-tap on Android & Chrome', fee: 'Standard rate', type: 'stripe' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '🍎', description: 'One-tap on Apple devices', fee: 'Standard rate', type: 'stripe' },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', description: 'Manual bank transfer', fee: 'Flat fee', type: 'bank' },
];

function methodsForCurrency(cur: string): PayMethod[] {
  const c = cur.toUpperCase();
  if (c === 'GBP') return GBP_METHODS;
  if (c === 'EUR') return EUR_METHODS;
  return OTHER_METHODS;
}

function PayPreviewContent() {
  const params = useSearchParams();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [referenceInput, setReferenceInput] = useState('');
  const [manualAmount, setManualAmount] = useState('');

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

  const methods = methodsForCurrency(currency);
  const canPay = !!effectiveAmount && (!referenceTemplate || !!referenceInput.trim());

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
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) {
        setError(data.error || 'Could not create payment session');
        return;
      }
      window.location.href = data.payment_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoadingId(null);
    }
  }

  if (!parsed || !pdf?.success) {
    return (
      <main style={s.page}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--muted)', textAlign: 'center' }}>
            {pdf?.error ?? 'No invoice data found.'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={s.page}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 4px' }} />
        <p style={s.subtitle}>Invoice payment</p>

        {formattedAmount ? (
          <div style={s.amountBlock}>{formattedAmount}</div>
        ) : (
          <div style={{ margin: '16px 0' }}>
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              Amount not detected — enter manually
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
          {invoiceNumber && <Row label="Invoice #" value={invoiceNumber} />}
          {paymentPurpose && !referenceTemplate && <Row label="Purpose" value={paymentPurpose} />}
          {iban && <Row label="IBAN" value={iban} mono />}
        </div>

        {referenceTemplate && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              Fill in your payment reference:
            </p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontStyle: 'italic' }}>
              Template: {referenceTemplate}
            </p>
            <input
              style={s.refInput}
              placeholder={referenceTemplate}
              value={referenceInput}
              onChange={e => setReferenceInput(e.target.value)}
            />
          </div>
        )}

        {error && <p style={s.errorText}>{error}</p>}

        <p style={s.howToPay}>How would you like to pay?</p>

        <div style={s.methodList}>
          {methods.map(method => (
            <div key={method.id} style={s.methodCard}>
              <div style={s.methodIcon}>{method.icon}</div>
              <div style={s.methodInfo}>
                <span style={s.methodName}>{method.name}</span>
                <span style={s.methodDesc}>{method.description}</span>
              </div>
              <span style={s.feeBadge}>{method.fee}</span>
              {method.type === 'stripe' ? (
                <button
                  style={{
                    ...s.payBtn,
                    opacity: (!canPay || !!loadingId) ? 0.6 : 1,
                    cursor: (!canPay || !!loadingId) ? 'not-allowed' : 'pointer',
                  }}
                  disabled={!canPay || !!loadingId}
                  onClick={() => handleStripe(method.id)}
                >
                  {loadingId === method.id ? '...' : 'Pay'}
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
  methodIcon: { fontSize: 20, width: 32, textAlign: 'center', flexShrink: 0 },
  methodInfo: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 },
  methodName: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  methodDesc: { fontSize: 11, color: 'var(--muted)' },
  feeBadge: { fontSize: 10, fontWeight: 600, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 5, padding: '2px 6px', flexShrink: 0 },
  payBtn: { padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 13, flexShrink: 0 },
  soonBadge: { fontSize: 10, fontWeight: 600, background: '#f5f5f5', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px', flexShrink: 0 },
};

export default function PayPreview() {
  return (
    <Suspense fallback={
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </main>
    }>
      <PayPreviewContent />
    </Suspense>
  );
}
