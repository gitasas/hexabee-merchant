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

const INVOICE_TEMPLATE_STORAGE_KEY = 'hexabee_invoice_template_metadata';

type InvoiceTemplateMetadata = {
  file_name: string;
  uploaded_at: number;
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
  const [invoiceTemplateFile, setInvoiceTemplateFile] = useState<File | null>(null);
  const [invoiceTemplateMetadata, setInvoiceTemplateMetadata] = useState<InvoiceTemplateMetadata | null>(null);
  const [invoiceTemplateStatus, setInvoiceTemplateStatus] = useState('');

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

  useEffect(() => {
    const storedMetadata = localStorage.getItem(INVOICE_TEMPLATE_STORAGE_KEY);

    if (!storedMetadata) {
      return;
    }

    try {
      const parsed = JSON.parse(storedMetadata) as InvoiceTemplateMetadata;
      if (!parsed?.file_name || !parsed?.uploaded_at) {
        return;
      }

      setInvoiceTemplateMetadata(parsed);
      setInvoiceTemplateStatus('Template uploaded');
    } catch {
      setInvoiceTemplateStatus('');
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

  const handleInvoiceTemplateUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (selectedFile.type !== 'application/pdf') {
      setInvoiceTemplateStatus('Please select a PDF file.');
      return;
    }

    const metadata: InvoiceTemplateMetadata = {
      file_name: selectedFile.name,
      uploaded_at: Date.now(),
    };

    setInvoiceTemplateFile(selectedFile);
    setInvoiceTemplateMetadata(metadata);
    setInvoiceTemplateStatus('Uploaded locally');
    localStorage.setItem(INVOICE_TEMPLATE_STORAGE_KEY, JSON.stringify(metadata));
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
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Invoice Template</h2>
        <p style={{ color: 'var(--muted)', margin: '0.5rem 0 1rem', fontSize: '0.9rem' }}>
          This helps HexaBee recognize your invoices faster.
        </p>

        <label htmlFor="invoiceTemplate" style={labelStyle}>
          Upload sample invoice (PDF)
        </label>
        <input
          id="invoiceTemplate"
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleInvoiceTemplateUpload}
          style={{ ...inputStyle, marginBottom: 0 }}
        />

        {invoiceTemplateFile?.name || invoiceTemplateMetadata?.file_name ? (
          <p style={{ color: 'var(--muted)', margin: '0.8rem 0 0' }}>
            File:{' '}
            <span style={{ fontWeight: 600 }}>
              {invoiceTemplateFile?.name ?? invoiceTemplateMetadata?.file_name}
            </span>
          </p>
        ) : null}

        {invoiceTemplateStatus ? <p style={{ color: 'var(--muted)', margin: '0.4rem 0 0' }}>{invoiceTemplateStatus}</p> : null}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>Generated payment link</p>
        <p style={{ margin: '0.5rem 0 0', fontWeight: 600, wordBreak: 'break-all' }}>{paymentLink}</p>
      </div>
    </div>
  );
}
