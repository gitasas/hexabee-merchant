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

export default function MerchantDashboardPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [currency, setCurrency] = useState('EUR');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Onboarding check first
    fetch('/api/merchant/profile')
      .then(r => r.json())
      .then(data => {
        if (!data.stripe_account_id || !data.business_country) {
          router.push('/merchant/onboarding');
          return;
        }

        // Profile complete — load payments
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
  const hexabeeFee = paidPayments.reduce((sum, p) => sum + Number(p.amount) * 0.02, 0);

  return (
    <main style={s.page}>
      <div style={s.container}>
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
            <p style={s.statValue}>{paidPayments.length}</p>
          </div>
          <div style={s.statCard}>
            <p style={s.statLabel}>HexaBee Fee</p>
            <p style={s.statValue}>{fmt(hexabeeFee.toFixed(2), currency)}</p>
          </div>
        </div>

        <div style={s.card}>
          <h2 style={s.cardTitle}>Payment history</h2>

          {loading && <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</p>}

          {!loading && payments.length === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>No payments yet.</p>
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
                        <span style={{ ...s.badge, color: STATUS_COLOR[p.status] ?? 'var(--muted)', background: `${STATUS_COLOR[p.status]}18` }}>
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
  container: { maxWidth: 800, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  nav: { display: 'flex', alignItems: 'center', gap: 20 },
  navLink: { fontSize: 14, color: 'var(--muted)', textDecoration: 'none' },
  navActive: { fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' },
  logoutBtn: { fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' },
  title: { fontSize: 28, fontWeight: 800, margin: '0 0 24px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 },
  statCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' },
  statLabel: { fontSize: 13, color: 'var(--muted)', margin: '0 0 6px' },
  statValue: { fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px' },
  cardTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 20px' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 12px', verticalAlign: 'middle' },
  badge: { display: 'inline-block', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700 },
};
