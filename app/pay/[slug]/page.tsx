'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  normalizePaymentProfile,
  PAYMENT_PROFILE_STORAGE_KEY,
  PaymentProfile,
  toSlug,
} from '@/lib/payment-profile';

export default function PaymentPreviewPage() {
  const params = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<PaymentProfile | null>(null);

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
              style={{
                marginTop: '1.1rem',
                width: '100%',
                border: 'none',
                borderRadius: '10px',
                padding: '0.8rem 1rem',
                background: 'var(--brand)',
                color: '#111827',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Open in HexaBee Plugin
            </button>

            <p style={{ margin: '0.8rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
              If you do not have the plugin yet, install it first.
            </p>
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
