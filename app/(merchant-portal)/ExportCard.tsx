'use client';

import { useState } from 'react';
import { useLang } from './i18n';

type Preset = 'this_month' | 'last_month' | 'this_year' | 'all' | 'custom';

const PRESET_IDS: Preset[] = ['this_month', 'last_month', 'this_year', 'all', 'custom'];

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
  const { t } = useLang();
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
      <h2 className="hb-card-title">{t.exportCard.title}</h2>
      <p className="hb-card-sub">{t.exportCard.sub}</p>

      <div className="hb-field">
        {t.exportCard.period}
        <div className="hb-segment" style={{ flexWrap: 'wrap' }}>
          {PRESET_IDS.map(id => (
            <button
              key={id}
              type="button"
              className={`hb-btn sm${preset === id ? ' selected' : ''}`}
              onClick={() => setPreset(id)}
            >
              {t.exportCard.presets[id]}
            </button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div className="hb-grid-2">
          <label className="hb-field">
            {t.exportCard.from}
            <input
              className="hb-input"
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
            />
          </label>
          <label className="hb-field">
            {t.exportCard.to}
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
        {t.exportCard.fileFormat}
        <div className="hb-segment">
          <button
            type="button"
            className={`hb-btn sm${delimiter === 'semicolon' ? ' selected' : ''}`}
            onClick={() => setDelimiter('semicolon')}
          >
            {t.exportCard.semicolon}
          </button>
          <button
            type="button"
            className={`hb-btn sm${delimiter === 'comma' ? ' selected' : ''}`}
            onClick={() => setDelimiter('comma')}
          >
            {t.exportCard.comma}
          </button>
        </div>
        <span className="hb-note">
          {delimiter === 'semicolon' ? t.exportCard.semicolonNote : t.exportCard.commaNote}
        </span>
      </div>

      <div className="hb-quick">
        <button type="button" className="hb-btn primary" onClick={() => download('payments')}>
          {t.exportCard.paymentsCsv}
        </button>
        <button type="button" className="hb-btn" onClick={() => download('invoices')}>
          {t.exportCard.invoicesCsv}
        </button>
      </div>
    </div>
  );
}
