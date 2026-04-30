'use client';

import { useEffect, useState } from 'react';

const CONNECT_ACCOUNT_KEY = 'hexabee_stripe_connect_account_id';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: '0.4rem',
};

type AccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

export default function ConnectPage() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(CONNECT_ACCOUNT_KEY);
    if (!stored) return;
    setAccountId(stored);
    checkStatus(stored);
  }, []);

  async function checkStatus(id: string) {
    try {
      const res = await fetch(`/api/connect/status?accountId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.ok) {
        setStatus({
          chargesEnabled: data.chargesEnabled,
          payoutsEnabled: data.payoutsEnabled,
          detailsSubmitted: data.detailsSubmitted,
        });
      }
    } catch {
      // silently ignore — status stays null
    }
  }

  async function handleConnect() {
    setLoading(true);
    setStatusMessage('');

    try {
      const res = await fetch('/api/connect/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountId ?? undefined }),
      });

      const data = await res.json();

      if (!data.ok) {
        setStatusMessage(data.error ?? 'Something went wrong.');
        return;
      }

      localStorage.setItem(CONNECT_ACCOUNT_KEY, data.accountId);
      window.location.href = data.url;
    } catch {
      setStatusMessage('Failed to start onboarding. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const isFullyOnboarded = status?.chargesEnabled && status?.payoutsEnabled;

  return (
    <div style={{ maxWidth: '640px' }}>
      <h1 style={{ marginTop: 0, fontSize: '1.75rem' }}>Stripe Connect</h1>
      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        Connect your Stripe account to receive card payments through HexaBee.
      </p>

      <div className="card" style={{ marginTop: '1.2rem' }}>
        <label style={labelStyle}>Connection Status</label>

        {!accountId ? (
          <p style={{ color: 'var(--muted)', margin: '0 0 1rem' }}>No Stripe account connected.</p>
        ) : isFullyOnboarded ? (
          <p style={{ color: '#16a34a', fontWeight: 600, margin: '0 0 1rem' }}>
            Connected — charges and payouts enabled
          </p>
        ) : status ? (
          <p style={{ color: '#d97706', fontWeight: 600, margin: '0 0 1rem' }}>
            Setup incomplete — click below to finish onboarding
          </p>
        ) : (
          <p style={{ color: 'var(--muted)', margin: '0 0 1rem' }}>
            Account ID: <code>{accountId}</code>
          </p>
        )}

        <button
          type="button"
          onClick={handleConnect}
          disabled={loading}
          style={{
            background: 'var(--brand)',
            color: '#111827',
            border: 'none',
            borderRadius: '10px',
            padding: '0.65rem 1rem',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Redirecting…' : isFullyOnboarded ? 'Manage Stripe account' : 'Connect Stripe account'}
        </button>

        {statusMessage ? (
          <p style={{ color: 'var(--muted)', margin: '0.8rem 0 0' }}>{statusMessage}</p>
        ) : null}
      </div>

      {accountId ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>Stripe Account ID</p>
          <p style={{ margin: '0.5rem 0 0', fontWeight: 600, wordBreak: 'break-all' }}>{accountId}</p>
        </div>
      ) : null}
    </div>
  );
}
