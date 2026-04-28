'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Profile = {
  id: string;
  email: string;
  business_name: string | null;
  iban: string | null;
  slug: string | null;
  template: { filename: string; created_at: string } | null;
};

export default function MerchantSettingsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [iban, setIban] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setProfile(data);
        setBusinessName(data.business_name ?? '');
        setIban(data.iban ?? '');
        setSlug(data.slug ?? '');
      });
  }, [router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch('/api/merchant/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName, iban, slug }),
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg('Saved');
      setProfile(p => p ? { ...p, business_name: businessName, iban, slug } : p);
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
      const res = await fetch('/api/merchant/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      });

      if (res.ok) {
        setUploadMsg(`Template saved: ${file.name}`);
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

  async function handleLogout() {
    await fetch('/api/merchant/auth/logout', { method: 'POST' });
    router.push('/merchant/login');
  }

  const paymentLink = slug ? `https://checkout.hexabee.buzz/pay/${slug}` : null;

  if (!profile) {
    return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</main>;
  }

  return (
    <main style={s.page}>
      <div style={s.container}>
        <div style={s.header}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 36 }} />
          <button style={s.logoutBtn} onClick={handleLogout}>Log out</button>
        </div>

        <h1 style={s.title}>Settings</h1>
        <p style={s.sub}>Configure your payment profile and generate your payment link.</p>

        <div style={s.card}>
          <form onSubmit={handleSave} style={s.form}>
            <label style={s.label}>Business Name
              <input style={s.input} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Your business name" />
            </label>
            <label style={s.label}>IBAN
              <input style={s.input} value={iban} onChange={e => setIban(e.target.value)} placeholder="e.g. DE89370400440532013000" />
            </label>
            <label style={s.label}>Email
              <input style={s.input} value={profile.email} disabled />
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

        {paymentLink && (
          <div style={s.linkCard}>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 6px' }}>Your payment link</p>
            <p style={{ fontWeight: 700, fontSize: 15, wordBreak: 'break-all' }}>{paymentLink}</p>
            <button
              style={s.copyBtn}
              onClick={() => navigator.clipboard.writeText(paymentLink)}
            >
              Copy link
            </button>
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
};
