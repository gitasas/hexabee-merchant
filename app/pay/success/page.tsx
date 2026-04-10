import Link from 'next/link';

export default function PaymentSuccessPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
      <section className="card" style={{ width: '100%', maxWidth: '540px', textAlign: 'center' }}>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem', letterSpacing: '0.04em' }}>PAYMENT UPDATE</p>
        <h1 style={{ margin: '0.6rem 0 0.8rem', fontSize: '1.8rem' }}>Payment initiated successfully</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Your bank authorization has been completed. We are now waiting for final settlement confirmation.
        </p>
        <div style={{ marginTop: '1.2rem' }}>
          <Link href="/dashboard" style={{ color: '#7a5b00', fontWeight: 600 }}>
            Return to merchant admin
          </Link>
        </div>
      </section>
    </main>
  );
}
