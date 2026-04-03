'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  normalizePaymentProfile,
  PAYMENT_PROFILE_STORAGE_KEY,
  PaymentProfile,
  toSlug,
} from '@/lib/payment-profile';
import { attemptHexaBeePluginLaunch } from '@/lib/plugin-launch';

const PLUGIN_INSTALL_URL = 'https://hexabee.buzz/install-plugin';

export default function PaymentPreviewPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<PaymentProfile | null>(null);
  const [isLaunchingPlugin, setIsLaunchingPlugin] = useState(false);
  const [showInstallFallback, setShowInstallFallback] = useState(false);

  const slug = useMemo(() => toSlug(params.slug ?? ''), [params.slug]);

  useEffect(() => {
    const rawProfile = localStorage.getItem(PAYMENT_PROFILE_STORAGE_KEY);

    if (!rawProfile) {
      setProfile(null);
      return;
    }

    try {
      const parsed = normalizePaymentProfile(JSON.parse(rawProfile));
      setProfile(parsed);
    } catch {
      setProfile(null);
    }
  }, []);

  const isMatch = useMemo(() => {
    if (!profile || !slug) {
      return false;
    }

    return toSlug(profile.publicSlug) === slug;
  }, [profile, slug]);

  const handlePluginOpen = async () => {
    if (!slug || isLaunchingPlugin) {
      return;
    }

    setIsLaunchingPlugin(true);
    setShowInstallFallback(false);

    const didLaunch = await attemptHexaBeePluginLaunch(slug);

    if (!didLaunch) {
      setShowInstallFallback(true);
    }

    setIsLaunchingPlugin(false);
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '1.5rem',
      }}
    >
      <section className="card" style={{ width: '100%', maxWidth: '520px', padding: '1.6rem' }}>
        {isMatch && profile ? (
          <>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem', letterSpacing: '0.04em' }}>
              HEXABEE MERCHANT PAYMENT
            </p>
            <h1 style={{ margin: '0.6rem 0 1.2rem', fontSize: '1.8rem' }}>{profile.businessName}</h1>

            <div style={{ display: 'grid', gap: '0.9rem' }}>
              <div>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>IBAN</p>
                <p style={{ margin: '0.2rem 0 0', fontWeight: 600, wordBreak: 'break-word' }}>{profile.iban}</p>
              </div>

              <div>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>Support Email</p>
                <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }}>{profile.email}</p>
              </div>
            </div>

            <p style={{ margin: '1.4rem 0 0', color: 'var(--muted)' }}>Pay this invoice securely with HexaBee</p>

            <button
              type="button"
              onClick={handlePluginOpen}
              disabled={isLaunchingPlugin}
              style={{
                marginTop: '1.1rem',
                width: '100%',
                border: 'none',
                borderRadius: '10px',
                padding: '0.8rem 1rem',
                background: 'var(--brand)',
                color: '#111827',
                fontWeight: 700,
                cursor: isLaunchingPlugin ? 'wait' : 'pointer',
                opacity: isLaunchingPlugin ? 0.8 : 1,
              }}
            >
              {isLaunchingPlugin ? 'Launching Plugin...' : 'Open in HexaBee Plugin'}
            </button>

            {showInstallFallback && (
              <div
                style={{
                  marginTop: '1rem',
                  border: '1px solid var(--line)',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'grid',
                  gap: '0.7rem',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Plugin not detected</h2>
                <p style={{ margin: 0, color: 'var(--muted)' }}>
                  Install the HexaBee plugin to scan and pay this invoice faster.
                </p>
                <a
                  href={PLUGIN_INSTALL_URL}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    justifyContent: 'center',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                    background: 'var(--brand)',
                    color: '#111827',
                    textDecoration: 'none',
                    fontWeight: 700,
                  }}
                >
                  Install Plugin
                </a>
                <button
                  type="button"
                  onClick={() => router.push(`/manual-pay/${slug}`)}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                    background: 'transparent',
                    color: 'var(--fg)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Continue manually
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem', letterSpacing: '0.04em' }}>
              HEXABEE MERCHANT PAYMENT
            </p>
            <h1 style={{ margin: '0.7rem 0 0', fontSize: '1.7rem' }}>Merchant not found</h1>
          </>
        )}
      </section>
    </main>
  );
}
