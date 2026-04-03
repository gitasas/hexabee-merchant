export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '1rem',
      }}
    >
      <section className="card" style={{ width: '100%', maxWidth: '420px' }}>
        <h1 style={{ marginTop: 0 }}>Merchant Login</h1>
        <p style={{ color: 'var(--muted)' }}>Placeholder screen (mock only).</p>

        <div style={{ display: 'grid', gap: '0.8rem' }}>
          <input
            type="email"
            placeholder="merchant@hexabee.com"
            style={{ padding: '0.7rem', border: '1px solid var(--border)', borderRadius: '10px' }}
          />
          <input
            type="password"
            placeholder="••••••••"
            style={{ padding: '0.7rem', border: '1px solid var(--border)', borderRadius: '10px' }}
          />
          <button
            type="button"
            style={{
              padding: '0.75rem',
              border: 0,
              borderRadius: '10px',
              background: 'var(--brand)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign in (mock)
          </button>
        </div>
      </section>
    </main>
  );
}
