'use client';

export default function PaymentFailedPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
      <section className="card" style={{ width: '100%', maxWidth: '540px', textAlign: 'center' }}>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem', letterSpacing: '0.04em' }}>PAYMENT UPDATE</p>
        <h1 style={{ margin: '0.6rem 0 0.8rem', fontSize: '1.8rem' }}>Payment failed or was cancelled</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          We could not complete this payment. Please return to the payment link and try again, or use another bank.
        </p>
        <div style={{ marginTop: '1.2rem' }}>
          <button type="button" onClick={() => window.close()} style={{ background: 'transparent', color: '#7a5b00', border: '1px solid #7a5b00', borderRadius: '10px', padding: '0.65rem 1.2rem', fontWeight: 600, cursor: 'pointer' }}>Close window</button>
        </div>
      </section>
    </main>
  );
}
