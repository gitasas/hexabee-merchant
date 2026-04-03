const mockStats = [
  { label: 'Today Orders', value: 12 },
  { label: 'Pending Fulfillment', value: 4 },
  { label: 'Revenue (Mock)', value: '$1,280' },
];

export default function DashboardPage() {
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
    </div>
  );
}
