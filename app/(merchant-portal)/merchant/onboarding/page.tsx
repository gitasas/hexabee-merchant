'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang, LangToggle } from '../../i18n';

const COUNTRIES = [
  // Only where HexaBee can actually take a payment today. The UK runs on Stripe;
  // the rest are Montonio's payment-initiation countries. Offering anywhere else
  // sells a merchant a setup that ends in a checkout with no working method.
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  { code: 'LT', name: 'Lithuania',      flag: '🇱🇹', currency: 'EUR' },
  { code: 'LV', name: 'Latvia',         flag: '🇱🇻', currency: 'EUR' },
  { code: 'EE', name: 'Estonia',        flag: '🇪🇪', currency: 'EUR' },
  { code: 'FI', name: 'Finland',        flag: '🇫🇮', currency: 'EUR' },
  { code: 'PL', name: 'Poland',         flag: '🇵🇱', currency: 'PLN' },
];

/**
 * The saved country may predate the list above. Keep it selectable rather than
 * letting the <select> fall back to the first option, which would silently move
 * the merchant to the UK the next time they pressed save.
 */
function countryOptions(current?: string | null) {
  if (current && !COUNTRIES.some(c => c.code === current)) {
    return [...COUNTRIES, { code: current, name: current, flag: '\u{1F3F3}', currency: 'EUR' }];
  }
  return COUNTRIES;
}


/**
 * Countries Montonio's payment initiation covers.
 *
 * A merchant here does not need Stripe Connect at all — their customers pay
 * straight from bank to bank. Asking them to open a Stripe account would be
 * asking for something they will never use, which is why the country question
 * now comes before anything else in this flow.
 */
const MONTONIO_COUNTRIES = new Set(['EE', 'LV', 'LT', 'FI', 'PL']);

type Profile = {
  stripe_account_id: string | null;
  business_country: string | null;
  business_name: string | null;
  company_code: string | null;
  iban: string | null;
  montonio_configured: boolean;
  montonio_sandbox?: boolean;
  montonio_sandbox_available?: boolean;
  onboarding_country_set: boolean | null;
};

export default function OnboardingPage() {
  const router = useRouter();
  const { lang, t } = useLang();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [country, setCountry] = useState('GB');
  const [companyCode, setCompanyCode] = useState('');
  const [iban, setIban] = useState('');
  const [sandboxSaving, setSandboxSaving] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [keysSaving, setKeysSaving] = useState(false);
  const [keysMsg, setKeysMsg] = useState<string | null>(null);
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
        setCompanyCode(data.company_code ?? '');
        setIban(data.iban ?? '');
      });
  }, []);

  /**
   * Staging only: run on HexaBee's sandbox store instead of pasting keys, so
   * anyone can finish onboarding and take a test payment. The server refuses
   * this unless the environment allows it; the button is hidden unless it does.
   */
  async function handleUseSandbox() {
    setSandboxSaving(true);
    setKeysMsg(null);
    try {
      const res = await fetch('/api/merchant/montonio-sandbox', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setKeysMsg(data?.error ?? t.common.saveFailed); return; }
      setProfile(p => (p ? { ...p, montonio_configured: true, montonio_sandbox: true } : p));
    } catch {
      setKeysMsg(t.common.saveFailed);
    } finally {
      setSandboxSaving(false);
    }
  }

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
      if (!data.ok) { setConnectMsg(data.error ?? t.onboarding.onboardFailed); return; }
      window.location.href = data.url;
    } catch {
      setConnectMsg(t.common.genericError);
    } finally {
      setConnectLoading(false);
    }
  }

  /**
   * Nothing is stored until Montonio accepts the pair, so a mistyped key is
   * caught here — by the person who typed it, seconds later — instead of
   * surfacing as a declined payment in front of a customer days from now.
   */
  async function handleSaveKeys(e: React.FormEvent) {
    e.preventDefault();
    setKeysSaving(true);
    setKeysMsg(null);
    try {
      const res = await fetch('/api/merchant/montonio-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: accessKey.trim(), secretKey: secretKey.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setKeysMsg(data?.error ?? t.common.saveFailed);
        return;
      }
      setKeysMsg(t.onboarding.keysStored);
      setProfile(p => (p ? { ...p, montonio_configured: true } : p));
      setAccessKey('');
      setSecretKey('');
    } catch {
      setKeysMsg(t.common.saveFailed);
    } finally {
      setKeysSaving(false);
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
        companyCode: companyCode.trim() || null,
        // The IBAN is where the payer's money lands and how the Gmail extension
        // recognises the merchant on an invoice; a Baltic merchant without one
        // cannot be paid. GB merchants give a sort code later, in Settings.
        ...(MONTONIO_COUNTRIES.has(country) ? { iban: iban.trim() } : {}),
        businessCurrency: COUNTRIES.find(c => c.code === country)?.currency ?? 'EUR',
      }),
    });
    setSavingInfo(false);
    if (res.ok) {
      setProfile(p => p ? { ...p, business_name: businessName, business_country: country, company_code: companyCode.trim() || null, iban: iban.trim() || p.iban, onboarding_country_set: true } : p);
      setInfoMsg('Saved');
    } else {
      const d = await res.json();
      setInfoMsg(d.error ?? t.common.saveFailed);
    }
  }

  // Business details come first: until we know the country we cannot tell whether
  // this merchant needs a Stripe account or a Montonio store, and guessing wrong
  // means sending them through a setup they will never use.
  // Not `business_country`: it defaults to 'GB', and `business_name` arrives
  // pre-filled from the Google profile — so both look answered on a brand-new
  // account. Only an explicit answer counts, otherwise the merchant is skipped
  // past the one question that decides their entire setup.
  const step2Done = !!profile?.onboarding_country_set && !!profile?.business_name;
  // While the form is open, follow what they are choosing right now.
  const isBaltic = MONTONIO_COUNTRIES.has(step2Done ? (profile?.business_country ?? country) : country);
  // On the Baltic rail the merchant has nothing left to do — the store is opened
  // for them, so this step reports progress rather than asking for an action.
  const step3Done = isBaltic ? !!profile?.montonio_configured : !!profile?.stripe_account_id;
  const allDone = step2Done && step3Done;

  const activeStep = !step2Done ? 2 : !step3Done ? 3 : 4;

  if (!profile) {
    return <main style={s.page}><p style={{ color: 'var(--muted)' }}>{t.onboarding.loading}</p></main>;
  }

  return (
    <main style={s.page}>
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <LangToggle />
        </div>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 20px' }} />
        <h1 style={s.title}>{t.onboarding.title}</h1>
        <p style={s.sub}>{t.onboarding.sub}</p>

        {/* Step indicators */}
        <div style={s.stepsRow}>
          {/* Dots and connectors are direct siblings: wrapping each step in its
              own flex:1 box gave the three equal thirds of the card, which no
              amount of justifyContent on the parent could centre, and left the
              last dot pinned to the left of its own third. */}
          {[1, 2, 3].map((n, i) => (
            <Fragment key={n}>
              {i > 0 && (
                <div style={{ ...s.stepLine, background: n <= activeStep ? '#16a34a' : 'var(--border)' }} />
              )}
              <div style={{
                ...s.stepDot,
                ...(n < activeStep ? s.stepDone : n === activeStep ? s.stepActive : s.stepFuture),
              }}>
                {n < activeStep ? '✓' : n}
              </div>
            </Fragment>
          ))}
        </div>

        {/* Step 1 */}
        <div style={s.step}>
          <div style={s.stepHeader}>
            <span style={{ ...s.stepNum, background: '#f0fdf4', color: '#16a34a' }}>✓</span>
            <div>
              <p style={s.stepTitle}>{t.onboarding.accountCreated}</p>
              <p style={s.stepDesc}>{t.onboarding.accountCreatedSub}</p>
            </div>
          </div>
        </div>

        {/* Step 2 — business details, and the country that decides the rail */}
        <div style={{ ...s.step, ...(activeStep === 2 ? s.stepCurrent : {}) }}>
          <div style={s.stepHeader}>
            <span style={{ ...s.stepNum, ...(step2Done ? { background: '#f0fdf4', color: '#16a34a' } : activeStep === 2 ? { background: 'var(--brand)', color: '#111' } : { background: 'var(--bg)', color: 'var(--muted)' }) }}>
              {step2Done ? '\u2713' : '2'}
            </span>
            <div style={{ flex: 1 }}>
              <p style={s.stepTitle}>{t.onboarding.businessInfo}</p>
              <p style={s.stepDesc}>{t.onboarding.businessInfoSub}</p>
              {step2Done ? (
                <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, margin: '6px 0 0' }}>
                  {'\u2705'} {profile.business_name} · {profile.business_country}
                  {profile.company_code ? ` · ${profile.company_code}` : ''}
                </p>
              ) : activeStep === 2 ? (
                <form onSubmit={handleSaveInfo} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    style={s.input}
                    placeholder={t.onboarding.businessNamePlaceholder}
                    value={businessName}
                    onChange={e => setBusinessName(e.target.value)}
                    required
                  />
                  <select
                    style={s.input}
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                  >
                    {countryOptions(country).map(c => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {lang === 'lt' ? (t.countryNames[c.code] ?? c.name) : c.name}
                      </option>
                    ))}
                  </select>
                  {MONTONIO_COUNTRIES.has(country) && (
                    <>
                      <input
                        style={s.input}
                        placeholder={t.onboarding.companyCodePlaceholder}
                        value={companyCode}
                        onChange={e => setCompanyCode(e.target.value)}
                        required
                      />
                      <input
                        style={s.input}
                        placeholder={t.onboarding.ibanPlaceholder}
                        value={iban}
                        onChange={e => setIban(e.target.value)}
                        autoComplete="off"
                        required
                      />
                    </>
                  )}
                  <button style={s.btn} type="submit" disabled={savingInfo}>
                    {savingInfo ? t.onboarding.saving : t.onboarding.saveContinue}
                  </button>
                  {infoMsg && <p style={{ fontSize: 13, color: infoMsg === 'Saved' ? '#16a34a' : '#dc2626', margin: 0 }}>{infoMsg === 'Saved' ? t.common.saved : infoMsg}</p>}
                </form>
              ) : null}
            </div>
          </div>
        </div>

        {/* Step 3 — the rail. Baltic merchants have nothing to do here. */}
        <div style={{ ...s.step, ...(activeStep === 3 ? s.stepCurrent : {}) }}>
          <div style={s.stepHeader}>
            <span style={{ ...s.stepNum, ...(step3Done ? { background: '#f0fdf4', color: '#16a34a' } : activeStep === 3 ? { background: 'var(--brand)', color: '#111' } : { background: 'var(--bg)', color: 'var(--muted)' }) }}>
              {step3Done ? '\u2713' : '3'}
            </span>
            <div style={{ flex: 1 }}>
              <p style={s.stepTitle}>{isBaltic ? t.onboarding.bankSetup : t.onboarding.connectStripe}</p>
              <p style={s.stepDesc}>{isBaltic ? t.onboarding.bankSetupSub : t.onboarding.connectStripeSub}</p>

              {isBaltic ? (
                step3Done ? (
                  <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, margin: '6px 0 0' }}>
                    {'\u2705'} {profile.montonio_sandbox ? t.onboarding.sandboxReady : t.onboarding.bankReady}
                  </p>
                ) : activeStep === 3 ? (
                  <div style={{ marginTop: 10 }}>
                    <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
                      {'\u23F3'} {t.onboarding.bankPending}
                    </p>
                    <form onSubmit={handleSaveKeys} style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t.onboarding.keysTitle}</p>
                      <input
                        style={s.input}
                        placeholder={t.onboarding.accessKeyPlaceholder}
                        value={accessKey}
                        autoComplete="off"
                        onChange={e => setAccessKey(e.target.value)}
                        required
                      />
                      <input
                        style={s.input}
                        type="password"
                        placeholder={t.onboarding.secretKeyPlaceholder}
                        value={secretKey}
                        autoComplete="new-password"
                        onChange={e => setSecretKey(e.target.value)}
                        required
                      />
                      <button style={s.btn} type="submit" disabled={keysSaving}>
                        {keysSaving ? t.onboarding.checkingKeys : t.onboarding.connectStore}
                      </button>
                      {keysMsg && (
                        <p style={{ fontSize: 13, margin: 0, color: keysMsg === t.onboarding.keysStored ? '#16a34a' : '#dc2626' }}>
                          {keysMsg}
                        </p>
                      )}
                    </form>
                    {profile.montonio_sandbox_available && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
                        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>{t.onboarding.sandboxHint}</p>
                        <button
                          type="button"
                          style={{ ...s.btn, background: 'var(--surface)', border: '1px solid var(--border)' }}
                          onClick={handleUseSandbox}
                          disabled={sandboxSaving}
                        >
                          {sandboxSaving ? t.onboarding.saving : t.onboarding.useSandbox}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null
              ) : step3Done ? (
                <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, margin: '6px 0 0' }}>
                  {'\u2705'} {t.onboarding.connected} {profile.stripe_account_id}
                </p>
              ) : activeStep === 3 ? (
                <div style={{ marginTop: 12 }}>
                  <button style={s.btn} onClick={handleConnect} disabled={connectLoading}>
                    {connectLoading ? t.onboarding.redirecting : t.onboarding.connectStripe}
                  </button>
                  {connectMsg && <p style={{ fontSize: 13, color: '#dc2626', margin: '8px 0 0' }}>{connectMsg}</p>}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {isBaltic && step2Done && !step3Done && (
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
            {t.onboarding.baltDone}
          </p>
        )}

        {allDone && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <p style={{ color: '#16a34a', fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
              {t.onboarding.allSet}
            </p>
            <button style={s.btn} onClick={() => router.push('/merchant/dashboard')}>
              {t.onboarding.goToDashboard}
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
  stepsRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  stepDot: { width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 },
  stepDone: { background: '#f0fdf4', color: '#16a34a' },
  stepActive: { background: 'var(--brand)', color: '#111' },
  stepFuture: { background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' },
  stepLine: { width: 56, height: 2, margin: '0 8px', flexShrink: 0 },
  step: { borderRadius: 12, padding: '16px', marginBottom: 10 },
  stepCurrent: { background: 'var(--bg)', border: '1px solid var(--border)' },
  stepHeader: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  stepNum: { width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  stepTitle: { fontSize: 15, fontWeight: 700, margin: 0 },
  stepDesc: { fontSize: 13, color: 'var(--muted)', margin: '3px 0 0' },
  // Same measurements as login and register — the merchant arrives here from
  // one of them, and a button that shrinks a notch between screens reads as a
  // different product.
  btn: { padding: '12px 20px', borderRadius: 12, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 14, cursor: 'pointer', width: '100%' },
  input: { padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--surface)', width: '100%', boxSizing: 'border-box' },
};
