export default function PaymentSuccessPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
      <section style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: '14px',
        padding: '2rem',
        width: '100%',
        maxWidth: '480px',
        textAlign: 'center',
        boxShadow: '0 4px 14px rgba(0,0,0,0.04)'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
        <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.6rem' }}>Payment successful</h1>
        <p style={{ margin: 0, color: '#6b7280' }}>
          Your payment has been processed. The merchant will receive confirmation shortly.
        </p>
      </section>
    </main>
  );
}
