import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStoredPaymentById } from '@/lib/payments-store';

function toPrettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
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

function formatAmount(amountInMinor: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amountInMinor / 100);
}

export default async function PaymentDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payment = await getStoredPaymentById(id);

  if (!payment) {
    notFound();
  }

  return (
    <div style={{ maxWidth: '1000px' }}>
      <Link href="/dashboard" style={{ color: '#7a5b00', fontWeight: 600 }}>
        ← Back to payments
      </Link>
      <h1 style={{ marginTop: '0.8rem', fontSize: '1.6rem' }}>Payment details</h1>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', rowGap: '0.55rem', columnGap: '1rem' }}>
          <strong>Status</strong>
          <span style={{ textTransform: 'capitalize' }}>{payment.status.replaceAll('_', ' ')}</span>

          <strong>Failure reason</strong>
          <span>{payment.failureReason || '—'}</span>

          <strong>TrueLayer payment id</strong>
          <span style={{ fontFamily: 'monospace' }}>{payment.truelayerPaymentId}</span>

          <strong>Reference</strong>
          <span>{payment.reference}</span>

          <strong>Amount</strong>
          <span>{formatAmount(payment.amountInMinor, payment.currency)}</span>

          <strong>Created at</strong>
          <span>{formatDate(payment.createdAt)}</span>

          <strong>Updated at</strong>
          <span>{formatDate(payment.updatedAt)}</span>

          <strong>Last webhook at</strong>
          <span>{formatDate(payment.lastWebhookAt)}</span>
        </div>
      </section>

      <section className="card" style={{ marginTop: '0.9rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Webhook timeline</h2>
        {payment.events.length === 0 ? (
          <p style={{ color: 'var(--muted)', marginBottom: 0 }}>No webhook events captured yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            {payment.events.map((event, index) => (
              <div key={`${event.eventId ?? 'event'}-${index}`} style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '0.75rem' }}>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--muted)' }}>{formatDate(event.receivedAt)}</p>
                <p style={{ margin: '0.35rem 0 0', fontWeight: 700 }}>
                  {event.type || 'payment.status.updated'} → {event.status.replaceAll('_', ' ')}
                </p>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)' }}>Failure reason: {event.failureReason || '—'}</p>
                <pre
                  style={{
                    margin: '0.75rem 0 0',
                    background: '#0f172a',
                    color: '#e2e8f0',
                    borderRadius: '8px',
                    padding: '0.7rem',
                    overflowX: 'auto',
                    fontSize: '0.74rem',
                  }}
                >
                  {toPrettyJson(event.payload)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
