'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Method = {
  id: string;
  name: string;
  group: string;
  description: string;
  countries: string[];
};

const ALL_COUNTRIES = ['GB','DE','FR','BE','NL','AT','PL','LT','LV','EE','FI','SE','DK','NO','IE','PT','ES','IT','CZ','SK','HU','RO','BG','HR','SI','GR','CY','MT','LU'];
const EUR_SEPA = ['DE','FR','BE','NL','AT','PL','LT','LV','EE','FI','IE','PT','ES','IT','SK','HR','SI','GR','CY','MT','LU','RO'];
const KLARNA_COUNTRIES = ['GB','DE','FR','BE','NL','AT','LT','LV','EE','FI','IE','PT','ES','IT','SK','HR','SI','GR','CY','MT','LU','SE','DK','NO','CZ','PL'];

const ALL_METHODS: Method[] = [
  // Cards
  { id: 'cards', name: 'Cards', group: 'Cards', description: 'Visa, Mastercard and other major cards', countries: ALL_COUNTRIES },
  { id: 'cartes_bancaires', name: 'Cartes Bancaires', group: 'Cards', description: 'French domestic card network', countries: ['FR'] },
  // Digital Wallets
  { id: 'apple_pay', name: 'Apple Pay', group: 'Digital Wallets', description: 'One-tap payments on Apple devices', countries: ALL_COUNTRIES },
  { id: 'google_pay', name: 'Google Pay', group: 'Digital Wallets', description: 'One-tap payments on Android and Chrome', countries: ALL_COUNTRIES },
  { id: 'revolut_pay', name: 'Revolut Pay', group: 'Digital Wallets', description: 'Pay with Revolut account', countries: ALL_COUNTRIES },
  // Bank Payments
  { id: 'pay_by_bank', name: 'Pay By Bank', group: 'Bank Payments', description: 'Instant A2A bank payment (UK Open Banking)', countries: ['GB'] },
  { id: 'ideal', name: 'iDEAL / Wero', group: 'Bank Payments', description: 'Netherlands most popular payment method', countries: ['NL'] },
  { id: 'bancontact', name: 'Bancontact', group: 'Bank Payments', description: 'Belgium most popular payment method', countries: ['BE'] },
  { id: 'blik', name: 'BLIK', group: 'Bank Payments', description: 'Polish instant mobile payments', countries: ['PL'] },
  { id: 'eps', name: 'EPS', group: 'Bank Payments', description: 'Austrian bank transfer network', countries: ['AT'] },
  { id: 'przelewy24', name: 'Przelewy24', group: 'Bank Payments', description: 'Polish online payment network', countries: ['PL'] },
  // Bank Debits
  { id: 'bacs', name: 'Bacs Direct Debit', group: 'Bank Debits', description: 'UK direct debit', countries: ['GB'] },
  { id: 'sepa', name: 'SEPA Direct Debit', group: 'Bank Debits', description: 'EU direct debit', countries: EUR_SEPA },
  { id: 'bank_transfer', name: 'Bank Transfer', group: 'Bank Debits', description: 'Manual bank transfer', countries: ALL_COUNTRIES },
  // Buy Now Pay Later
  { id: 'klarna', name: 'Klarna', group: 'Buy Now Pay Later', description: 'Pay in 3 instalments, no interest', countries: KLARNA_COUNTRIES },
  { id: 'afterpay', name: 'Afterpay / Clearpay', group: 'Buy Now Pay Later', description: 'Pay in 4 instalments (UK)', countries: ['GB'] },
  { id: 'billie', name: 'Billie', group: 'Buy Now Pay Later', description: 'B2B BNPL for businesses', countries: ['DE', 'FR', 'BE', 'NL', 'AT'] },
];

const GROUPS = ['Cards', 'Digital Wallets', 'Bank Payments', 'Bank Debits', 'Buy Now Pay Later'];

const GROUP_SUBS: Record<string, string> = {
  'Cards': 'The default for most customers — works everywhere you sell.',
  'Digital Wallets': 'One-tap checkout on phones; fewer abandoned payments.',
  'Bank Payments': 'Local bank methods customers already trust in their country.',
  'Bank Debits': 'Direct debits and manual transfers for larger or recurring bills.',
  'Buy Now Pay Later': 'Let customers spread the cost — you are still paid in full.',
};

// Single source of truth: calculateHexabeeFee in the payments backend
// (index.js). 2.0% + 20 minor units (GBP) / 25 minor units (other currencies);
// iDEAL and bank transfer are a flat 50 minor units.
const STANDARD_FEE: Record<string, string> = {
  GBP: '2.0% + £0.20', EUR: '2.0% + €0.25', PLN: '2.0% + zł0.25',
};
const TOTAL_FEES: Record<string, Record<string, string>> = {
  cards:            STANDARD_FEE,
  cartes_bancaires: STANDARD_FEE,
  apple_pay:        STANDARD_FEE,
  google_pay:       STANDARD_FEE,
  revolut_pay:      STANDARD_FEE,
  pay_by_bank:      STANDARD_FEE,
  ideal:            { GBP: '€0.50 flat', EUR: '€0.50 flat', PLN: '€0.50 flat' },
  bancontact:       STANDARD_FEE,
  blik:             STANDARD_FEE,
  eps:              STANDARD_FEE,
  przelewy24:       STANDARD_FEE,
  bacs:             STANDARD_FEE,
  sepa:             STANDARD_FEE,
  bank_transfer:    { GBP: '£0.50 flat', EUR: '€0.50 flat', PLN: 'zł0.50 flat' },
  klarna:           STANDARD_FEE,
  afterpay:         STANDARD_FEE,
  billie:           STANDARD_FEE,
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
