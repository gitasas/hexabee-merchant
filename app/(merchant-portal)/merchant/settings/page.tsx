'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { CHECKOUT_URL } from '@/lib/checkout-url';

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

// Inbound (BCC) domain — Resend-managed *.resend.app address on the free
// plan; switch to in.hexabee.buzz via env once a custom receiving domain
// is configured. Must match INBOUND_DOMAIN on the Python backend.
const INBOUND_DOMAIN = process.env.NEXT_PUBLIC_INBOUND_DOMAIN || 'in.hexabee.buzz';

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
  fee_mode: string | null;
  reminders_enabled: boolean | null;
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
  const [mmCopied, setMmCopied] = useState(false);
  const [bccCopied, setBccCopied] = useState(false);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [feeMode, setFeeMode] = useState<'merchant' | 'payer'>('merchant');
  const [feeModeSaving, setFeeModeSaving] = useState(false);
  const [feeModeMsg, setFeeModeMsg] = useState<string | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [remindersSaving, setRemindersSaving] = useState(false);
  const [remindersMsg, setRemindersMsg] = useState<string | null>(null);

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
        setFeeMode(data.fee_mode === 'payer' ? 'payer' : 'merchant');
        setRemindersEnabled(data.reminders_enabled === true);

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

  async function handleFeeModeChange(mode: 'merchant' | 'payer') {
    if (mode === feeMode || feeModeSaving) return;
    const prev = feeMode;
    setFeeMode(mode);
    setFeeModeSaving(true);
    setFeeModeMsg(null);
    try {
      const res = await fetch('/api/merchant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeMode: mode }),
      });
      if (!res.ok) {
        setFeeMode(prev);
        setFeeModeMsg('Failed to save — try again');
      } else {
        setFeeModeMsg('Saved');
        setTimeout(() => setFeeModeMsg(null), 2000);
      }
    } catch {
      setFeeMode(prev);
      setFeeModeMsg('Failed to save — try again');
    } finally {
      setFeeModeSaving(false);
    }
  }

  async function handleRemindersChange(enabled: boolean) {
    if (enabled === remindersEnabled || remindersSaving) return;
    const prev = remindersEnabled;
    setRemindersEnabled(enabled);
    setRemindersSaving(true);
    setRemindersMsg(null);
    try {
      const res = await fetch('/api/merchant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindersEnabled: enabled }),
      });
      if (!res.ok) {
        setRemindersEnabled(prev);
        setRemindersMsg('Failed to save — try again');
      } else {
        setRemindersMsg('Saved');
        setTimeout(() => setRemindersMsg(null), 2000);
      }
    } catch {
      setRemindersEnabled(prev);
      setRemindersMsg('Failed to save — try again');
    } finally {
      setRemindersSaving(false);
    }
  }

  const paymentLink = slug ? `${CHECKOUT_URL}/pay/${slug}` : null;
  const posLink = slug ? `${CHECKOUT_URL}/pay/${slug}?mode=pos` : null;
  const mailMergeLink = paymentLink ? `${paymentLink}?a={AMOUNT}&r={INVOICE_NO}` : null;
  const bccAddress = `${slug}@${INBOUND_DOMAIN}`;

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

  if (!profile) return <p className="hb-skeleton">Loading…</p>;

  const activeAccountId = isLiveMode ? profile.stripe_account_id_live : profile.stripe_account_id;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">Settings</h1>
          <p className="hb-sub">Your business details, payment link and how you get paid.</p>
        </div>
      </div>

      {/* 1 ── Business profile */}
      <div className="hb-card">
        <h2 className="hb-card-title">Business profile</h2>
        <p className="hb-card-sub">The name and bank details your customers see on invoices and receipts.</p>
        <form onSubmit={handleSave}>
          <label className="hb-field">Business name
            <input className="hb-input" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Your business name" />
          </label>

          <div className="hb-grid-2">
            <label className="hb-field">Business country
              <select
                className="hb-input"
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
            </label>
            <label className="hb-field">Currency
              <input className="hb-input" value={currency} disabled />
              <span className="hb-optional">Set automatically from your country</span>
            </label>
          </div>

          {country === 'GB' ? (
            <div className="hb-grid-2">
              <label className="hb-field">Sort code
                <input className="hb-input" value={sortCode} onChange={e => setSortCode(formatSortCode(e.target.value))} placeholder="e.g. 20-00-00" />
              </label>
              <label className="hb-field">Account number
                <input className="hb-input" value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="e.g. 12345678" />
              </label>
            </div>
          ) : (
            <label className="hb-field">IBAN
              <input className="hb-input" value={iban} onChange={e => setIban(e.target.value)} placeholder="e.g. DE89370400440532013000" />
            </label>
          )}

          <label className="hb-field">Public slug
            <input className="hb-input" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="e.g. mycompany" />
            <span className="hb-optional">Only lowercase letters, numbers and hyphens — it becomes part of your payment link</span>
          </label>

          <label className="hb-field">Email
            <input className="hb-input" value={profile.email} disabled />
          </label>

          <div className="hb-actions">
            <button className="hb-btn primary" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
          {saveMsg && <p className={`hb-msg ${saveMsg === 'Saved' ? 'ok' : 'err'}`}>{saveMsg}</p>}
        </form>
      </div>

      {/* 2 ── Getting paid */}
      {paymentLink && (
        <div className="hb-card">
          <h2 className="hb-card-title">Getting paid</h2>
          <p className="hb-card-sub">Three ways to collect: share a link, merge it into your invoices, or BCC us.</p>

          <div>
            <p className="hb-subsection-label">Your payment link</p>
            <p className="hb-card-sub">Send it to anyone — they enter the amount and reference themselves.</p>
            <p className="hb-urlbox">{paymentLink}</p>
            <div className="hb-actions">
              <button
                type="button"
                className={`hb-btn sm${copied ? ' ok' : ''}`}
                onClick={() => { navigator.clipboard.writeText(paymentLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <button type="button" className="hb-btn sm" onClick={() => window.open(paymentLink, '_blank')}>Preview</button>
            </div>
          </div>

          {/* Mail-merge template link for bulk invoicing from accounting software */}
          <div className="hb-subsection">
            <p className="hb-subsection-label">Bulk invoicing (mail merge)</p>
            <p className="hb-card-sub">Each customer gets their amount and reference already filled in.</p>
            <p className="hb-urlbox">{mailMergeLink}</p>
            <div className="hb-actions">
              <button
                type="button"
                className={`hb-btn sm${mmCopied ? ' ok' : ''}`}
                onClick={() => { navigator.clipboard.writeText(mailMergeLink!); setMmCopied(true); setTimeout(() => setMmCopied(false), 2000); }}
              >
                {mmCopied ? 'Copied!' : 'Copy template link'}
              </button>
            </div>
            <p className="hb-note">
              Paste this into your accounting software&apos;s email template and replace{' '}
              <code>{'{AMOUNT}'}</code> and <code>{'{INVOICE_NO}'}</code> with its merge variables
              (e.g. invoice total and invoice number). Each customer then receives a link with
              their amount and payment reference already filled in — no typing, no mistakes.
            </p>
          </div>

          {/* Invoice inbox (BCC) — auto-registers every invoice sent via accounting software */}
          <div className="hb-subsection">
            <p className="hb-subsection-label">Invoice inbox (BCC)</p>
            <p className="hb-card-sub">BCC this address and every invoice you send is tracked automatically.</p>
            <p className="hb-urlbox">{bccAddress}</p>
            <div className="hb-actions">
              <button
                type="button"
                className={`hb-btn sm${bccCopied ? ' ok' : ''}`}
                onClick={() => { navigator.clipboard.writeText(bccAddress); setBccCopied(true); setTimeout(() => setBccCopied(false), 2000); }}
              >
                {bccCopied ? 'Copied!' : 'Copy BCC address'}
              </button>
            </div>
            <p className="hb-note">
              Add this address as BCC in your accounting software&apos;s email settings. Every invoice
              you send gets registered automatically — payments are matched to invoices and
              you&apos;ll see paid/unpaid status on the{' '}
              <a href="/merchant/invoices" style={{ textDecoration: 'underline' }}>Invoices page</a>.
            </p>
          </div>
        </div>
      )}

      {/* 3 ── Preferences */}
      <div className="hb-card">
        <h2 className="hb-card-title">Preferences</h2>
        <p className="hb-card-sub">How fees are charged and whether we chase unpaid invoices for you.</p>

        {paymentLink && (
          <div>
            <p className="hb-subsection-label">Who pays the fee</p>
            <p className="hb-card-sub">
              Applies to your payment link, in-person QR payments and invoice payments.
              Payment links created on the Payment Links page keep their own per-link choice.
            </p>
            <div className="hb-segment">
              {([
                { mode: 'merchant' as const, label: 'I cover it' },
                { mode: 'payer' as const, label: 'Payer covers it' },
              ]).map(opt => (
                <button
                  key={opt.mode}
                  type="button"
                  className={`hb-btn${feeMode === opt.mode ? ' selected' : ''}`}
                  onClick={() => handleFeeModeChange(opt.mode)}
                  disabled={feeModeSaving}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {feeMode === 'payer' && (
              <p className="hb-note">
                The payer sees the total including the processing fee — you receive the full invoice amount.
              </p>
            )}
            {feeModeMsg && (
              <p className={`hb-msg ${feeModeMsg === 'Saved' ? 'ok' : 'err'}`}>{feeModeMsg}</p>
            )}
          </div>
        )}

        <div className="hb-subsection">
          <p className="hb-subsection-label">Payment reminders</p>
          <p className="hb-card-sub">
            When enabled, HexaBee automatically emails your customers about unpaid invoices from the
            Invoices ledger — first reminder after 7 days, repeated weekly, max 3. Replies go to your
            email. If you offer Klarna/Afterpay, the reminder also suggests paying in instalments.
          </p>
          <div className="hb-segment">
            {([
              { enabled: false, label: 'Off' },
              { enabled: true, label: 'On' },
            ]).map(opt => (
              <button
                key={opt.label}
                type="button"
                className={`hb-btn${remindersEnabled === opt.enabled ? ' selected' : ''}`}
                onClick={() => handleRemindersChange(opt.enabled)}
                disabled={remindersSaving}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {remindersMsg && (
            <p className={`hb-msg ${remindersMsg === 'Saved' ? 'ok' : 'err'}`}>{remindersMsg}</p>
          )}
        </div>
      </div>

      {/* 4 ── In-person payments (only once Stripe can take charges) */}
      {connectStatus?.chargesEnabled && posLink && (
        <div className="hb-card">
          <h2 className="hb-card-title">In-person payments</h2>
          <p className="hb-card-sub">Put a QR code on your counter — customers scan it and pay on their own phone.</p>

          <p className="hb-urlbox">{posLink}</p>

          <div className="hb-actions">
            <button type="button" className="hb-btn" onClick={handleGenerateQr} disabled={qrLoading}>
              {qrLoading ? 'Generating...' : '⬛ Generate QR code'}
            </button>
            {qrDataUrl && (
              <button type="button" className="hb-btn" onClick={handleDownloadQr}>
                ⬇ Download QR code
              </button>
            )}
          </div>

          {qrDataUrl && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              {/* Canvas-composed PNG preview — no class fits a fixed-size image */}
              <img
                src={qrDataUrl}
                alt="POS QR code"
                style={{ width: 200, height: 200, borderRadius: 12, border: '1px solid var(--border)' }}
              />
            </div>
          )}

          <p className="hb-note">
            Place this QR code at your counter or program an NFC tag with the link above.
          </p>
        </div>
      )}

      {/* 5 ── Stripe Connect */}
      <div className="hb-card">
        <h2 className="hb-card-title">Stripe Connect {isLiveMode ? '(Live mode)' : '(Test mode)'}</h2>
        <p className="hb-card-sub">Stripe handles the card payment and pays the money into your bank account.</p>
        {activeAccountId ? (
          <>
            <div className="hb-actions">
              <span className={`hb-badge ${connectStatus?.chargesEnabled ? 'is-paid' : 'is-pending'}`}>
                {connectStatus?.chargesEnabled ? 'Charges enabled' : 'Charges pending'}
              </span>
              <span className={`hb-badge ${connectStatus?.payoutsEnabled ? 'is-paid' : 'is-pending'}`}>
                {connectStatus?.payoutsEnabled ? 'Payouts enabled' : 'Payouts pending'}
              </span>
            </div>
            <p className="hb-note hb-mono">{activeAccountId}</p>
            {connectStatus && !connectStatus.chargesEnabled && (
              <div className="hb-actions" style={{ marginTop: 12 }}>
                <button type="button" className="hb-btn" onClick={handleConnect} disabled={connectLoading}>
                  {connectLoading ? 'Redirecting...' : 'Complete Stripe setup'}
                </button>
              </div>
            )}
          </>
        ) : (
          <button type="button" className="hb-btn primary" onClick={handleConnect} disabled={connectLoading}>
            {connectLoading ? 'Redirecting...' : 'Connect Stripe account'}
          </button>
        )}
        {connectMsg && <p className="hb-msg err">{connectMsg}</p>}
      </div>

      {/* 6 ── Invoice template */}
      <div className="hb-card">
        <h2 className="hb-card-title">Invoice template</h2>
        <p className="hb-card-sub">Upload one sample invoice so HexaBee learns to read your invoice format.</p>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleTemplateUpload} />
        <div className="hb-actions">
          <button type="button" className="hb-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload sample invoice (PDF)'}
          </button>
        </div>
        {profile.template && (
          <p className="hb-note">
            Current template: <strong>{profile.template.filename}</strong>
          </p>
        )}
        {uploadMsg && (
          <p className={`hb-msg ${uploadMsg.startsWith('Template') ? 'ok' : 'err'}`}>{uploadMsg}</p>
        )}
      </div>
    </>
  );
}
