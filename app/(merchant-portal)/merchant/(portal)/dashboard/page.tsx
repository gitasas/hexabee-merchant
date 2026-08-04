'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHECKOUT_URL } from '@/lib/checkout-url';
import ExportCard from '../../../ExportCard';
import { useLang } from '../../../i18n';

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

const STATUS_CLS: Record<string, string> = {
  paid: 'is-paid',
  initiated: 'is-pending',
  failed: 'is-failed',
};

/** One point per day of the current month, from the 1st up to today. */
function buildMonthChartData(payments: Payment[]) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days: { label: string; date: string; amount: number }[] = [];

  for (let day = 1; day <= now.getDate(); day++) {
    days.push({
      date: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      label: String(day),
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

function RevenueChart({ data, currency, emptyText }: { data: { label: string; amount: number }[]; currency: string; emptyText: string }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-EU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  // A single point (the 1st of the month) cannot be drawn as a line
  if (data.length < 2 || !data.some(d => d.amount > 0)) {
    return <div className="hb-empty"><p>{emptyText}</p></div>;
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
      {data.map((d, i) => {
        // Keep roughly 8 day labels regardless of how far into the month we are
        const step = Math.max(1, Math.ceil(data.length / 8));
        return i % step === 0 || i === data.length - 1 ? (
          <text key={i} x={px(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label}</text>
        ) : null;
      })}
    </svg>
  );
}

export default function MerchantDashboardPage() {
  const router = useRouter();
  const { t } = useLang();
  const providerLabels = t.dashboard.providerLabels;
  const statusLabels: Record<string, string> = {
    paid: t.dashboard.statusPaid,
    initiated: t.dashboard.statusPending,
    failed: t.dashboard.statusFailed,
  };
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

  // Matches calculateHexabeeFee on the backend: iDEAL/bank transfer 1% (min
  // 0.50); BNPL (Klarna/Afterpay/Billie) 6.9% + 0.30; else 2% + 0.20 (GBP) /
  // 2.9% + 0.25 (other currencies). Computed in minor units like the backend.
  const feeByCurrency = paidPayments.reduce<Record<string, number>>((acc, p) => {
    const cur = p.currency || currency;
    const method = p.provider === 'stripe' ? 'card' : (p.provider ?? 'card');
    const amountMinor = Math.round(Number(p.amount) * 100);
    let feeMinor: number;
    if (method === 'ideal' || method === 'bank_transfer') {
      feeMinor = Math.max(Math.round(amountMinor * 0.01), 50);
    } else if (method === 'klarna' || method === 'afterpay' || method === 'billie') {
      feeMinor = Math.round(amountMinor * 0.069) + 30;
    } else if (cur === 'GBP') {
      feeMinor = Math.round(amountMinor * 0.02) + 20;
    } else {
      feeMinor = Math.round(amountMinor * 0.029) + 25;
    }
    acc[cur] = (acc[cur] ?? 0) + feeMinor / 100;
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
      label: providerLabels[provider] ?? provider,
      count,
      pct: payments.length > 0 ? Math.round(count / payments.length * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const monthChartData = buildMonthChartData(payments);
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const monthTotalEntries = Object.entries(
    sumByCurrency(paidPayments.filter(p => p.created_at.slice(0, 7) === monthPrefix))
  );

  const paymentLink = slug ? `${CHECKOUT_URL}/pay/${slug}` : null;
  const posLink = slug ? `${CHECKOUT_URL}/pay/${slug}?mode=pos` : null;

  function copyLink() {
    if (!paymentLink) return;
    navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <p className="hb-skeleton">{t.common.loading}</p>;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.dashboard.title}</h1>
          <p className="hb-sub">{t.dashboard.sub}</p>
        </div>
        <div className="hb-actions">
          <a className="hb-btn primary" href="/merchant/payment-links">{t.dashboard.newLink}</a>
        </div>
      </div>

      {/* The two numbers that matter: what came in, what is still owed */}
      <div className="hb-hero">
        <div className="hb-stat accent">
          <p className="hb-stat-label">{t.dashboard.collected}</p>
          {renderAmounts(collected)}
          <p className="hb-stat-note">{t.dashboard.paidPaymentsNote(paidPayments.length)}</p>
        </div>
        <div className="hb-stat">
          <p className="hb-stat-label">{t.dashboard.outstanding}</p>
          {renderAmounts(outstanding)}
          <p className="hb-stat-note">
            {unpaidInvoices.length > 0
              ? t.dashboard.unpaidInvoicesNote(unpaidInvoices.length)
              : t.dashboard.nothingUnpaid}
          </p>
        </div>
      </div>

      {/* Anything that needs the merchant to act */}
      {unpaidInvoices.length > 0 && (
        <div className="hb-alert">
          <div>
            <p className="hb-alert-text">
              {t.dashboard.awaitingPayment(unpaidInvoices.length)}
            </p>
            <p className="hb-alert-sub">{t.dashboard.awaitingPaymentSub}</p>
          </div>
          <a className="hb-btn sm" href="/merchant/invoices">{t.dashboard.reviewInvoices}</a>
        </div>
      )}
      {failedPayments.length > 0 && (
        <div className="hb-alert err">
          <div>
            <p className="hb-alert-text">
              {t.dashboard.failedPayments(failedPayments.length)}
            </p>
            <p className="hb-alert-sub">{t.dashboard.failedPaymentsSub}</p>
          </div>
        </div>
      )}

      <div className="hb-stats">
        <div className="hb-stat">
          <p className="hb-stat-label">{t.dashboard.payments}</p>
          <p className="hb-stat-value">{payments.length}</p>
        </div>
        <div className="hb-stat">
          <p className="hb-stat-label">{t.dashboard.pending}</p>
          <p className="hb-stat-value" style={{ color: 'var(--hb-warn)' }}>{pendingPayments.length}</p>
        </div>
        <div className="hb-stat">
          <p className="hb-stat-label">{t.dashboard.successRate}</p>
          <p className="hb-stat-value">
            {payments.length > 0 ? Math.round(paidPayments.length / payments.length * 100) : 0}%
          </p>
        </div>
        <div className="hb-stat">
          <p className="hb-stat-label">{t.dashboard.hexabeeFee}</p>
          {renderAmounts(feeByCurrency)}
        </div>
      </div>

      <div className="hb-card">
        <h2 className="hb-card-title">{t.dashboard.getPaid}</h2>
        <p className="hb-card-sub">{t.dashboard.getPaidSub}</p>
        <div className="hb-quick">
          <button type="button" className="hb-btn primary" onClick={copyLink} disabled={!paymentLink}>
            {copied ? t.dashboard.copiedShort : t.dashboard.copyPaymentLink}
          </button>
          <a className="hb-btn" href={posLink ?? '#'} target="_blank" rel="noreferrer">{t.dashboard.takeInPerson}</a>
          <a className="hb-btn" href="/merchant/payment-links">{t.dashboard.createLink}</a>
          <a className="hb-btn" href="/merchant/settings">{t.dashboard.qrAndSettings}</a>
        </div>
        {paymentLink && <p className="hb-note hb-mono">{paymentLink}</p>}
      </div>

      <div className="hb-card">
        <h2 className="hb-card-title">
          {t.dashboard.revenue} — {new Date().toLocaleDateString(t.locale, { month: 'long', year: 'numeric' })}
        </h2>
        <p className="hb-card-sub">
          {monthTotalEntries.length > 0
            ? t.dashboard.collectedThisMonth(monthTotalEntries.map(([cur, amt]) => fmt(amt.toFixed(2), cur)).join(' · '))
            : t.dashboard.nothingThisMonth}
        </p>
        <RevenueChart data={monthChartData} currency={currency} emptyText={t.dashboard.noRevenueChart} />
      </div>

      {providerRows.length > 0 && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.dashboard.howCustomersPay}</h2>
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

      <ExportCard />

      <div className="hb-card">
        <h2 className="hb-card-title">{t.dashboard.recentPayments}</h2>
        {payments.length === 0 ? (
          <div className="hb-empty">
            <p className="hb-empty-title">{t.dashboard.noPaymentsTitle}</p>
            <p>{t.dashboard.noPaymentsSub}</p>
            <button type="button" className="hb-btn primary" onClick={copyLink} disabled={!paymentLink}>
              {copied ? t.dashboard.copiedShort : t.dashboard.copyPaymentLink}
            </button>
          </div>
        ) : (
          <div className="hb-table-wrap">
            <table className="hb-table">
              <thead>
                <tr>
                  <th>{t.dashboard.thDate}</th>
                  <th>{t.dashboard.thReference}</th>
                  <th>{t.dashboard.thMethod}</th>
                  <th>{t.dashboard.thAmount}</th>
                  <th>{t.dashboard.thStatus}</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 25).map(p => {
                  const badgeCls = STATUS_CLS[p.status] ?? 'is-neutral';
                  const badgeLabel = statusLabels[p.status] ?? p.status;
                  const provider = (p.provider === 'stripe' ? 'card' : p.provider) ?? 'card';
                  return (
                    <tr key={p.id}>
                      <td data-label={t.dashboard.thDate}>{fmtDate(p.created_at)}</td>
                      <td data-label={t.dashboard.thReference}>{p.reference || '—'}</td>
                      <td data-label={t.dashboard.thMethod}>{providerLabels[provider] ?? provider}</td>
                      <td data-label={t.dashboard.thAmount} className="hb-num">{fmt(p.amount, p.currency)}</td>
                      <td data-label={t.dashboard.thStatus}>
                        <span className={`hb-badge ${badgeCls}`}>{badgeLabel}</span>
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
