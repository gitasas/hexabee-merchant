'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLang, type Dict } from '../../../i18n';
import { SETTINGS_SECTIONS, type SettingsSection } from './sections';

/**
 * The Settings index: a list of the sub-pages, each carrying its own status.
 *
 * The status chips are the point of this screen. "Can I take a payment, and
 * can I send a text message?" used to be answerable only by scrolling through
 * three separate cards in one 5.5-screen page - the bank card sat 93% of the
 * way down it. Here both answers are above the fold on a phone.
 */
type Status = { ok: boolean; text: (t: Dict) => string };

export default function SettingsIndexPage() {
  const { t } = useLang();
  const [bank, setBank] = useState<Status | null>(null);
  const [sms, setSms] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => (r.ok ? r.json() : null))
      .then(p => {
        if (!p) return;
        // The question is "can this merchant take a payment", so it has to be
        // asked of the rail they are actually on - a Montonio merchant will
        // never satisfy a Stripe condition, and the failure would be silent.
        const ready = p.payment_rail === 'montonio'
          ? p.montonio_configured === true
          : !!(p.stripe_account_id_live || p.stripe_account_id);
        setBank({
          ok: ready,
          text: ready ? (tt: Dict) => tt.settings.bankConnected : (tt: Dict) => tt.onboarding.bankPending,
        });
      })
      .catch(() => { /* the list still works without a chip */ });

    fetch('/api/merchant/sms-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        const has = d.hasToken === true;
        setSms({
          ok: has,
          text: has ? (tt: Dict) => tt.settings.smsKeySet : (tt: Dict) => tt.settings.smsKeyMissing,
        });
      })
      .catch(() => { /* same */ });
  }, []);

  function chips(section: SettingsSection) {
    if (section.slug !== 'connections') return null;
    return (
      <span className="hb-row-chips">
        {bank && <span className={`hb-badge ${bank.ok ? 'is-paid' : 'is-pending'}`}>{bank.text(t)}</span>}
        {sms && <span className={`hb-badge ${sms.ok ? 'is-paid' : 'is-pending'}`}>{sms.text(t)}</span>}
      </span>
    );
  }

  const rows = SETTINGS_SECTIONS;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.settings.title}</h1>
          <p className="hb-sub">{t.settings.indexSub}</p>
        </div>
      </div>

      <div className="hb-card hb-rows">
        {rows.map((s, i) => (
          <Link key={`${s.slug}-${i}`} href={`/merchant/settings/${s.slug}`} className="hb-row">
            <span className="hb-row-main">
              <span className="hb-row-label">{s.label(t)}</span>
              <span className="hb-row-sub">{s.sub(t)}</span>
            </span>
            {chips(s)}
            <span className="hb-row-chevron" aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    </>
  );
}
