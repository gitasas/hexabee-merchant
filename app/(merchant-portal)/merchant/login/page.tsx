'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MerchantLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch('/api/merchant/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Login failed');
      return;
    }

    router.push('/merchant/dashboard');
  }

  return (
    <main style={s.page}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 48, marginBottom: 24 }} />
        <h1 style={s.title}>Merchant Login</h1>

        <form onSubmit={handleSubmit} style={s.form}>
          <input
            style={s.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            style={s.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          {error && <p style={s.error}>{error}</p>}

          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <p style={s.link}>
          No account?{' '}
          <a href="/merchant/register" style={{ color: '#b45309' }}>Register</a>
        </p>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '40px 36px', maxWidth: 400, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  title: { fontSize: 22, fontWeight: 800, margin: '0 0 24px' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: { padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--bg)' },
  btn: { padding: '13px', borderRadius: 12, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 4 },
  error: { color: '#dc2626', fontSize: 13, margin: 0 },
  link: { marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' },
};
