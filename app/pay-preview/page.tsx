'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

type ParsedPdf = {
  success?: boolean;
  amount?: string | null;
  currency?: string | null;
  reference?: string | null;
  iban?: string | null;
  error?: string;
};

type ExtensionPayload = {
  source?: string;
  subject?: string;
  body?: string;
  detectedAt?: string;
  admin_invoice_id?: string;
  email?: string;
  parsedPdf?: ParsedPdf;
};

type Institution = {
  id: string;
  name: string;
  countries: string[];
  logo: string | null;
};

function PayPreviewContent() {
  const params = useSearchParams();
  const [loading, setLoading] = useState<'card' | 'bank' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [bankSearch, setBankSearch] = useState('');

  let parsed: ExtensionPayload | null = null;
  try {
    const raw = params.get('payload');
    parsed = raw ? JSON.parse(decodeURIComponent(raw)) : null;
  } catch {
    // invalid payload
  }

  const pdf = parsed?.parsedPdf;
  const amount = pdf?.amount ?? null;
  const currency = pdf?.currency ?? 'EUR';
  const reference = pdf?.reference ?? null;
  const iban = pdf?.iban ?? null;

  const formattedAmount = amount
    ? new Intl.NumberFormat('en-EU', { style: 'currency', currency: currency || 'EUR' }).format(Number(amount))
    : null;

  async function handleStripe() {
    if (!amount) return;
    setError(null);
    setLoading('card');
    try {
      const res = await fetch('/api/payment/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          currency,
          reference,
          email: parsed?.email ?? 'demo@hexabee.com',
          admin_invoice_id: parsed?.admin_invoice_id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.payment_url) {
        setError(data.error || 'Could not create payment session');
        return;
      }
      window.location.href = data.payment_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(null);
    }
  }

  async function openBankPicker() {
    setShowBankPicker(true);
    if (institutions.length > 0) return;
    setInstitutionsLoading(true);
    try {
      const res = await fetch('/api/payment/bank/institutions');
      const data = await res.json();
      setInstitutions(Array.isArray(data) ? data : []);
    } catch {
      setInstitutions([]);
    } finally {
      setInstitutionsLoading(false);
    }
  }

  async function handleBankSelect(institutionId: string) {
    if (!amount || !iban) return;
    setShowBankPicker(false);
    setError(null);
    setLoading('bank');
    try {
      const res = await fetch('/api/payment/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          currency,
          reference,
          iban,
          payeeName: parsed?.subject ?? null,
          institutionId,
          email: parsed?.email ?? 'demo@hexabee.com',
          adminInvoiceId: parsed?.admin_invoice_id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.authorisationUrl) {
        setError(data.error || 'Could not initiate bank payment');
        return;
      }
      window.location.href = data.authorisationUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(null);
    }
  }

  const filteredInstitutions = institutions.filter(i =>
    i.name.toLowerCase().includes(bankSearch.toLowerCase())
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowBankPicker(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!parsed || !pdf?.success) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <img src="/hexabee-logo.png" alt="HexaBee" style={{ height: 28, display: 'block' }} />
          <p style={{ color: 'var(--muted)', marginTop: 12 }}>
            {pdf?.error ?? 'No invoice data found.'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <main style={styles.page}>
        <div style={styles.card}>
          <img src="/hexabee-logo.png" alt="HexaBee" style={{ height: 28, display: 'block' }} />
          <p style={styles.subtitle}>Invoice payment</p>

          <div style={styles.amountBlock}>
            {formattedAmount ?? `${amount} ${currency}`}
          </div>

          <div style={styles.details}>
            <Row label="Reference" value={reference ?? '—'} />
            <Row label="IBAN" value={iban ?? '—'} mono />
            {parsed?.subject && <Row label="Subject" value={parsed.subject} />}
          </div>

          {error && <p style={styles.errorText}>{error}</p>}

          <div style={styles.buttons}>
            <button
              style={{ ...styles.btn, ...styles.btnPrimary, opacity: loading ? 0.7 : 1 }}
              onClick={handleStripe}
              disabled={!!loading || !amount}
            >
              {loading === 'card' ? 'Redirecting...' : 'Pay by Card'}
            </button>

            <button
              style={{ ...styles.btn, ...styles.btnSecondary, opacity: loading ? 0.7 : 1 }}
              onClick={openBankPicker}
              disabled={!!loading || !amount || !iban}
            >
              {loading === 'bank' ? 'Connecting...' : 'Pay from Bank'}
            </button>
          </div>
        </div>
      </main>

      {showBankPicker && (
        <div style={styles.overlay} onClick={() => setShowBankPicker(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Select your bank</span>
              <button style={styles.closeBtn} onClick={() => setShowBankPicker(false)}>✕</button>
            </div>

            <input
              style={styles.searchInput}
              placeholder="Search banks..."
              value={bankSearch}
              onChange={e => setBankSearch(e.target.value)}
              autoFocus
            />

            <div style={styles.institutionList}>
              {institutionsLoading && (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>Loading banks...</p>
              )}

              {!institutionsLoading && filteredInstitutions.length === 0 && (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>No banks found</p>
              )}

              {filteredInstitutions.map(inst => (
                <button
                  key={inst.id}
                  style={styles.institutionBtn}
                  onClick={() => handleBankSelect(inst.id)}
                >
                  {inst.id.endsWith('-sandbox') && (
                    <span style={{ position: 'absolute', top: 6, right: 12, fontSize: 10, color: 'var(--muted)', background: 'var(--bg)', borderRadius: 4, padding: '1px 5px' }}>sandbox</span>
                  )}
                  {inst.logo
                    ? <img src={inst.logo} alt="" style={styles.institutionLogo} />
                    : <div style={styles.institutionLogoPlaceholder}>🏦</div>
                  }
                  <span style={styles.institutionName}>{inst.name}</span>
                  <span style={styles.institutionCountries}>{inst.countries.slice(0, 3).join(', ')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={{ ...styles.rowValue, fontFamily: mono ? 'monospace' : 'inherit' }}>
        {value}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: '24px 16px',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '36px 32px',
    maxWidth: 460,
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
  },
  logo: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: 'var(--muted)',
    fontSize: 14,
    margin: '4px 0 0',
  },
  amountBlock: {
    fontSize: 42,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    margin: '28px 0 24px',
    color: 'var(--text)',
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    background: 'var(--bg)',
    borderRadius: 12,
    padding: '16px 18px',
    marginBottom: 28,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    fontSize: 14,
  },
  rowLabel: {
    color: 'var(--muted)',
    flexShrink: 0,
  },
  rowValue: {
    color: 'var(--text)',
    fontWeight: 500,
    textAlign: 'right',
    wordBreak: 'break-all',
  },
  buttons: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  btn: {
    width: '100%',
    padding: '14px 20px',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    transition: 'opacity 0.15s',
  },
  btnPrimary: {
    background: 'var(--brand)',
    color: '#111',
  },
  btnSecondary: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 16,
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: '24px 16px',
  },
  modal: {
    background: 'var(--surface)',
    borderRadius: 20,
    width: '100%',
    maxWidth: 480,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 20px 12px',
    borderBottom: '1px solid var(--border)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    color: 'var(--muted)',
    padding: 4,
  },
  searchInput: {
    margin: '12px 16px',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    fontSize: 14,
    outline: 'none',
    background: 'var(--bg)',
  },
  institutionList: {
    overflowY: 'auto',
    flex: 1,
    padding: '4px 8px 16px',
  },
  institutionBtn: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.1s',
  },
  institutionLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    objectFit: 'contain',
    flexShrink: 0,
    border: '1px solid var(--border)',
  },
  institutionLogoPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: 'var(--bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    flexShrink: 0,
  },
  institutionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 500,
  },
  institutionCountries: {
    fontSize: 12,
    color: 'var(--muted)',
    flexShrink: 0,
  },
};

export default function PayPreview() {
  return (
    <Suspense fallback={
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </main>
    }>
      <PayPreviewContent />
    </Suspense>
  );
}
