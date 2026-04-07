export default function InstallPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '1rem',
      }}
    >
      <section className="card" style={{ width: '100%', maxWidth: '520px', padding: '1.5rem' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem',
            fontWeight: 700,
          }}
        >
          <span
            aria-hidden
            style={{
              width: '1.5rem',
              height: '1.5rem',
              display: 'inline-grid',
              placeItems: 'center',
              borderRadius: '999px',
              background: 'var(--brand)',
            }}
          >
            ⬢
          </span>
          <span>HexaBee</span>
        </div>

        <h1 style={{ margin: '0 0 0.6rem 0' }}>Install HexaBee Plugin</h1>
        <p style={{ marginTop: 0, color: 'var(--muted)' }}>
          Scan and pay invoices directly from your email.
        </p>

        <div style={{ display: 'grid', gap: '0.75rem', margin: '1.25rem 0' }}>
          <button
            type="button"
            style={{
              padding: '0.8rem 1rem',
              border: 0,
              borderRadius: '10px',
              background: 'var(--brand)',
              color: '#1a1a1a',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Install for Gmail
          </button>

          <button
            type="button"
            disabled
            style={{
              padding: '0.8rem 1rem',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              background: '#f9fafb',
              color: 'var(--muted)',
              fontWeight: 600,
              cursor: 'not-allowed',
            }}
          >
            Install for Outlook (Coming soon)
          </button>
        </div>

        <p style={{ marginBottom: 0, color: 'var(--muted)', fontSize: '0.95rem' }}>
          After installing, return to your invoice and click &quot;Open in HexaBee Plugin&quot;
        </p>
      </section>
    </main>
  );
}
