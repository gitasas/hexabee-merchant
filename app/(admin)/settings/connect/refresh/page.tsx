'use client';

import { useEffect } from 'react';

// Stripe redirects here when the onboarding link expires.
// We re-trigger onboarding with the existing account ID.
export default function ConnectRefreshPage() {
  useEffect(() => {
    const accountId = localStorage.getItem('hexabee_stripe_connect_account_id');

    fetch('/api/connect/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: accountId ?? undefined }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.url) {
          if (data.accountId) {
            localStorage.setItem('hexabee_stripe_connect_account_id', data.accountId);
          }
          window.location.href = data.url;
        } else {
          window.location.href = '/settings/connect';
        }
      })
      .catch(() => {
        window.location.href = '/settings/connect';
      });
  }, []);

  return (
    <div style={{ maxWidth: '640px' }}>
      <h1 style={{ marginTop: 0, fontSize: '1.75rem' }}>Stripe Connect</h1>
      <div className="card" style={{ marginTop: '1.2rem' }}>
        <p style={{ color: 'var(--muted)' }}>Refreshing onboarding link…</p>
      </div>
    </div>
  );
}
