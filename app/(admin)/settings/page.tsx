'use client';

import { useState } from 'react';

export default function SettingsPage() {
  const [storeName, setStoreName] = useState('HexaBee Downtown');
  const [notifications, setNotifications] = useState(true);

  return (
    <div style={{ maxWidth: '560px' }}>
      <h1 style={{ marginTop: 0, fontSize: '1.75rem' }}>Settings</h1>
      <p style={{ color: 'var(--muted)', marginTop: '-0.4rem' }}>
        Local-only settings mock. No backend connection yet.
      </p>

      <div className="card" style={{ marginTop: '1.2rem' }}>
        <label htmlFor="storeName" style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
          Store name
        </label>
        <input
          id="storeName"
          value={storeName}
          onChange={(event) => setStoreName(event.target.value)}
          style={{
            width: '100%',
            padding: '0.65rem',
            borderRadius: '10px',
            border: '1px solid var(--border)',
            marginBottom: '1rem',
          }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={notifications}
            onChange={(event) => setNotifications(event.target.checked)}
          />
          Enable order notifications
        </label>
      </div>
    </div>
  );
}
