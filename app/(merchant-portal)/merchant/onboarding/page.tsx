'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const COUNTRY_CURRENCY: Record<string, string> = {
  GB: 'GBP', DE: 'EUR', FR: 'EUR', BE: 'EUR', NL: 'EUR', AT: 'EUR', PL: 'PLN',
};

const COUNTRIES = [
  { code: 'GB', label: '🇬🇧 United Kingdom' },
  { code: 'DE', label: '🇩🇪 Germany' },
  { code: 'FR', label: '🇫🇷 France' },
  { code: 'BE', label: '🇧🇪 Belgium' },
  { code: 'NL', label: '🇳🇱 Netherlands' },
  { code: 'AT', label: '🇦🇹 Austria' },
  { code: 'PL', label: '🇵🇱 Poland' },
];

type Profile = {
  stripe_account_id: string | null;
  business_country: string | null;
  business_name: string | null;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [country, setCountry] = useState('GB');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => r.json())
      .then(data => {
        setProfile(data);
        setBusinessName(data.business_name ?? '');
        setCountry(data.business_country ?? 'GB');
      });
  }, []);

  async function handleConnect() {
    setConnectLoading(true);
    setConnectMsg(null);
    try {
      const res = await fetch('/api/connect/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnPath: '/merchant/onboarding' }),
      });
      const data = await res.json();
      if (!data.ok) { setConnectMsg(data.error ?? 'Failed to start onboarding'); return; }
      window.location.href = data.url;
    } catch {
      setConnectMsg('Something went wrong. Please try again.');
    } finally {
      setConnectLoading(false);
    }
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSavingInfo(true);
    setInfoMsg(null);
    const res = await fetch('/api/merchant/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: businessName || null,
        businessCountry: country,
        businessCurrency: COUNTRY_CURRENCY[country] ?? 'EUR',
      }),
    });
    setSavingInfo(false);
    if (res.ok) {
      setProfile(p => p ? { ...p, business_name: businessName, business_country: country } : p);
      setInfoMsg('Saved');
    } else {
      const d = await res.json();
      setInfoMsg(d.error ?? 'Failed to save');
    }
  }

  const step2Done = !!profile?.stripe_account_id;
  const step3Done = !!profile?.business_country && !!profile?.business_name;
  const allDone = step2Done && step3Done;

  // Determine current active step (first incomplete)
  const activeStep = !step2Done ? 2 : !step3Done ? 3 : 4;

  if (!profile) {
    return <main style={s.page}><p style={{ color: 'var(--muted)' }}>Loading...</p></main>;
  }

  return (
    <main style={s.page}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 44, display: 'block', margin: '0 auto 28px' }} />
        <h1 style={s.title}>Set up your account</h1>
        <p style={s.sub}>Complete these steps to start accepting payments.</p>

        {/* Step indicators */}
        <div style={s.stepsRow}>
          {[1, 2, 3].map((n, i) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{
                ...s.stepDot,
                ...(n < activeStep ? s.stepDone : n === activeStep ? s.stepActive : s.stepFuture),
              }}>
                {n < activeStep ? '✓' : n}
              </div>
              {i < 2 && <div style={{ ...s.stepLine, background: n < activeStep ? '#16a34a' : 'var(--border)' }} />}
            </div>
          ))}
        </div>

        {/* Step 1 */}
        <div style={s.step}>
          <div style={s.stepHeader}>
            <span style={{ ...s.stepNum, background: '#f0fdf4', color: '#16a34a' }}>✓</span>
            <div>
              <p style={s.stepTitle}>Account created</p>
              <p style={s.stepDesc}>Your HexaBee merchant account is ready.</p>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ ...s.step, ...(activeStep === 2 ? s.stepCurrent : {}) }}>
          <div style={s.stepHeader}>
            <span style={{ ...s.stepNum, ...(step2Done ? { background: '#f0fdf4', color: '#16a34a' } : activeStep === 2 ? { background: 'var(--brand)', color: '#111' } : { background: 'var(--bg)', color: 'var(--muted)' }) }}>
              {step2Done ? '✓' : '2'}
            </span>
            <div style={{ flex: 1 }}>
              <p style={s.stepTitle}>Connect Stripe account</p>
              <p style={s.stepDesc}>Required to receive card payments through HexaBee.</p>
              {step2Done ? (
                <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, margin: '6px 0 0' }}>
                  ✅ Connected: {profile.stripe_account_id}
                </p>
              ) : activeStep === 2 ? (
                <div style={{ marginTop: 12 }}>
                  <button style={s.btn} onClick={handleConnect} disabled={connectLoading}>
                    {connectLoading ? 'Redirecting...' : 'Connect Stripe account'}
                  </button>
                  {connectMsg && <p style={{ fontSize: 13, color: '#dc2626', margin: '8px 0 0' }}>{connectMsg}</p>}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div style={{ ...s.step, ...(activeStep === 3 ? s.stepCurrent : {}) }}>
          <div style={s.stepHeader}>
            <span style={{ ...s.stepNum, ...(step3Done ? { background: '#f0fdf4', color: '#16a34a' } : activeStep === 3 ? { background: 'var(--brand)', color: '#111' } : { background: 'var(--bg)', color: 'var(--muted)' }) }}>
              {step3Done ? '✓' : '3'}
            </span>
            <div style={{ flex: 1 }}>
              <p style={s.stepTitle}>Business information</p>
              <p style={s.stepDesc}>Tell us where you&apos;re based so we can show the right payment methods.</p>
              {step3Done ? (
                <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, margin: '6px 0 0' }}>
                  ✅ {profile.business_name} · {profile.business_country}
                </p>
              ) : activeStep === 3 ? (
                <form onSubmit={handleSaveInfo} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    style={s.input}
                    placeholder="Business name"
                    value={businessName}
                    onChange={e => setBusinessName(e.target.value)}
                    required
                  />
                  <select
                    style={s.input}
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                  >
                    {COUNTRIES.map(c => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                  <button style={s.btn} type="submit" disabled={savingInfo}>
                    {savingInfo ? 'Saving...' : 'Save & continue'}
                  </button>
                  {infoMsg && <p style={{ fontSize: 13, color: infoMsg === 'Saved' ? '#16a34a' : '#dc2626', margin: 0 }}>{infoMsg}</p>}
                </form>
              ) : null}
            </div>
          </div>
        </div>

        {allDone && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <p style={{ color: '#16a34a', fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
              🎉 All set! Your account is ready.
            </p>
            <button style={s.btn} onClick={() => router.push('/merchant/dashboard')}>
              Go to Dashboard →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 16px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '40px 36px', maxWidth: 480, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  title: { fontSize: 24, fontWeight: 800, margin: '0 0 6px', textAlign: 'center' },
  sub: { color: 'var(--muted)', fontSize: 14, margin: '0 0 28px', textAlign: 'center' },
  stepsRow: { display: 'flex', alignItems: 'center', marginBottom: 28 },
  stepDot: { width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 },
  stepDone: { background: '#f0fdf4', color: '#16a34a' },
  stepActive: { background: 'var(--brand)', color: '#111' },
  stepFuture: { background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' },
  stepLine: { flex: 1, height: 2, margin: '0 4px' },
  step: { borderRadius: 12, padding: '16px', marginBottom: 10 },
  stepCurrent: { background: 'var(--bg)', border: '1px solid var(--border)' },
  stepHeader: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  stepNum: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  stepTitle: { fontSize: 15, fontWeight: 700, margin: 0 },
  stepDesc: { fontSize: 13, color: 'var(--muted)', margin: '3px 0 0' },
  btn: { padding: '11px 20px', borderRadius: 10, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 14, cursor: 'pointer', width: '100%' },
  input: { padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--surface)', width: '100%', boxSizing: 'border-box' },
};
