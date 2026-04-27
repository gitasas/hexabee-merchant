'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Merchant = {
  business_name: string;
  iban: string;
  slug: string;
};

function hasExtension(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as Record<string, unknown>)['__hexabee_extension'];
}

export default function PaySlugPage() {
  const { slug } = useParams<{ slug: string }>();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [extensionDetected, setExtensionDetected] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/pay/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setNotFound(true); return; }
        setMerchant(data);
      });
    setTimeout(() => setExtensionDetected(hasExtension()), 500);
  }, [slug]);

  if (notFound) {
    return (
      <main style={s.page}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 48, display: 'block', margin: '0 auto 20px' }} />
          <p style={{ textAlign: 'center', color: 'var(--muted)' }}>Payment link not found.</p>
        </div>
      </main>
    );
  }

  if (!merchant) return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</main>;

  if (!extensionDetected) {
    return (
      <main style={s.page}>
        <div style={s.card}>
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 48, display: 'block', margin: '0 auto 24px' }} />
          <h2 style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, margin: '0 0 10px' }}>Install HexaBee to pay</h2>
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, margin: '0 0 20px' }}>
            To pay this invoice from <strong>{merchant.business_name}</strong>, install the HexaBee Chrome extension.
          </p>
          <div style={s.info}>
            <Row label="Payee" value={merchant.business_name} />
            <Row label="IBAN" value={merchant.iban} mono />
          </div>
          <a href="/install" style={s.installBtn}>Install HexaBee for Gmail</a>
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Already installed? Refresh this page.</p>
        </div>
      </main>
    );
  }

  return (
    <main style={s.page}>
      <div style={s.card}>
        <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 48, display: 'block', margin: '0 auto 24px' }} />
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Invoice payment</p>
        <h2 style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, margin: '0 0 20px' }}>{merchant.business_name}</h2>
        <div style={s.info}>
          <Row label="IBAN" value={merchant.iban} mono />
        </div>
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', margin: '16px 0' }}>
          Open this invoice email in Gmail to scan and pay with HexaBee.
        </p>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, gap: 16 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 32px', maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  info: { background: 'var(--bg)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 },
  installBtn: { display: 'block', textAlign: 'center', background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 15, padding: '14px', borderRadius: 12, textDecoration: 'none' },
};
