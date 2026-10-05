'use client';

import { useState } from 'react';
import { useLang, LangToggle } from '../../i18n';

/**
 * Ask for a password reset link.
 *
 * The answer is the same whatever happened: "if that address has an account, a
 * link is on its way". A page that said "no such account" would turn this form
 * into a way of checking which addresses are registered with HexaBee - and a
 * merchant's own customers are the obvious list to try.
 *
 * It is also the same answer when the backend rate-limited the request or the
 * mail failed, which is why the text says "check your inbox" rather than
 * promising delivery.
 */
export default function ForgotPasswordPage() {
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/merchant/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Even a network failure gets the same screen: telling the difference
      // here would tell it to everyone else too.
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <LangToggle />
        </div>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
        <h1 style={s.title}>{t.auth.forgotTitle}</h1>

        {sent ? (
          <>
            <p style={s.body}>{t.auth.forgotSent}</p>
            <p style={s.link}>
              <a href="/merchant/login" style={{ color: '#b45309' }}>{t.auth.backToLogin}</a>
            </p>
          </>
        ) : (
          <>
            <p style={s.body}>{t.auth.forgotSub}</p>
            <form onSubmit={handleSubmit} style={s.form}>
              <input
                style={s.input}
                type="email"
                placeholder={t.auth.emailPlaceholder}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
              <button style={s.btn} type="submit" disabled={loading}>
                {loading ? t.auth.forgotSending : t.auth.forgotSend}
              </button>
            </form>
            <p style={s.link}>
              <a href="/merchant/login" style={{ color: '#b45309' }}>{t.auth.backToLogin}</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '40px 36px', maxWidth: 400, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  title: { fontSize: 22, fontWeight: 800, margin: '0 0 12px' },
  body: { fontSize: 14, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 18px' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: { padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--bg)' },
  btn: { padding: '13px', borderRadius: 12, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 4 },
  link: { marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' },
};
