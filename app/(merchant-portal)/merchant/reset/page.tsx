'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLang, LangToggle } from '../../i18n';

function ResetContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLang();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  // The key, never the translated sentence. Storing the sentence froze it in
  // whichever language was active when the error happened, so switching to
  // English afterwards left a Lithuanian message on screen - reported
  // 2026-10-05. Resolved at render time instead, so the toggle retranslates it.
  const [errorKey, setErrorKey] = useState<'mismatch' | 'short' | 'invalid' | 'failed' | null>(null);
  const [loading, setLoading] = useState(false);

  const errorText = errorKey && {
    mismatch: t.auth.resetMismatch,
    short: t.auth.resetTooShort,
    invalid: t.auth.resetInvalidLink,
    failed: t.auth.resetFailed,
  }[errorKey];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    // Checked here as well as on the server. Catching it before the request is
    // what stops a typo in the second box from spending the link.
    if (password !== repeat) {
      setErrorKey('mismatch');
      return;
    }
    if (password.length < 8) {
      setErrorKey('short');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/merchant/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        // Already signed in by the route that set the password.
        router.push('/merchant/dashboard');
        return;
      }
      setErrorKey(data.error === 'password_too_short' ? 'short' : 'invalid');
    } catch {
      setErrorKey('failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <LangToggle />
        </div>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
        <h1 style={s.title}>{t.auth.resetTitle}</h1>

        {/* A link with nothing after it is somebody who opened the page by
            hand, or a mail client that mangled the URL. Say so rather than
            showing a form that cannot work. */}
        {!token ? (
          <>
            <p style={s.body}>{t.auth.resetNoToken}</p>
            <p style={s.link}>
              <a href="/merchant/forgot" style={{ color: '#b45309' }}>{t.auth.forgotSend}</a>
            </p>
          </>
        ) : (
          <>
            <p style={s.body}>{t.auth.resetSub}</p>
            <form onSubmit={handleSubmit} style={s.form}>
              <input
                style={s.input}
                type="password"
                placeholder={t.auth.resetNewPassword}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
              />
              <input
                style={s.input}
                type="password"
                placeholder={t.auth.resetRepeat}
                value={repeat}
                onChange={e => setRepeat(e.target.value)}
                required
              />
              {errorText && <p style={s.error}>{errorText}</p>}
              <button style={s.btn} type="submit" disabled={loading}>
                {loading ? t.auth.resetSaving : t.auth.resetSave}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

export default function MerchantResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetContent />
    </Suspense>
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
  error: { color: '#dc2626', fontSize: 13, margin: 0 },
  link: { marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' },
};
