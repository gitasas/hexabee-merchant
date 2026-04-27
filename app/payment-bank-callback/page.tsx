'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Status = 'executing' | 'success' | 'error' | 'cancelled';

function CallbackContent() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status>('executing');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const consentToken = params.get('consent');
  const error = params.get('error');
  const amount = params.get('amount');
  const currency = params.get('currency') ?? 'EUR';
  const reference = params.get('reference');
  const iban = params.get('iban');
  const payeeName = params.get('payeeName');
  const institutionId = params.get('institutionId') ?? '';
  const idempotencyId = params.get('idempotencyId') ?? '';

  useEffect(() => {
    if (error) {
      setStatus('cancelled');
      return;
    }

    if (!consentToken) {
      setStatus('error');
      setErrorMsg('Missing consent token from bank');
      return;
    }

    async function execute() {
      try {
        const res = await fetch('/api/payment/bank/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consentToken, amount, currency, reference, iban, payeeName, institutionId, idempotencyId }),
        });

        const data = await res.json();

        if (!res.ok) {
          setStatus('error');
          const detail = data.details?.error?.message ?? data.details?.message ?? data.error ?? 'Payment execution failed';
          setErrorMsg(detail);
          return;
        }

        setPaymentId(data.paymentId);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Network error');
      }
    }

    execute();
  }, [consentToken, error, amount, currency, reference, iban, payeeName]);

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>🐝 HexaBee</div>

        {status === 'executing' && (
          <>
            <div style={styles.spinner} />
            <p style={styles.title}>Processing payment...</p>
            <p style={styles.sub}>Please wait while we confirm with your bank.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={styles.icon}>✓</div>
            <p style={styles.title}>Payment sent</p>
            {amount && (
              <p style={styles.amount}>
                {new Intl.NumberFormat('en-EU', { style: 'currency', currency }).format(Number(amount))}
              </p>
            )}
            {reference && <p style={styles.sub}>Reference: <strong>{reference}</strong></p>}
            {paymentId && <p style={styles.muted}>Payment ID: {paymentId}</p>}
            <button style={styles.btn} onClick={() => window.close()}>Close window</button>
          </>
        )}

        {status === 'cancelled' && (
          <>
            <div style={{ ...styles.icon, background: '#f3f4f6', color: '#6b7280' }}>✕</div>
            <p style={styles.title}>Payment cancelled</p>
            <p style={styles.sub}>You cancelled the authorisation at your bank.</p>
            <button style={{ ...styles.btn, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} onClick={() => window.close()}>
              Close window
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ ...styles.icon, background: '#fef2f2', color: '#dc2626' }}>!</div>
            <p style={styles.title}>Payment failed</p>
            <p style={styles.sub}>{errorMsg ?? 'Something went wrong.'}</p>
            <button style={{ ...styles.btn, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} onClick={() => window.close()}>
              Close window
            </button>
          </>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: 24,
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '40px 32px',
    maxWidth: 420,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 28,
    textAlign: 'left',
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#f0fdf4',
    color: '#16a34a',
    fontSize: 24,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid var(--border)',
    borderTopColor: 'var(--brand)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 20px',
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    margin: '0 0 8px',
  },
  amount: {
    fontSize: 32,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    margin: '12px 0',
  },
  sub: {
    color: 'var(--muted)',
    fontSize: 14,
    margin: '0 0 20px',
  },
  muted: {
    color: 'var(--muted)',
    fontSize: 12,
    marginBottom: 20,
    wordBreak: 'break-all',
  },
  btn: {
    padding: '12px 24px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    background: 'var(--brand)',
    color: '#111',
    width: '100%',
  },
};

export default function PaymentBankCallback() {
  return (
    <Suspense fallback={
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </main>
    }>
      <CallbackContent />
    </Suspense>
  );
}
