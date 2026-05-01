'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function MerchantRegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch('/api/merchant/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, businessName }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Registration failed');
      return;
    }

    router.push('/merchant/dashboard');
  }

  return (
    <main style={s.page}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 48, marginBottom: 24 }} />
        <h1 style={s.title}>Create merchant account</h1>

        <a href="/api/merchant/auth/google" style={s.googleBtn}>
          <GoogleIcon />
          Sign up with Google
        </a>

        <div style={s.divider}>
          <span style={s.dividerLine} />
          <span style={s.dividerText}>or</span>
          <span style={s.dividerLine} />
        </div>

        <form onSubmit={handleSubmit} style={s.form}>
          <input
            style={s.input}
            type="text"
            placeholder="Business name"
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
          />
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
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          {error && <p style={s.error}>{error}</p>}

          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p style={s.link}>
          Already have an account?{' '}
          <a href="/merchant/login" style={{ color: '#b45309' }}>Log in</a>
        </p>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '40px 36px', maxWidth: 400, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  title: { fontSize: 22, fontWeight: 800, margin: '0 0 20px' },
  googleBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 14, cursor: 'pointer', textDecoration: 'none', boxSizing: 'border-box' },
  divider: { display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' },
  dividerLine: { flex: 1, height: 1, background: 'var(--border)' },
  dividerText: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: { padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--bg)' },
  btn: { padding: '13px', borderRadius: 12, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 4 },
  error: { color: '#dc2626', fontSize: 13, margin: 0 },
  link: { marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' },
};
