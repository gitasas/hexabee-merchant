'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePayLang, PayLangToggle } from '../../pay/i18n';
import {
  MONTONIO_METHOD_MAP,
  MONTONIO_PREFERRED,
  grossUpAmountStr,
  type PayMethod,
} from '../../pay/methods';

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: '€', GBP: '£', USD: '$' };

type TapData = {
  business_name: string;
  payment_rail: string | null;
  fee_mode: string | null;
  currency: string;
  accepting_payments: boolean;
  methods: PayMethod[];
  request: {
    id: string;
    amount: number;
    currency: string;
    reference: string | null;
    fee: number;
    total: number;
  } | null;
};

/**
 * What the customer sees after tapping the NFC sticker at the counter.
 *
 * The one rule this screen exists to keep: **the customer never types an
 * amount.** The till entered it; this page shows it and hands the customer to
 * their own bank app. That is the difference from `?mode=pos`, which redirected
 * the merchant's own device to the checkout — unusable on the Montonio rail,
 * where authentication happens in the payer's banking app.
 */
export default function TapScreen({ slug }: { slug: string }) {
  const { t } = usePayLang();
  const [data, setData] = useState<TapData | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pos/tap/${encodeURIComponent(slug)}`, { cache: 'no-store' });
      if (!res.ok) { setError(t.tap.notAccepting); return; }
      setData(await res.json());
    } catch {
      setError(t.networkError);
    }
  }, [slug, t]);

  useEffect(() => { load(); }, [load]);

  // A customer often taps before the cashier has finished typing. Rather than
  // leaving them on "no amount yet", look again every few seconds until one
  // appears — the tag cannot be tapped twice as quickly as this polls.
  useEffect(() => {
    if (data?.request) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [data?.request, load]);

  async function pay(method: PayMethod) {
    if (!data?.request) return;
    setError(null);
    setLoading(method.id);
    try {
      const isMontonio = data.payment_rail === 'montonio';
      const body = isMontonio
        ? {
            merchantSlug: slug,
            amount: String(data.request.amount),
            currency: 'EUR',
            reference: data.request.reference,
            method: MONTONIO_METHOD_MAP[method.id] ?? 'paymentInitiation',
            preferred_method: MONTONIO_PREFERRED[method.id],
            preferred_country: 'LT',
            locale: typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'lt',
            // The counter's request, so the till screen can settle itself off
            // the webhook. The fee is still decided server-side.
            pos_request_id: data.request.id,
          }
        : {
            merchantSlug: slug,
            // Off the Montonio rail the fee is a percentage baked into the
            // amount, exactly as the other Stripe surfaces do it.
            amount:
              data.fee_mode === 'payer'
                ? grossUpAmountStr(String(data.request.amount), data.currency, method.id)
                : String(data.request.amount),
            currency: data.currency,
            reference: data.request.reference,
            method: method.id,
            email: 'pos@hexabee.com',
          };

      const res = await fetch(isMontonio ? '/api/payment/montonio' : '/api/payment/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.payment_url) {
        setError(json.error || t.sessionError);
        return;
      }
      window.location.href = json.payment_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t.networkError);
    } finally {
      setLoading(null);
    }
  }

  const sym = CURRENCY_SYMBOLS[data?.currency ?? 'EUR'] ?? data?.currency ?? '';
  const money = (v: number) => `${sym}${v.toFixed(2)}`;

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 16px' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '32px 28px', maxWidth: 420, width: '100%', boxSizing: 'border-box', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
        <PayLangToggle />
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 72, display: 'block', margin: '0 auto 12px' }} />

        {data && (
          <h2 style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>
            {data.business_name}
          </h2>
        )}
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', margin: '0 0 22px' }}>{t.tap.title}</p>

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>}

        {!data ? (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>{t.loading}</p>
        ) : !data.accepting_payments ? (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>{t.tap.notAccepting}</p>
        ) : !data.request ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px' }}>{t.tap.noRequest}</p>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 18px' }}>{t.tap.noRequestHint}</p>
            <button
              onClick={load}
              style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
            >
              {t.tap.refresh}
            </button>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', margin: '0 0 18px' }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t.tap.amountToPay}
              </p>
              <p style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
                {money(data.request.total)}
              </p>
            </div>

            <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '12px 14px', marginBottom: 20, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--muted)' }}>{t.tap.invoiceAmount}</span>
                <span style={{ fontWeight: 600 }}>{money(data.request.amount)}</span>
              </div>
              {data.request.fee > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)' }}>{t.tap.fee}</span>
                  <span style={{ fontWeight: 600 }}>{money(data.request.fee)}</span>
                </div>
              )}
            </div>

            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px', textAlign: 'center' }}>{t.tap.choose}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.methods.map(m => (
                <button
                  key={m.id}
                  onClick={() => pay(m)}
                  disabled={!!loading}
                  style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: loading ? 'var(--border)' : 'var(--brand)', color: '#111', fontWeight: 800, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer' }}
                >
                  {loading === m.id ? t.redirecting : `${m.icon}  ${t.methodNames[m.id] ?? m.name}`}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
