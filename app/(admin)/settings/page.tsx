'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  normalizePaymentProfile,
  PAYMENT_PROFILE_STORAGE_KEY,
  PaymentProfile,
  toSlug,
  toStoredPaymentProfile,
} from '@/lib/payment-profile';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem',
  borderRadius: '10px',
  border: '1px solid var(--border)',
  marginBottom: '1rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: '0.4rem',
};

export default function SettingsPage() {
  const [profile, setProfile] = useState<PaymentProfile>({
    businessName: '',
    iban: '',
    email: '',
    publicSlug: '',
  });
  const [isSlugEdited, setIsSlugEdited] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    const savedProfile = localStorage.getItem(PAYMENT_PROFILE_STORAGE_KEY);

    if (!savedProfile) {
      return;
    }

    try {
      const parsed = normalizePaymentProfile(JSON.parse(savedProfile));

      if (!parsed) {
        setSavedMessage('Could not load saved payment settings.');
        return;
      }

      setProfile(parsed);
      setIsSlugEdited(parsed.publicSlug !== toSlug(parsed.businessName));
    } catch {
      setSavedMessage('Could not load saved payment settings.');
    }
  }, []);

  const paymentLink = useMemo(() => {
    const normalizedSlug = toSlug(profile.publicSlug);
    if (!normalizedSlug) {
      return 'https://hexabee.buzz/pay/{public_slug}';
    }

    return `https://hexabee.buzz/pay/${normalizedSlug}`;
  }, [profile.publicSlug]);

  const handleBusinessNameChange = (value: string) => {
    const generatedSlug = toSlug(value);

    setProfile((prev) => ({
      ...prev,
      businessName: value,
      publicSlug: isSlugEdited ? prev.publicSlug : generatedSlug,
    }));
  };

  const handleSave = () => {
    localStorage.setItem(PAYMENT_PROFILE_STORAGE_KEY, JSON.stringify(toStoredPaymentProfile(profile)));
    setSavedMessage('Settings saved locally.');
  };

  return (
    <div style={{ maxWidth: '640px' }}>
      <h1 style={{ marginTop: 0, fontSize: '1.75rem' }}>Settings</h1>
      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        Configure your payment profile details for your merchant payment link.
      </p>

      <div className="card" style={{ marginTop: '1.2rem' }}>
        <label htmlFor="businessName" style={labelStyle}>
          Business Name
        </label>
        <input
          id="businessName"
          value={profile.businessName}
          onChange={(event) => handleBusinessNameChange(event.target.value)}
          style={inputStyle}
          placeholder="HexaBee Downtown"
        />

        <label htmlFor="iban" style={labelStyle}>
          IBAN
        </label>
        <input
          id="iban"
          value={profile.iban}
          onChange={(event) => setProfile((prev) => ({ ...prev, iban: event.target.value }))}
          style={inputStyle}
          placeholder="DE89 3704 0044 0532 0130 00"
        />

        <label htmlFor="email" style={labelStyle}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={profile.email}
          onChange={(event) => setProfile((prev) => ({ ...prev, email: event.target.value }))}
          style={inputStyle}
          placeholder="billing@hexabee.com"
        />

        <label htmlFor="publicSlug" style={labelStyle}>
          Public Slug
        </label>
        <input
          id="publicSlug"
          value={profile.publicSlug}
          onChange={(event) => {
            setIsSlugEdited(true);
            setProfile((prev) => ({ ...prev, publicSlug: toSlug(event.target.value) }));
          }}
          style={inputStyle}
          placeholder="hexabee-downtown"
        />

        <button
          type="button"
          onClick={handleSave}
          style={{
            background: 'var(--brand)',
            color: '#111827',
            border: 'none',
            borderRadius: '10px',
            padding: '0.65rem 1rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Save Settings
        </button>

        {savedMessage ? <p style={{ color: 'var(--muted)', margin: '0.8rem 0 0' }}>{savedMessage}</p> : null}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>Generated payment link</p>
        <p style={{ margin: '0.5rem 0 0', fontWeight: 600, wordBreak: 'break-all' }}>{paymentLink}</p>
      </div>
    </div>
  );
}
