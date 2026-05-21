'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';

const COUNTRIES = [
  { code: 'GB', name: 'United Kingdom',   flag: '🇬🇧', currency: 'GBP' },
  { code: 'DE', name: 'Germany',          flag: '🇩🇪', currency: 'EUR' },
  { code: 'FR', name: 'France',           flag: '🇫🇷', currency: 'EUR' },
  { code: 'BE', name: 'Belgium',          flag: '🇧🇪', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands',      flag: '🇳🇱', currency: 'EUR' },
  { code: 'AT', name: 'Austria',          flag: '🇦🇹', currency: 'EUR' },
  { code: 'PL', name: 'Poland',           flag: '🇵🇱', currency: 'PLN' },
  { code: 'LT', name: 'Lithuania',        flag: '🇱🇹', currency: 'EUR' },
  { code: 'LV', name: 'Latvia',           flag: '🇱🇻', currency: 'EUR' },
  { code: 'EE', name: 'Estonia',          flag: '🇪🇪', currency: 'EUR' },
  { code: 'FI', name: 'Finland',          flag: '🇫🇮', currency: 'EUR' },
  { code: 'SE', name: 'Sweden',           flag: '🇸🇪', currency: 'SEK' },
  { code: 'DK', name: 'Denmark',          flag: '🇩🇰', currency: 'DKK' },
  { code: 'NO', name: 'Norway',           flag: '🇳🇴', currency: 'NOK' },
  { code: 'IE', name: 'Ireland',          flag: '🇮🇪', currency: 'EUR' },
  { code: 'PT', name: 'Portugal',         flag: '🇵🇹', currency: 'EUR' },
  { code: 'ES', name: 'Spain',            flag: '🇪🇸', currency: 'EUR' },
  { code: 'IT', name: 'Italy',            flag: '🇮🇹', currency: 'EUR' },
  { code: 'CZ', name: 'Czech Republic',   flag: '🇨🇿', currency: 'CZK' },
  { code: 'SK', name: 'Slovakia',         flag: '🇸🇰', currency: 'EUR' },
  { code: 'HU', name: 'Hungary',          flag: '🇭🇺', currency: 'HUF' },
  { code: 'RO', name: 'Romania',          flag: '🇷🇴', currency: 'RON' },
  { code: 'BG', name: 'Bulgaria',         flag: '🇧🇬', currency: 'BGN' },
  { code: 'HR', name: 'Croatia',          flag: '🇭🇷', currency: 'EUR' },
  { code: 'SI', name: 'Slovenia',         flag: '🇸🇮', currency: 'EUR' },
  { code: 'GR', name: 'Greece',           flag: '🇬🇷', currency: 'EUR' },
  { code: 'CY', name: 'Cyprus',           flag: '🇨🇾', currency: 'EUR' },
  { code: 'MT', name: 'Malta',            flag: '🇲🇹', currency: 'EUR' },
  { code: 'LU', name: 'Luxembourg',       flag: '🇱🇺', currency: 'EUR' },
];

const isLiveMode = process.env.NEXT_PUBLIC_STRIPE_ENV === 'live';

type Profile = {
  id: string;
  email: string;
  business_name: string | null;
  iban: string | null;
  sort_code: string | null;
  account_number: string | null;
  slug: string | null;
  stripe_account_id: string | null;
  stripe_account_id_live: string | null;
  business_country: string | null;
  business_currency: string | null;
  template: { filename: string; created_at: string } | null;
};

type ConnectStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export default function MerchantSettingsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [iban, setIban] = useState('');
  const [slug, setSlug] = useState('');
  const [country, setCountry] = useState('GB');
  const [currency, setCurrency] = useState('GBP');
  const [sortCode, setSortCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (!data.stripe_account_id || !data.business_country) {
          router.push('/merchant/onboarding');
          return;
        }
        setProfile(data);
        setBusinessName(data.business_name ?? '');
        setIban(data.iban ?? '');
        setSortCode(data.sort_code ?? '');
        setAccountNumber(data.account_number ?? '');
        setSlug(data.slug ?? '');
        setCountry(data.business_country ?? 'GB');
        setCurrency(data.business_currency ?? 'GBP');

        const activeAccountId = isLiveMode ? data.stripe_account_id_live : data.stripe_account_id;
        if (activeAccountId) {
          fetch(`/api/connect/status?accountId=${encodeURIComponent(activeAccountId)}`)
            .then(r => r.json())
            .then(s => { if (s.ok) setConnectStatus({ chargesEnabled: s.chargesEnabled, payoutsEnabled: s.payoutsEnabled }); })
            .catch(() => null);
        }
      });
  }, [router]);

  function formatSortCode(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    const isGB = country === 'GB';
    const res = await fetch('/api/merchant/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName,
        iban: isGB ? null : iban,
        sortCode: isGB ? sortCode.replace(/-/g, '') : null,
        accountNumber: isGB ? accountNumber : null,
        slug,
        businessCountry: country,
        businessCurrency: currency,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg('Saved');
      setProfile(p => p ? { ...p, business_name: businessName, iban: isGB ? null : iban, sort_code: isGB ? sortCode : null, account_number: isGB ? accountNumber : null, slug, business_country: country, business_currency: currency } : p);
    } else {
      const d = await res.json();
      setSaveMsg(d.error ?? 'Failed to save');
    }
  }

  async function handleTemplateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const res = await fetch('/api/merchant/template', { method: 'POST', body: fd });
      if (res.ok) {
        setUploadMsg(`Template saved and analysed: ${file.name}`);
        setProfile(p => p ? { ...p, template: { filename: file.name, created_at: new Date().toISOString() } } : p);
      } else {
        const d = await res.json();
        setUploadMsg(d.error ?? 'Failed to save template');
      }
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleConnect() {
    setConnectLoading(true);
    setConnectMsg(null);
    try {
      const res = await fetch('/api/connect/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.ok) { setConnectMsg(data.error ?? 'Failed to start onboarding'); return; }
      window.location.href = data.url;
    } catch {
      setConnectMsg('Something went wrong. Please try again.');
    } finally {
      setConnectLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/merchant/auth/logout', { method: 'POST' });
    router.push('/merchant/login');
  }

  const paymentLink = slug ? `${process.env.NEXT_PUBLIC_CHECKOUT_URL}/pay/${slug}` : null;
  const posLink = slug ? `${process.env.NEXT_PUBLIC_CHECKOUT_URL}/pay/${slug}?mode=pos` : null;

  async function handleGenerateQr() {
    if (!posLink || !businessName) return;
    setQrLoading(true);
    try {
      // 1. Generate raw QR as data URL (400×400, transparent-friendly bg)
      const qrDataUrl = await QRCode.toDataURL(posLink, {
        width: 400,
        margin: 2,
        color: { dark: '#111111', light: '#ffffff' },
      });

      // 2. Load QR image
      const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = qrDataUrl;
      });

      // 3. Load HexaBee logo SVG
      const logoImg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null); // fallback to text if SVG fails
        img.src = '/hexabee-logo.svg';
      });

      // 4. Compose on canvas
      const W = 500;
      const LOGO_H = 72;
      const QR_SIZE = 380;
      const PADDING = 28;
      const NAME_H = 40;
      const URL_H = 28;
      const H = PADDING + LOGO_H + 16 + QR_SIZE + 16 + NAME_H + 8 + URL_H + PADDING;

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      // Background
      ctx.fillStyle = '#fffdf8';
      ctx.fillRect(0, 0, W, H);

      // Border
      ctx.strokeStyle = '#f1e3b6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(4, 4, W - 8, H - 8, 20);
      ctx.stroke();

      let y = PADDING;

      // Logo
      if (logoImg) {
        const logoW = (logoImg.width / logoImg.height) * LOGO_H;
        ctx.drawImage(logoImg, (W - logoW) / 2, y, logoW, LOGO_H);
      } else {
        // Text fallback
        ctx.font = 'bold 28px Arial';
        ctx.fillStyle = '#111111';
        ctx.textAlign = 'center';
        ctx.fillText('⬢ HexaBee', W / 2, y + LOGO_H / 2 + 10);
      }
      y += LOGO_H + 16;

      // QR code (white tile behind it)
      const qrX = (W - QR_SIZE) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(qrX - 6, y - 6, QR_SIZE + 12, QR_SIZE + 12, 12);
      ctx.fill();
      ctx.drawImage(qrImg, qrX, y, QR_SIZE, QR_SIZE);
      y += QR_SIZE + 16;

      // Business name
      ctx.font = 'bold 22px Arial';
      ctx.fillStyle = '#111111';
      ctx.textAlign = 'center';
      ctx.fillText(businessName, W / 2, y + 26);
      y += NAME_H + 8;

      // Line 1: call to action
      ctx.font = 'bold 13px Arial';
      ctx.fillStyle = '#7a5b00';
      ctx.textAlign = 'center';
      ctx.fillText('Scan to pay instantly', W / 2, y + 16);

      // Line 2: branding
      ctx.font = '11px Arial';
      ctx.fillStyle = '#a78a3a';
      ctx.fillText('Powered by hexabee.buzz', W / 2, y + 32);

      setQrDataUrl(canvas.toDataURL('image/png'));
    } catch (err) {
      console.error('QR generation failed', err);
    } finally {
      setQrLoading(false);
    }
  }

  function handleDownloadQr() {
    if (!qrDataUrl || !slug) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `hexabee-pos-qr-${slug}.png`;
    a.click();
  }

  if (!profile) {
    return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</main>;
  }

  return (
    <main style={s.page}>
      <div style={s.container}>
        <div style={s.header}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 36 }} />
          <nav style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a href="/merchant/dashboard" style={s.navLink}>Dashboard</a>
            <a href="/merchant/payment_methods" style={s.navLink}>Payment Methods</a>
            <a href="/merchant/settings" style={s.navActive}>Settings</a>
            <button style={s.logoutBtn} onClick={handleLogout}>Log out</button>
          </nav>
        </div>

        <h1 style={s.title}>Settings</h1>
        <p style={s.sub}>Configure your payment profile and generate your payment link.</p>

        <div style={s.card}>
          <form onSubmit={handleSave} style={s.form}>
            <label style={s.label}>Business Name
              <input style={s.input} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Your business name" />
            </label>
            {country === 'GB' ? (
              <>
                <label style={s.label}>Sort Code
                  <input style={s.input} value={sortCode} onChange={e => setSortCode(formatSortCode(e.target.value))} placeholder="e.g. 20-00-00" />
                </label>
                <label style={s.label}>Account Number
                  <input style={s.input} value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="e.g. 12345678" />
                </label>
              </>
            ) : (
              <label style={s.label}>IBAN
                <input style={s.input} value={iban} onChange={e => setIban(e.target.value)} placeholder="e.g. DE89370400440532013000" />
              </label>
            )}
            <label style={s.label}>Email
              <input style={s.input} value={profile.email} disabled />
            </label>
            <label style={s.label}>Business Country
              <select
                style={s.input}
                value={country}
                onChange={e => {
                  const c = e.target.value;
                  setCountry(c);
                  setCurrency(COUNTRIES.find(x => x.code === c)?.currency ?? 'EUR');
                }}
              >
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
              <span style={s.hint}>Currency auto-set to {currency}</span>
            </label>
            <label style={s.label}>Public Slug
              <input style={s.input} value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="e.g. mycompany" />
              <span style={s.hint}>Only lowercase letters, numbers, hyphens</span>
            </label>
            <button style={s.btn} type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            {saveMsg && <p style={{ fontSize: 13, color: saveMsg === 'Saved' ? '#16a34a' : '#dc2626' }}>{saveMsg}</p>}
          </form>
        </div>

        <div style={s.card}>
          <h2 style={s.cardTitle}>Invoice Template</h2>
          <p style={s.cardSub}>Upload a sample invoice so HexaBee learns your invoice format.</p>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleTemplateUpload} />
          <button style={s.uploadBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload sample invoice (PDF)'}
          </button>
          {profile.template && (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
              Current template: <strong>{profile.template.filename}</strong>
            </p>
          )}
          {uploadMsg && <p style={{ fontSize: 13, color: uploadMsg.startsWith('Template') ? '#16a34a' : '#dc2626', marginTop: 8 }}>{uploadMsg}</p>}
        </div>

        <div style={s.card}>
          <h2 style={s.cardTitle}>Stripe Connect {isLiveMode ? '(Live mode)' : '(Test mode)'}</h2>
          <p style={s.cardSub}>Connect your Stripe account to receive card payments through HexaBee.</p>
          {(() => {
            const activeAccountId = isLiveMode ? profile.stripe_account_id_live : profile.stripe_account_id;
            return activeAccountId ? (
              <div>
                <p style={{ fontSize: 14, margin: '0 0 6px' }}>
                  {connectStatus?.chargesEnabled
                    ? <span style={{ color: '#16a34a', fontWeight: 600 }}>✅ Stripe connected: {activeAccountId}</span>
                    : <span style={{ color: '#d97706', fontWeight: 600 }}>⚠️ Setup incomplete: {activeAccountId}</span>
                  }
                </p>
                {connectStatus && !connectStatus.chargesEnabled && (
                  <button style={s.uploadBtn} onClick={handleConnect} disabled={connectLoading}>
                    {connectLoading ? 'Redirecting...' : 'Complete Stripe setup'}
                  </button>
                )}
              </div>
            ) : (
              <button style={s.btn} onClick={handleConnect} disabled={connectLoading}>
                {connectLoading ? 'Redirecting...' : 'Connect Stripe account'}
              </button>
            );
          })()}
          {connectMsg && <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>{connectMsg}</p>}
        </div>

        {paymentLink && (
          <div style={s.linkCard}>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 6px' }}>Your payment link</p>
            <p style={{ fontWeight: 700, fontSize: 15, wordBreak: 'break-all', marginBottom: 12 }}>{paymentLink}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={{ ...s.copyBtn, background: copied ? '#16a34a' : undefined, color: copied ? '#fff' : undefined, borderColor: copied ? '#16a34a' : undefined }}
                onClick={() => { navigator.clipboard.writeText(paymentLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <button style={s.copyBtn} onClick={() => window.open(paymentLink, '_blank')}>Preview</button>
            </div>
          </div>
        )}

        {/* In-Person Payments — only shown when Stripe charges are enabled */}
        {connectStatus?.chargesEnabled && posLink && (
          <div style={s.card}>
            <h2 style={s.cardTitle}>In-Person Payments</h2>
            <p style={s.cardSub}>Accept payments at your counter via QR code or NFC tag.</p>

            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 13px', marginBottom: 16, wordBreak: 'break-all', fontSize: 13, fontFamily: 'monospace', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              {posLink}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button style={s.uploadBtn} onClick={handleGenerateQr} disabled={qrLoading}>
                {qrLoading ? 'Generating...' : '⬛ Generate QR Code'}
              </button>
              {qrDataUrl && (
                <button style={s.uploadBtn} onClick={handleDownloadQr}>
                  ⬇ Download QR Code
                </button>
              )}
            </div>

            {qrDataUrl && (
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <img src={qrDataUrl} alt="POS QR Code" style={{ width: 200, height: 200, borderRadius: 12, border: '1px solid var(--border)' }} />
              </div>
            )}

            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              Place this QR code at your counter or program an NFC tag with the link above.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px' },
  container: { maxWidth: 600, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 800, margin: '0 0 6px' },
  sub: { color: 'var(--muted)', fontSize: 14, margin: '0 0 24px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px', marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.04)' },
  cardTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 6px' },
  cardSub: { color: 'var(--muted)', fontSize: 14, margin: '0 0 16px' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14, fontWeight: 600 },
  input: { padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', background: 'var(--bg)', fontWeight: 400 },
  hint: { fontSize: 12, color: 'var(--muted)', fontWeight: 400 },
  btn: { padding: '12px', borderRadius: 12, border: 'none', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  uploadBtn: { padding: '11px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  linkCard: { background: 'var(--surface)', border: '2px solid var(--brand)', borderRadius: 16, padding: '20px 24px', marginBottom: 20 },
  copyBtn: { marginTop: 10, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  logoutBtn: { fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' },
  navLink: { fontSize: 14, color: 'var(--muted)', textDecoration: 'none' },
  navActive: { fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' },
};
