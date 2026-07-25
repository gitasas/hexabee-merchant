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

const GROUP_SUBS: Record<string, string> = {
  'Cards': 'The default for most customers — works everywhere you sell.',
  'Digital Wallets': 'One-tap checkout on phones; fewer abandoned payments.',
  'Bank Payments': 'Local bank methods customers already trust in their country.',
  'Bank Debits': 'Direct debits and manual transfers for larger or recurring bills.',
  'Buy Now Pay Later': 'Let customers spread the cost — you are still paid in full.',
};

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

  if (loading) return <p className="hb-skeleton">Loading…</p>;

  return (
    <>
      {toast && <div className="hb-toast">{toast}</div>}

      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">Payment methods</h1>
          <p className="hb-sub">
            Choose what your customers can pay with — showing methods for{' '}
            <strong>{country}</strong> · <strong>{currency}</strong>
          </p>
        </div>
      </div>

      {GROUPS.map(group => {
        const methods = ALL_METHODS.filter(m => m.group === group);
        return (
          <div key={group} className="hb-card">
            <h2 className="hb-card-title">{group}</h2>
            <p className="hb-card-sub">{GROUP_SUBS[group]}</p>
            {methods.map(method => {
              const available = method.countries.includes(country);
              const isEnabled = enabled.has(method.id);
              const feeRecord = TOTAL_FEES[method.id];
              const fee = feeRecord?.[currency] ?? feeRecord?.EUR ?? feeRecord?.GBP ?? '';

              return (
                <div key={method.id} className={`hb-row${available ? '' : ' is-disabled'}`}>
                  <div className="hb-row-main">
                    <p className="hb-row-title">
                      {method.name}
                      {fee && <span className="hb-badge is-paid">{fee}</span>}
                      {!available && (
                        <span className="hb-badge is-pending">Not available in your region</span>
                      )}
                    </p>
                    <p className="hb-row-desc">{method.description}</p>
                  </div>
                  <button
                    type="button"
                    className={`hb-switch${isEnabled && available ? ' on' : ''}`}
                    onClick={() => toggle(method.id, available)}
                    disabled={!available}
                    role="switch"
                    aria-checked={isEnabled && available}
                    aria-label={`${method.name} — ${isEnabled ? 'enabled' : 'disabled'}`}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
