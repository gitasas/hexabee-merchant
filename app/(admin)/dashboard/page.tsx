import Link from 'next/link';
import { listStoredPayments } from '@/lib/payments-store';

const mockStats = [
  { label: 'Today Orders', value: 12 },
  { label: 'Pending Fulfillment', value: 4 },
  { label: 'Revenue (Mock)', value: '$1,280' },
];

function formatAmount(amountInMinor: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amountInMinor / 100);
}

function formatDate(iso?: string) {
  if (!iso) {
    return '—';
  }

  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}

export default async function DashboardPage() {
  const payments = await listStoredPayments();

  return (
    <div>
      <h1 style={{ marginTop: 0, fontSize: '1.75rem' }}>Dashboard</h1>
      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        Welcome back! Here is a quick snapshot of your store.
      </p>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginTop: '1.5rem',
        }}
      >
        {mockStats.map((item) => (
          <div key={item.label} className="card">
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>{item.label}</p>
            <h3 style={{ margin: '0.6rem 0 0', fontSize: '1.5rem' }}>{item.value}</h3>
          </div>
        ))}
      </section>

      <section className="card" style={{ marginTop: '1.2rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Payments</h2>
        <p style={{ marginTop: '0.45rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
          TrueLayer payment lifecycle tracking from create → webhook updates.
        </p>

        {payments.length === 0 ? (
          <p style={{ marginBottom: 0, color: 'var(--muted)' }}>No payments yet.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '0.5rem 0.3rem' }}>Status</th>
                  <th style={{ padding: '0.5rem 0.3rem' }}>Failure reason</th>
                  <th style={{ padding: '0.5rem 0.3rem' }}>TrueLayer payment id</th>
                  <th style={{ padding: '0.5rem 0.3rem' }}>Reference</th>
                  <th style={{ padding: '0.5rem 0.3rem' }}>Amount</th>
                  <th style={{ padding: '0.5rem 0.3rem' }}>Created</th>
                  <th style={{ padding: '0.5rem 0.3rem' }}>Updated</th>
                  <th style={{ padding: '0.5rem 0.3rem' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '0.6rem 0.3rem', textTransform: 'capitalize' }}>{payment.status.replaceAll('_', ' ')}</td>
                    <td style={{ padding: '0.6rem 0.3rem' }}>{payment.failureReason || '—'}</td>
                    <td style={{ padding: '0.6rem 0.3rem', fontFamily: 'monospace' }}>{payment.truelayerPaymentId}</td>
                    <td style={{ padding: '0.6rem 0.3rem' }}>{payment.reference}</td>
                    <td style={{ padding: '0.6rem 0.3rem' }}>{formatAmount(payment.amountInMinor, payment.currency)}</td>
                    <td style={{ padding: '0.6rem 0.3rem' }}>{formatDate(payment.createdAt)}</td>
                    <td style={{ padding: '0.6rem 0.3rem' }}>{formatDate(payment.updatedAt)}</td>
                    <td style={{ padding: '0.6rem 0.3rem' }}>
                      <Link href={`/dashboard/payments/${payment.id}`} style={{ color: '#7a5b00', fontWeight: 600 }}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
