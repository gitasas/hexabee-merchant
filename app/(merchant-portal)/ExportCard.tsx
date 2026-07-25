'use client';

import { useState } from 'react';

type Preset = 'this_month' | 'last_month' | 'this_year' | 'all' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

function rangeFor(preset: Preset): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'this_month':
      return { from: iso(new Date(y, m, 1)), to: iso(now) };
    case 'last_month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'this_year':
      return { from: iso(new Date(y, 0, 1)), to: iso(now) };
    default:
      return {};
  }
}

export default function ExportCard() {
  const [preset, setPreset] = useState<Preset>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Most European accounting software and Excel expect semicolons
  const [delimiter, setDelimiter] = useState<'semicolon' | 'comma'>('semicolon');

  function download(type: 'payments' | 'invoices') {
    const range = preset === 'custom' ? { from: customFrom, to: customTo } : rangeFor(preset);
    const params = new URLSearchParams({ type, delimiter });
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    window.location.href = `/api/merchant/export?${params.toString()}`;
  }

  return (
    <div className="hb-card">
      <h2 className="hb-card-title">Export for accounting</h2>
      <p className="hb-card-sub">
        CSV files for your accounting software. Payments include the HexaBee fee and the net
        amount so revenue and costs can be booked separately.
      </p>

      <div className="hb-field">
        Period
        <div className="hb-segment" style={{ flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`hb-btn sm${preset === p.id ? ' selected' : ''}`}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div className="hb-grid-2">
          <label className="hb-field">
            From
            <input
              className="hb-input"
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
            />
          </label>
          <label className="hb-field">
            To
            <input
              className="hb-input"
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="hb-field">
        File format
        <div className="hb-segment">
          <button
            type="button"
            className={`hb-btn sm${delimiter === 'semicolon' ? ' selected' : ''}`}
            onClick={() => setDelimiter('semicolon')}
          >
            Semicolon (EU Excel)
          </button>
          <button
            type="button"
            className={`hb-btn sm${delimiter === 'comma' ? ' selected' : ''}`}
            onClick={() => setDelimiter('comma')}
          >
            Comma (international)
          </button>
        </div>
        <span className="hb-note">
          {delimiter === 'semicolon'
            ? 'Semicolon separated, comma decimals — opens directly in Lithuanian/EU Excel.'
            : 'Comma separated, dot decimals — for Xero, QuickBooks and similar.'}
        </span>
      </div>

      <div className="hb-quick">
        <button type="button" className="hb-btn primary" onClick={() => download('payments')}>
          ⬇ Payments CSV
        </button>
        <button type="button" className="hb-btn" onClick={() => download('invoices')}>
          ⬇ Invoices CSV
        </button>
      </div>
    </div>
  );
}
