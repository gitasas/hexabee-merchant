'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';

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

const MONTONIO_IDS = ['montonio_bank', 'montonio_card'] as const;
const MONTONIO_METHOD_ROWS = [
  { id: 'montonio_bank', nameKey: 'montonioBank' as const, subKey: 'montonioBankSub' as const },
  { id: 'montonio_card', nameKey: 'montonioCard' as const, subKey: 'montonioCardSub' as const },
];

// Single source of truth: calculateHexabeeFee in the payments backend
// (index.js). Standard tier 2.0% + 20 minor units (GBP) / 2.9% + 25 minor
// units (other currencies); iDEAL, bank transfer and Pay by Bank 1% (min 50
// minor units); BNPL (Klarna/Afterpay/Billie) 6.9% + 30 minor units.
const STANDARD_FEE: Record<string, string> = {
  GBP: '2.0% + £0.20', EUR: '2.9% + €0.25', PLN: '2.9% + zł0.25',
};
const BNPL_FEE: Record<string, string> = {
  GBP: '6.9% + £0.30', EUR: '6.9% + €0.30', PLN: '6.9% + zł0.30',
};
// Montonio is a separate rail with a separate fee model: the payer pays a flat
// EUR 0.49 whatever the method, and HexaBee invoices the merchant EUR 0.39 of it
// monthly instead of deducting anything per payment. The percentages below apply
// to the Stripe rail only.
const MONTONIO_FLAT: Record<string, string> = { GBP: '€0.49', EUR: '€0.49', PLN: '€0.49' };

const TOTAL_FEES: Record<string, Record<string, string>> = {
  montonio_bank:    MONTONIO_FLAT,
  montonio_card:    MONTONIO_FLAT,
  cards:            STANDARD_FEE,
  cartes_bancaires: STANDARD_FEE,
  apple_pay:        STANDARD_FEE,
  google_pay:       STANDARD_FEE,
  revolut_pay:      STANDARD_FEE,
  pay_by_bank:      { GBP: '1% (min £0.50)', EUR: '1% (min £0.50)', PLN: '1% (min £0.50)' },
  ideal:            { GBP: '1% (min €0.50)', EUR: '1% (min €0.50)', PLN: '1% (min €0.50)' },
  bancontact:       STANDARD_FEE,
  blik:             STANDARD_FEE,
  eps:              STANDARD_FEE,
  przelewy24:       STANDARD_FEE,
  bacs:             STANDARD_FEE,
  sepa:             STANDARD_FEE,
  bank_transfer:    { GBP: '1% (min £0.50)', EUR: '1% (min €0.50)', PLN: '1% (min zł0.50)' },
  klarna:           BNPL_FEE,
  afterpay:         BNPL_FEE,
  billie:           BNPL_FEE,
};

export default function PaymentMethodsPage() {
  const router = useRouter();
  const { t } = useLang();
  const [country, setCountry] = useState('GB');
  const [currency, setCurrency] = useState('GBP');
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [isMontonio, setIsMontonio] = useState(false);

  useEffect(() => {
    // Onboarding check first
    fetch('/api/merchant/profile')
      .then(r => r.json())
      .then(data => {
        if (!isOnboardingComplete(data)) {
          router.push('/merchant/onboarding');
          return;
        }
        setIsMontonio(data.payment_rail === 'montonio');
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

    // On the bank rail there are only two methods, so turning the second one off
    // leaves a merchant who cannot be paid at all — with nothing on the checkout
    // to explain it. Keep at least one.
    if (isMontonio && !MONTONIO_IDS.some(m => next.has(m))) {
      showToast(t.methods.keepOne);
      return;
    }
    setEnabled(next);

    const res = await fetch('/api/merchant/payment-methods', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled_methods: Array.from(next) }),
    });

    if (res.ok) {
      showToast(t.common.saved);
    } else {
      // revert
      setEnabled(enabled);
      showToast(t.common.saveFailed);
    }
  }

  /**
   * A merchant who has never touched these has neither id stored, which is not
   * the same as having switched both off — read it as both on until they choose.
   */
  function montonioEnabled(id: string) {
    if (!MONTONIO_IDS.some(m => enabled.has(m))) return true;
    return enabled.has(id);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  if (loading) return <p className="hb-skeleton">{t.common.loading}</p>;

  return (
    <>
      {toast && <div className="hb-toast">{toast}</div>}

      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.methods.title}</h1>
          <p className="hb-sub">
            {t.methods.subPrefix}{' '}
            <strong>{country}</strong> · <strong>{currency}</strong>
          </p>
        </div>
      </div>

      {/* The Stripe catalogue belongs to the Stripe rail. A Montonio merchant has
          exactly two methods — offering them toggles for iDEAL, Klarna or Bacs
          would be offering products their account cannot reach. Both stay
          switchable: cards cost the merchant Montonio's card rate, while the
          bank cost hides under the platform fee, so whether to accept cards is a
          real commercial choice rather than a formality. */}
      {isMontonio ? (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.methods.montonioTitle}</h2>
          <p className="hb-card-sub">{t.methods.montonioNote}</p>
          {MONTONIO_METHOD_ROWS.map(method => {
            const isEnabled = montonioEnabled(method.id);
            const fee = TOTAL_FEES[method.id]?.[currency] ?? TOTAL_FEES[method.id]?.EUR ?? '';

            return (
              <div key={method.id} className="hb-row">
                <div className="hb-row-main">
                  <p className="hb-row-title">
                    {t.methods[method.nameKey]}
                    {fee && <span className="hb-badge is-paid">{fee}</span>}
                  </p>
                  <p className="hb-row-desc">{t.methods[method.subKey]}</p>
                </div>
                <button
                  type="button"
                  className={`hb-switch${isEnabled ? ' on' : ''}`}
                  onClick={() => toggle(method.id, true)}
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`${t.methods[method.nameKey]} — ${isEnabled ? t.methods.enabled : t.methods.disabled}`}
                />
              </div>
            );
          })}
        </div>
      ) : GROUPS.map(group => {
        const methods = ALL_METHODS.filter(m => m.group === group);
        return (
          <div key={group} className="hb-card">
            <h2 className="hb-card-title">{t.methods.groups[group] ?? group}</h2>
            <p className="hb-card-sub">{t.methods.groupSubs[group]}</p>
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
                        <span className="hb-badge is-pending">{t.methods.notAvailable}</span>
                      )}
                    </p>
                    <p className="hb-row-desc">{t.methods.descriptions[method.id] ?? method.description}</p>
                  </div>
                  <button
                    type="button"
                    className={`hb-switch${isEnabled && available ? ' on' : ''}`}
                    onClick={() => toggle(method.id, available)}
                    disabled={!available}
                    role="switch"
                    aria-checked={isEnabled && available}
                    aria-label={`${method.name} — ${isEnabled ? t.methods.enabled : t.methods.disabled}`}
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
