'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Method = {
  id: string;
  name: string;
  group: string;
  description: string;
  countries: string[];
  fee: Record<string, string>;
};

const ALL_COUNTRIES = ['GB','DE','FR','BE','NL','AT','PL','LT','LV','EE','FI','SE','DK','NO','IE','PT','ES','IT','CZ','SK','HU','RO','BG','HR','SI','GR','CY','MT','LU'];
const EUR_SEPA = ['DE','FR','BE','NL','AT','PL','LT','LV','EE','FI','IE','PT','ES','IT','SK','HR','SI','GR','CY','MT','LU','RO'];
const KLARNA_COUNTRIES = ['GB','DE','FR','BE','NL','AT','LT','LV','EE','FI','IE','PT','ES','IT','SK','HR','SI','GR','CY','MT','LU','SE','DK','NO','CZ','PL'];

const ALL_METHODS: Method[] = [
  // Cards
  { id: 'cards', name: 'Cards', group: 'Cards', description: 'Visa, Mastercard and other major cards', countries: ALL_COUNTRIES, fee: { GBP: '0.5%', EUR: '0.5%', PLN: '0.5%' } },
  { id: 'cartes_bancaires', name: 'Cartes Bancaires', group: 'Cards', description: 'French domestic card network', countries: ['FR'], fee: { EUR: '0.5%' } },
  // Digital Wallets
  { id: 'apple_pay', name: 'Apple Pay', group: 'Digital Wallets', description: 'One-tap payments on Apple devices', countries: ALL_COUNTRIES, fee: { GBP: '0.5%', EUR: '0.5%', PLN: '0.5%' } },
  { id: 'google_pay', name: 'Google Pay', group: 'Digital Wallets', description: 'One-tap payments on Android and Chrome', countries: ALL_COUNTRIES, fee: { GBP: '0.5%', EUR: '0.5%', PLN: '0.5%' } },
  { id: 'revolut_pay', name: 'Revolut Pay', group: 'Digital Wallets', description: 'Pay with Revolut account', countries: ALL_COUNTRIES, fee: { GBP: '0.5%', EUR: '0.5%', PLN: '0.5%' } },
  // Bank Payments
  { id: 'pay_by_bank', name: 'Pay By Bank', group: 'Bank Payments', description: 'Instant A2A bank payment (UK Open Banking)', countries: ['GB'], fee: { GBP: '0.5%' } },
  { id: 'ideal', name: 'iDEAL / Wero', group: 'Bank Payments', description: 'Netherlands most popular payment method', countries: ['NL'], fee: { EUR: '€0.50 flat' } },
  { id: 'bancontact', name: 'Bancontact', group: 'Bank Payments', description: 'Belgium most popular payment method', countries: ['BE'], fee: { EUR: '0.5%' } },
  { id: 'blik', name: 'BLIK', group: 'Bank Payments', description: 'Polish instant mobile payments', countries: ['PL'], fee: { PLN: '0.5%' } },
  { id: 'eps', name: 'EPS', group: 'Bank Payments', description: 'Austrian bank transfer network', countries: ['AT'], fee: { EUR: '0.5%' } },
  { id: 'przelewy24', name: 'Przelewy24', group: 'Bank Payments', description: 'Polish online payment network', countries: ['PL'], fee: { PLN: '0.5%' } },
  // Bank Debits
  { id: 'bacs', name: 'Bacs Direct Debit', group: 'Bank Debits', description: 'UK direct debit, max £4 fee', countries: ['GB'], fee: { GBP: '0.5%' } },
  { id: 'sepa', name: 'SEPA Direct Debit', group: 'Bank Debits', description: 'EU direct debit, max €5 fee', countries: EUR_SEPA, fee: { EUR: '0.5%' } },
  { id: 'bank_transfer', name: 'Bank Transfer', group: 'Bank Debits', description: 'Manual bank transfer', countries: ALL_COUNTRIES, fee: { GBP: '£0.50 flat', EUR: '€0.50 flat' } },
  // Buy Now Pay Later
  { id: 'klarna', name: 'Klarna', group: 'Buy Now Pay Later', description: 'Pay in 3 instalments, no interest', countries: KLARNA_COUNTRIES, fee: { GBP: '0.5%', EUR: '0.5%' } },
  { id: 'afterpay', name: 'Afterpay / Clearpay', group: 'Buy Now Pay Later', description: 'Pay in 4 instalments (UK)', countries: ['GB'], fee: { GBP: '0.5%' } },
  { id: 'billie', name: 'Billie', group: 'Buy Now Pay Later', description: 'B2B BNPL for businesses', countries: ['DE', 'FR', 'BE', 'NL', 'AT'], fee: { EUR: '0.5%' } },
];

const GROUPS = ['Cards', 'Digital Wallets', 'Bank Payments', 'Bank Debits', 'Buy Now Pay Later'];

const TOTAL_FEES: Record<string, Record<string, string>> = {
  cards:           { GBP: '2.0% + £0.20', EUR: '2.0% + €0.25', PLN: '2.0% + zł1.00' },
  cartes_bancaires:{ GBP: '2.0% + £0.20', EUR: '2.0% + €0.25', PLN: '2.0% + zł1.00' },
  apple_pay:       { GBP: '2.0% + £0.20', EUR: '2.0% + €0.25', PLN: '2.0% + zł1.00' },
  google_pay:      { GBP: '2.0% + £0.20', EUR: '2.0% + €0.25', PLN: '2.0% + zł1.00' },
  revolut_pay:     { GBP: '2.0% + £0.20', EUR: '2.0% + €0.25', PLN: '2.0% + zł1.00' },
  pay_by_bank:     { GBP: '1.0%',          EUR: '1.0%',          PLN: '1.0%' },
  ideal:           { GBP: '€0.79 flat',    EUR: '€0.79 flat',    PLN: '€0.79 flat' },
  bancontact:      { GBP: '1.9% + €0.25',  EUR: '1.9% + €0.25',  PLN: '1.9% + €0.25' },
  blik:            { GBP: '2.0% + £0.20',  EUR: '2.0% + €0.25',  PLN: '2.0% + zł1.00' },
  eps:             { GBP: '2.0% + €0.25',  EUR: '2.0% + €0.25',  PLN: '2.0% + €0.25' },
  przelewy24:      { GBP: '2.0% + zł1.00', EUR: '2.0% + zł1.00', PLN: '2.0% + zł1.00' },
  bacs:            { GBP: '0.86% max £4.50', EUR: '0.86% max £4.50', PLN: '0.86% max £4.50' },
  sepa:            { GBP: '0.86% max €5.50', EUR: '0.86% max €5.50', PLN: '0.86% max €5.50' },
  bank_transfer:   { GBP: '£1.50 flat',    EUR: '€1.50 flat',    PLN: '€1.50 flat' },
  klarna:          { GBP: '2.99% + £0.20', EUR: '2.99% + €0.25', PLN: '2.99% + €0.25' },
  afterpay:        { GBP: '2.99% + £0.20', EUR: '2.99% + €0.25', PLN: '2.99% + €0.25' },
  billie:          { GBP: '2.99% + £0.20', EUR: '2.99% + €0.25', PLN: '2.99% + €0.25' },
};

export default function PaymentMethodsPage() {
  const router = useRouter();
  const [country, setCountry] = useState('GB');
  const [currency, setCurrency] = useState('GBP');
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Onboarding check first
    fetch('/api/merchant/profile')
      .then(r => r.json())
      .then(data => {
        if (!data.stripe_account_id || !data.business_country) {
          router.push('/merchant/onboarding');
          return;
        }
        return fetch('/api/merchant/payment-methods')
          .then(r => {
            if (r.status === 401) { router.push('/merchant/login'); return null; }
            return r.json();
          })
          .then(pmData => {
            if (!pmData) return;
            setCountry(pmData.country ?? 'GB');
            setCurrency(pmData.currency ?? 'GBP');
            setEnabled(new Set(pmData.enabled_methods ?? []));
          });
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function toggle(id: string, available: boolean) {
    if (!available) return;

    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEnabled(next);

    const res = await fetch('/api/merchant/payment-methods', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled_methods: Array.from(next) }),
    });

    if (res.ok) {
      showToast('Saved');
    } else {
      // revert
      setEnabled(enabled);
      showToast('Failed to save');
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  if (loading) {
    return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</main>;
  }

  return (
    <main style={s.page}>
      {toast && (
        <div style={s.toast}>{toast}</div>
      )}

      <div style={s.container}>
        <div style={s.header}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 36 }} />
          <nav style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a href="/merchant/dashboard" style={s.navLink}>Dashboard</a>
            <a href="/merchant/payment_methods" style={s.navActive}>Payment Methods</a>
            <a href="/merchant/payment-links" style={s.navLink}>Payment Links</a>
            <a href="/merchant/settings" style={s.navLink}>Settings</a>
            <button style={s.logoutBtn} onClick={async () => {
              await fetch('/api/merchant/auth/logout', { method: 'POST' });
              router.push('/merchant/login');
            }}>Log out</button>
          </nav>
        </div>

        <h1 style={s.title}>Payment Methods</h1>
        <p style={s.sub}>
          Configure which payment methods your customers can use.
          Showing methods for <strong>{country}</strong> · <strong>{currency}</strong>
        </p>

        {GROUPS.map(group => {
          const methods = ALL_METHODS.filter(m => m.group === group);
          return (
            <div key={group} style={s.section}>
              <h2 style={s.groupTitle}>{group}</h2>
              {methods.map(method => {
                const available = method.countries.includes(country);
                const isEnabled = enabled.has(method.id);
                const feeRecord = TOTAL_FEES[method.id];
                const fee = feeRecord?.[currency] ?? feeRecord?.EUR ?? feeRecord?.GBP ?? '';

                return (
                  <div key={method.id} style={{ ...s.methodCard, opacity: available ? 1 : 0.5 }}>
                    <div style={s.methodInfo}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={s.methodName}>{method.name}</span>
                        <span style={s.feeBadge}>{fee}</span>
                        {!available && (
                          <span style={s.unavailableBadge}>Not available in your region</span>
                        )}
                      </div>
                      <p style={s.methodDesc}>{method.description}</p>
                    </div>
                    <button
                      style={{ ...s.toggle, ...(isEnabled && available ? s.toggleOn : {}) }}
                      onClick={() => toggle(method.id, available)}
                      disabled={!available}
                      aria-label={isEnabled ? 'Disable' : 'Enable'}
                    >
                      <span style={{ ...s.toggleKnob, ...(isEnabled && available ? s.toggleKnobOn : {}) }} />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px' },
  container: { maxWidth: 680, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 800, margin: '0 0 6px' },
  sub: { color: 'var(--muted)', fontSize: 14, margin: '0 0 28px' },
  section: { marginBottom: 28 },
  groupTitle: { fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px', padding: '0 0 8px', borderBottom: '1px solid var(--border)' },
  methodCard: { display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.03)' },
  methodInfo: { flex: 1, minWidth: 0 },
  methodName: { fontSize: 14, fontWeight: 700 },
  methodDesc: { fontSize: 12, color: 'var(--muted)', margin: '3px 0 0' },
  feeBadge: { fontSize: 11, fontWeight: 600, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 6, padding: '2px 7px' },
  unavailableBadge: { fontSize: 11, fontWeight: 600, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a', borderRadius: 6, padding: '2px 7px' },
  toggle: { width: 44, height: 24, borderRadius: 12, background: 'var(--border)', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s', padding: 0 },
  toggleOn: { background: 'var(--brand)' },
  toggleKnob: { position: 'absolute', top: 3, left: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  toggleKnobOn: { left: 23 },
  toast: { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#111', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 100, pointerEvents: 'none' },
  navLink: { fontSize: 14, color: 'var(--muted)', textDecoration: 'none' },
  navActive: { fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' },
  logoutBtn: { fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' },
};
