'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const CONNECT_ACCOUNT_KEY = 'hexabee_stripe_connect_account_id';

type State = 'loading' | 'success' | 'incomplete' | 'error';

export default function ConnectReturnPage() {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    const accountId = localStorage.getItem(CONNECT_ACCOUNT_KEY);

    if (!accountId) {
      setState('error');
      return;
    }

    fetch(`/api/connect/status?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setState('error');
          return;
        }
        setState(data.chargesEnabled && data.payoutsEnabled ? 'success' : 'incomplete');
      })
      .catch(() => setState('error'));
  }, []);

  return (
    <div style={{ maxWidth: '640px' }}>
      <h1 style={{ marginTop: 0, fontSize: '1.75rem' }}>Stripe Connect</h1>

      {state === 'loading' ? (
        <div className="card" style={{ marginTop: '1.2rem' }}>
          <p style={{ color: 'var(--muted)' }}>Checking your account status…</p>
        </div>
      ) : state === 'success' ? (
        <div className="card" style={{ marginTop: '1.2rem' }}>
          <p style={{ color: '#16a34a', fontWeight: 600, fontSize: '1.1rem', margin: '0 0 0.5rem' }}>
            Your Stripe account is connected!
          </p>
          <p style={{ color: 'var(--muted)', margin: '0 0 1rem' }}>
            Charges and payouts are enabled. You can now receive card payments through HexaBee.
          </p>
          <Link
            href="/settings/connect"
            style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}
          >
            ← Back to Connect settings
          </Link>
        </div>
      ) : state === 'incomplete' ? (
        <div className="card" style={{ marginTop: '1.2rem' }}>
          <p style={{ color: '#d97706', fontWeight: 600, fontSize: '1.1rem', margin: '0 0 0.5rem' }}>
            Setup not yet complete
          </p>
          <p style={{ color: 'var(--muted)', margin: '0 0 1rem' }}>
            Your Stripe account needs a few more steps before you can accept payments.
          </p>
          <Link
            href="/settings/connect"
            style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}
          >
            Complete setup →
          </Link>
        </div>
      ) : (
        <div className="card" style={{ marginTop: '1.2rem' }}>
          <p style={{ color: 'var(--muted)' }}>
            Could not verify account status.{' '}
            <Link href="/settings/connect" style={{ color: 'var(--brand)', fontWeight: 600 }}>
              Go back
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
