'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHECKOUT_URL } from '@/lib/checkout-url';

type Payment = {
  id: string;
  provider: string;
  amount: string;
  currency: string;
  reference: string | null;
  status: string;
  created_at: string;
};

type Invoice = {
  id: string;
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  payer_email?: string | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  card: 'Card', google_pay: 'Google Pay', apple_pay: 'Apple Pay',
  klarna: 'Klarna', afterpay: 'Afterpay / Clearpay', billie: 'Billie',
  sepa: 'SEPA Direct Debit', bacs: 'Bacs Direct Debit', bank_transfer: 'Bank Transfer',
  pay_by_bank: 'Pay By Bank', ideal: 'iDEAL', bancontact: 'Bancontact',
  blik: 'BLIK', przelewy24: 'Przelewy24', eps: 'EPS', bank: 'Bank',
};

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  paid: { cls: 'is-paid', label: 'Paid' },
  initiated: { cls: 'is-pending', label: 'Pending' },
  failed: { cls: 'is-failed', label: 'Failed' },
};

function buildChartData(payments: Payment[]) {
  const days: { label: string; date: string; amount: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      amount: 0,
    });
  }
  payments
    .filter(p => p.status === 'paid')
    .forEach(p => {
      const day = days.find(d => d.date === p.created_at.slice(0, 10));
      if (day) day.amount += Number(p.amount);
    });
  return days;
}

function RevenueChart({ data, currency }: { data: { label: string; amount: number }[]; currency: string }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-EU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  if (!data.some(d => d.amount > 0)) {
    return <div className="hb-empty"><p>No revenue in the last 14 days.</p></div>;
  }

  const W = 600, H = 140;
  const L = 56, R = 590, T = 14, B = 110;
  const cw = R - L, ch = B - T;
  const maxVal = Math.max(...data.map(d => d.amount));

  const px = (i: number) => L + (i / (data.length - 1)) * cw;
  const py = (v: number) => B - (maxVal > 0 ? (v / maxVal) * ch : 0);

  const points = data.map((d, i) => `${px(i)},${py(d.amount)}`).join(' ');
  const fillPoints = `${px(0)},${B} ${points} ${px(data.length - 1)},${B}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 0.5, 1].map(t => (
        <line key={t} x1={L} x2={R} y1={T + t * ch} y2={T + t * ch} stroke="var(--border)" strokeWidth="1" />
      ))}
      <text x={L - 6} y={T + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(maxVal)}</text>
      <text x={L - 6} y={T + ch / 2 + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(maxVal / 2)}</text>
      <text x={L - 6} y={B + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(0)}</text>
      <polygon points={fillPoints} fill="var(--brand)" opacity="0.15" />
      <polyline points={points} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => d.amount > 0 ? <circle key={i} cx={px(i)} cy={py(d.amount)} r="3" fill="var(--brand)" /> : null)}
      {data.map((d, i) => i % 3 === 0 ? (
        <text key={i} x={px(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label}</text>
      ) : null)}
    </svg>
  );
}

export default function MerchantDashboardPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [currency, setCurrency] = useState('EUR');
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => r.json())
      .then(data => {
        if (!data.stripe_account_id || !data.business_country) {
          router.push('/merchant/onboarding');
          return;
        }
        setSlug(data.slug ?? null);
        if (data.business_currency) setCurrency(data.business_currency);

        fetch('/api/merchant/payments')
          .then(r => {
            if (r.status === 401) { router.push('/merchant/login'); return null; }
            return r.json();
          })
          .then(pData => {
            if (!pData) return;
            setPayments(pData.payments ?? []);
            if (pData.payments?.[0]?.currency) setCurrency(pData.payments[0].currency);
          })
          .finally(() => setLoading(false));

        // Outstanding comes from the BCC invoice ledger; it may be empty or
        // unavailable, which is fine — the tile just shows zero.
        fetch('/api/merchant/invoices')
          .then(r => (r.ok ? r.json() : null))
          .then(iData => { if (iData) setInvoices(iData.invoices ?? []); })
          .catch(() => null);
      })
      .catch(() => setLoading(false));
  }, [router]);

  const fmt = (amount: string | number, cur: string) =>
    new Intl.NumberFormat('en-EU', { style: 'currency', currency: cur || 'EUR' }).format(Number(amount));

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const paidPayments = payments.filter(p => p.status === 'paid');
  const pendingPayments = payments.filter(p => p.status === 'initiated');
  const failedPayments = payments.filter(p => p.status === 'failed');
  // Rows we could not read from the emailed PDF (no number/amount) are not
  // money owed — they are surfaced on the Invoices page instead.
  const unpaidInvoices = invoices.filter(
    i => i.status === 'issued' && !!i.invoice_number && i.amount !== null
  );

  const sumByCurrency = (rows: { amount: string | null; currency: string | null }[]) =>
    rows.reduce<Record<string, number>>((acc, r) => {
      const cur = r.currency || currency;
      acc[cur] = (acc[cur] ?? 0) + Number(r.amount ?? 0);
      return acc;
    }, {});

  const collected = sumByCurrency(paidPayments);
  const outstanding = sumByCurrency(unpaidInvoices);

  // Matches calculateHexabeeFee on the backend: 2% + fixed (0.20 GBP / 0.25)
  const feeByCurrency = paidPayments.reduce<Record<string, number>>((acc, p) => {
    const cur = p.currency || currency;
    acc[cur] = (acc[cur] ?? 0) + Number(p.amount) * 0.02 + (cur === 'GBP' ? 0.20 : 0.25);
    return acc;
  }, {});

  const renderAmounts = (totals: Record<string, number>) => {
    const entries = Object.entries(totals);
    if (entries.length === 0) return <p className="hb-stat-value">{fmt(0, currency)}</p>;
    return entries.map(([cur, amt]) => (
      <p key={cur} className="hb-stat-value">{fmt(amt.toFixed(2), cur)}</p>
    ));
  };

  const providerCounts = payments.reduce<Record<string, number>>((acc, p) => {
    const provider = (p.provider === 'stripe' ? 'card' : p.provider) ?? 'card';
    acc[provider] = (acc[provider] ?? 0) + 1;
    return acc;
  }, {});

  const providerRows = Object.entries(providerCounts)
    .map(([provider, count]) => ({
      provider,
      label: PROVIDER_LABELS[provider] ?? provider,
      count,
      pct: payments.length > 0 ? Math.round(count / payments.length * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const paymentLink = slug ? `${CHECKOUT_URL}/pay/${slug}` : null;
  const posLink = slug ? `${CHECKOUT_URL}/pay/${slug}?mode=pos` : null;

  function copyLink() {
    if (!paymentLink) return;
    navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <p className="hb-skeleton">Loading…</p>;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">Dashboard</h1>
          <p className="hb-sub">Your money at a glance</p>
        </div>
        <div className="hb-actions">
          <a className="hb-btn primary" href="/merchant/payment-links">+ New payment link</a>
        </div>
      </div>

      {/* The two numbers that matter: what came in, what is still owed */}
      <div className="hb-hero">
        <div className="hb-stat accent">
          <p className="hb-stat-label">Collected</p>
          {renderAmounts(collected)}
          <p className="hb-stat-note">{paidPayments.length} paid payment{paidPayments.length === 1 ? '' : 's'}</p>
        </div>
        <div className="hb-stat">
          <p className="hb-stat-label">Outstanding</p>
          {renderAmounts(outstanding)}
          <p className="hb-stat-note">
            {unpaidInvoices.length > 0
              ? `${unpaidInvoices.length} unpaid invoice${unpaidInvoices.length === 1 ? '' : 's'}`
              : 'Nothing unpaid'}
          </p>
        </div>
      </div>

      {/* Anything that needs the merchant to act */}
      {unpaidInvoices.length > 0 && (
        <div className="hb-alert">
          <div>
            <p className="hb-alert-text">
              {unpaidInvoices.length} invoice{unpaidInvoices.length === 1 ? '' : 's'} awaiting payment
            </p>
            <p className="hb-alert-sub">Send a reminder with a pay-now link — instalments included when you offer them.</p>
          </div>
          <a className="hb-btn sm" href="/merchant/invoices">Review invoices</a>
        </div>
      )}
      {failedPayments.length > 0 && (
        <div className="hb-alert err">
          <div>
            <p className="hb-alert-text">
              {failedPayments.length} failed payment{failedPayments.length === 1 ? '' : 's'}
            </p>
            <p className="hb-alert-sub">The customer may need a fresh link or another payment method.</p>
          </div>
        </div>
      )}

      <div className="hb-stats">
        <div className="hb-stat">
          <p className="hb-stat-label">Payments</p>
          <p className="hb-stat-value">{payments.length}</p>
        </div>
        <div className="hb-stat">
          <p className="hb-stat-label">Pending</p>
          <p className="hb-stat-value" style={{ color: 'var(--hb-warn)' }}>{pendingPayments.length}</p>
        </div>
        <div className="hb-stat">
          <p className="hb-stat-label">Success rate</p>
          <p className="hb-stat-value">
            {payments.length > 0 ? Math.round(paidPayments.length / payments.length * 100) : 0}%
          </p>
        </div>
        <div className="hb-stat">
          <p className="hb-stat-label">HexaBee fee</p>
          {renderAmounts(feeByCurrency)}
        </div>
      </div>

      <div className="hb-card">
        <h2 className="hb-card-title">Get paid</h2>
        <p className="hb-card-sub">Share your link, take a payment in person, or create a one-off link.</p>
        <div className="hb-quick">
          <button type="button" className="hb-btn primary" onClick={copyLink} disabled={!paymentLink}>
            {copied ? '✓ Copied' : '⎘ Copy payment link'}
          </button>
          <a className="hb-btn" href={posLink ?? '#'} target="_blank" rel="noreferrer">📱 Take payment in person</a>
          <a className="hb-btn" href="/merchant/payment-links">🔗 Create payment link</a>
          <a className="hb-btn" href="/merchant/settings">⚙️ QR code & settings</a>
        </div>
        {paymentLink && <p className="hb-note hb-mono">{paymentLink}</p>}
      </div>

      <div className="hb-card">
        <h2 className="hb-card-title">Revenue — last 14 days</h2>
        <RevenueChart data={buildChartData(payments)} currency={currency} />
      </div>

      {providerRows.length > 0 && (
        <div className="hb-card">
          <h2 className="hb-card-title">How customers pay</h2>
          {providerRows.map(row => (
            <div key={row.provider} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{row.label}</span>
                <span style={{ color: 'var(--muted)' }}>{row.count} · {row.pct}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg)', borderRadius: 999 }}>
                <div style={{ width: `${row.pct}%`, height: '100%', background: 'var(--brand)', borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hb-card">
        <h2 className="hb-card-title">Recent payments</h2>
        {payments.length === 0 ? (
          <div className="hb-empty">
            <p className="hb-empty-title">No payments yet</p>
            <p>Share your payment link and the first payment will show up here.</p>
            <button type="button" className="hb-btn primary" onClick={copyLink} disabled={!paymentLink}>
              {copied ? '✓ Copied' : '⎘ Copy payment link'}
            </button>
          </div>
        ) : (
          <div className="hb-table-wrap">
            <table className="hb-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 25).map(p => {
                  const badge = STATUS_BADGE[p.status] ?? { cls: 'is-neutral', label: p.status };
                  const provider = (p.provider === 'stripe' ? 'card' : p.provider) ?? 'card';
                  return (
                    <tr key={p.id}>
                      <td data-label="Date">{fmtDate(p.created_at)}</td>
                      <td data-label="Reference">{p.reference || '—'}</td>
                      <td data-label="Method">{PROVIDER_LABELS[provider] ?? provider}</td>
                      <td data-label="Amount" className="hb-num">{fmt(p.amount, p.currency)}</td>
                      <td data-label="Status">
                        <span className={`hb-badge ${badge.cls}`}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
