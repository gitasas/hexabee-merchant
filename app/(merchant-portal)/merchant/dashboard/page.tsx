'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Payment = {
  id: string;
  provider: string;
  amount: string;
  currency: string;
  reference: string | null;
  status: string;
  created_at: string;
};

const STATUS_COLOR: Record<string, string> = {
  paid: '#16a34a',
  initiated: '#b45309',
  failed: '#dc2626',
};

const CARD_PROVIDERS = new Set(['stripe', 'card', 'cards', 'cartes_bancaires']);

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
      const dateStr = p.created_at.slice(0, 10);
      const day = days.find(d => d.date === dateStr);
      if (day) day.amount += Number(p.amount);
    });
  return days;
}

function RevenueChart({ data, currency }: { data: { label: string; amount: number }[]; currency: string }) {
  const nonZero = data.filter(d => d.amount > 0);
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-EU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  if (nonZero.length < 1) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 14 }}>
        No revenue data yet
      </div>
    );
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
      {/* Grid lines */}
      {[0, 0.5, 1].map(t => (
        <line key={t} x1={L} x2={R} y1={T + t * ch} y2={T + t * ch} stroke="var(--border)" strokeWidth="1" />
      ))}
      {/* Y labels */}
      <text x={L - 6} y={T + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(maxVal)}</text>
      <text x={L - 6} y={T + ch / 2 + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(maxVal / 2)}</text>
      <text x={L - 6} y={B + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(0)}</text>
      {/* Fill area */}
      <polygon points={fillPoints} fill="var(--brand)" opacity="0.15" />
      {/* Line */}
      <polyline points={points} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" />
      {/* Dots on non-zero */}
      {data.map((d, i) => d.amount > 0 ? (
        <circle key={i} cx={px(i)} cy={py(d.amount)} r="3" fill="var(--brand)" />
      ) : null)}
      {/* X labels every 3rd */}
      {data.map((d, i) => i % 3 === 0 ? (
        <text key={i} x={px(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label}</text>
      ) : null)}
    </svg>
  );
}

export default function MerchantDashboardPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
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

        fetch('/api/merchant/payments')
          .then(r => {
            if (r.status === 401) { router.push('/merchant/login'); return null; }
            return r.json();
          })
          .then(pData => {
            if (!pData) return;
            setPayments(pData.payments ?? []);
            setTotal(pData.total ?? 0);
            if (pData.payments?.[0]?.currency) setCurrency(pData.payments[0].currency);
          })
          .finally(() => setLoading(false));
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
  const hexabeeFee = paidPayments.reduce((sum, p) => sum + Number(p.amount) * 0.02, 0);
  const conversionRate = payments.length > 0 ? Math.round(paidPayments.length / payments.length * 100) : 0;

  const cardCount = payments.filter(p => CARD_PROVIDERS.has(p.provider)).length;
  const bankCount = payments.length - cardCount;
  const cardPct = payments.length > 0 ? Math.round(cardCount / payments.length * 100) : 0;
  const bankPct = 100 - cardPct;

  const chartData = buildChartData(payments);
  const paymentLink = slug ? `https://checkout.hexabee.buzz/pay/${slug}` : null;

  function copyLink() {
    if (!paymentLink) return;
    navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main style={s.page}>
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 36 }} />
          <nav style={s.nav}>
            <a href="/merchant/dashboard" style={s.navActive}>Dashboard</a>
            <a href="/merchant/payment_methods" style={s.navLink}>Payment Methods</a>
            <a href="/merchant/settings" style={s.navLink}>Settings</a>
            <button style={s.logoutBtn} onClick={async () => {
              await fetch('/api/merchant/auth/logout', { method: 'POST' });
              router.push('/merchant/login');
            }}>Log out</button>
          </nav>
        </div>

        <h1 style={s.title}>Dashboard</h1>

        {/* KPI stats — 7 cards, 4-col grid wraps to 2 rows */}
        <div style={s.statsRow}>
          <div style={s.statCard}>
            <p style={s.statLabel}>Total collected</p>
            <p style={s.statValue}>{fmt(String(total), currency)}</p>
          </div>
          <div style={s.statCard}>
            <p style={s.statLabel}>Payments</p>
            <p style={s.statValue}>{payments.length}</p>
          </div>
          <div style={s.statCard}>
            <p style={s.statLabel}>Paid</p>
            <p style={{ ...s.statValue, color: '#16a34a' }}>{paidPayments.length}</p>
          </div>
          <div style={s.statCard}>
            <p style={s.statLabel}>HexaBee Fee</p>
            <p style={s.statValue}>{fmt(hexabeeFee.toFixed(2), currency)}</p>
          </div>
          <div style={s.statCard}>
            <p style={s.statLabel}>Pending</p>
            <p style={{ ...s.statValue, color: '#b45309' }}>{pendingPayments.length}</p>
          </div>
          <div style={s.statCard}>
            <p style={s.statLabel}>Failed</p>
            <p style={{ ...s.statValue, color: '#dc2626' }}>{failedPayments.length}</p>
          </div>
          <div style={s.statCard}>
            <p style={s.statLabel}>Conversion</p>
            <p style={s.statValue}>{conversionRate}%</p>
          </div>
        </div>

        {/* Revenue chart */}
        <div style={{ ...s.card, marginBottom: 20 }}>
          <h2 style={s.cardTitle}>Revenue — last 14 days</h2>
          <RevenueChart data={chartData} currency={currency} />
        </div>

        {/* Two-column row: breakdown + quick actions */}
        <div style={s.twoCol}>
          {/* Provider breakdown */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Payment methods</h2>
            {payments.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>No data yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { label: 'Card', count: cardCount, pct: cardPct, color: '#3b82f6' },
                  { label: 'Bank', count: bankCount, pct: bankPct, color: '#8b5cf6' },
                ].map(row => (
                  <div key={row.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                      <span style={{ fontWeight: 600 }}>{row.label}</span>
                      <span style={{ color: 'var(--muted)' }}>{row.count} · {row.pct}%</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${row.pct}%`, background: row.color, borderRadius: 4, transition: 'width 0.4s' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Quick actions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {paymentLink && (
                <button
                  style={s.actionBtn}
                  onClick={copyLink}
                >
                  {copied ? '✓ Copied!' : '⎘  Copy payment link'}
                </button>
              )}
              <a href="/merchant/payment_methods" style={{ ...s.actionBtn, textDecoration: 'none', textAlign: 'center' }}>
                ⚙  Payment methods
              </a>
              <a href="/merchant/settings" style={{ ...s.actionBtn, textDecoration: 'none', textAlign: 'center' }}>
                ✎  Settings
              </a>
            </div>
          </div>
        </div>

        {/* Payment history */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Payment history</h2>

          {loading && <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</p>}

          {!loading && payments.length === 0 && (
            <div style={s.emptyState}>
              <p style={s.emptyTitle}>No payments yet</p>
              <p style={s.emptySub}>Share your payment link to get started</p>
              {paymentLink && (
                <div style={s.emptyLink}>
                  <span style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--muted)' }}>{paymentLink}</span>
                  <button style={s.copyBtn} onClick={copyLink}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          )}

          {payments.length > 0 && (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Date</th>
                    <th style={s.th}>Amount</th>
                    <th style={s.th}>Reference</th>
                    <th style={s.th}>Provider</th>
                    <th style={s.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={s.tr}>
                      <td style={s.td}>{fmtDate(p.created_at)}</td>
                      <td style={s.td}>{fmt(p.amount, p.currency)}</td>
                      <td style={{ ...s.td, color: 'var(--muted)' }}>{p.reference ?? '—'}</td>
                      <td style={s.td}>{p.provider}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, color: STATUS_COLOR[p.status] ?? 'var(--muted)', background: `${STATUS_COLOR[p.status] ?? '#888'}18` }}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px' },
  container: { maxWidth: 860, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  nav: { display: 'flex', alignItems: 'center', gap: 20 },
  navLink: { fontSize: 14, color: 'var(--muted)', textDecoration: 'none' },
  navActive: { fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' },
  logoutBtn: { fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' },
  title: { fontSize: 28, fontWeight: 800, margin: '0 0 24px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 },
  statCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' },
  statLabel: { fontSize: 12, color: 'var(--muted)', margin: '0 0 5px', fontWeight: 500 },
  statValue: { fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px' },
  cardTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 16px' },
  actionBtn: { display: 'block', width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--text)', boxSizing: 'border-box' },
  emptyState: { textAlign: 'center', padding: '32px 0 16px' },
  emptyTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 6px' },
  emptySub: { color: 'var(--muted)', fontSize: 14, margin: '0 0 20px' },
  emptyLink: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', background: 'var(--bg)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)' },
  copyBtn: { padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 12px', verticalAlign: 'middle' },
  badge: { display: 'inline-block', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700 },
};
