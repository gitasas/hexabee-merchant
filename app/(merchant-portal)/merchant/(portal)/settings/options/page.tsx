'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang, type Dict } from '../../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';

type Msg = (t: Dict) => string;

/**
 * The two switches that change how the product behaves day to day.
 *
 * Both save the moment they are pressed - no button, because there is nothing
 * to compose: the choice IS the action. Optimistic update, then PUT, then
 * revert and say so if the server refused. That pattern predates the split
 * and is kept exactly.
 */
export default function OptionsSettingsPage() {
  const router = useRouter();
  const { t } = useLang();

  const [ready, setReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [hasSlug, setHasSlug] = useState(false);

  const [feeMode, setFeeMode] = useState<'merchant' | 'payer'>('merchant');
  const [feeModeSaving, setFeeModeSaving] = useState(false);
  const [feeModeMsg, setFeeModeMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [remindersSaving, setRemindersSaving] = useState(false);
  const [remindersMsg, setRemindersMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (!isOnboardingComplete(data)) { router.push('/merchant/onboarding'); return; }
        setIsStaff(data.role === 'staff');
        setHasSlug(!!data.slug);
        setFeeMode(data.fee_mode === 'payer' ? 'payer' : 'merchant');
        setRemindersEnabled(data.reminders_enabled === true);
        setReady(true);
      });
  }, [router]);

  async function handleFeeModeChange(mode: 'merchant' | 'payer') {
    if (mode === feeMode || feeModeSaving) return;
    const prev = feeMode;
    setFeeMode(mode);
    setFeeModeSaving(true);
    setFeeModeMsg(null);
    try {
      const res = await fetch('/api/merchant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeMode: mode }),
      });
      if (!res.ok) {
        setFeeMode(prev);
        setFeeModeMsg({ ok: false, text: tt => tt.common.saveRetry });
      } else {
        setFeeModeMsg({ ok: true, text: tt => tt.common.saved });
        setTimeout(() => setFeeModeMsg(null), 2000);
      }
    } catch {
      setFeeMode(prev);
      setFeeModeMsg({ ok: false, text: tt => tt.common.saveRetry });
    } finally {
      setFeeModeSaving(false);
    }
  }

  async function handleRemindersChange(enabled: boolean) {
    if (enabled === remindersEnabled || remindersSaving) return;
    const prev = remindersEnabled;
    setRemindersEnabled(enabled);
    setRemindersSaving(true);
    setRemindersMsg(null);
    try {
      const res = await fetch('/api/merchant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindersEnabled: enabled }),
      });
      if (!res.ok) {
        setRemindersEnabled(prev);
        setRemindersMsg({ ok: false, text: tt => tt.common.saveRetry });
      } else {
        setRemindersMsg({ ok: true, text: tt => tt.common.saved });
        setTimeout(() => setRemindersMsg(null), 2000);
      }
    } catch {
      setRemindersEnabled(prev);
      setRemindersMsg({ ok: false, text: tt => tt.common.saveRetry });
    } finally {
      setRemindersSaving(false);
    }
  }

  if (!ready) return <p className="hb-skeleton">{t.common.loading}</p>;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.settings.navOptions}</h1>
          <p className="hb-sub">{t.settings.preferencesSub}</p>
        </div>
      </div>

      {hasSlug && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.whoPaysFee}</h2>
          <p className="hb-card-sub">{t.settings.whoPaysFeeSub}</p>
          <div className="hb-segment">
            {([
              { mode: 'merchant' as const, label: t.settings.iCoverIt },
              { mode: 'payer' as const, label: t.settings.payerCoversIt },
            ]).map(opt => (
              <button
                key={opt.mode}
                type="button"
                className={`hb-btn${feeMode === opt.mode ? ' selected' : ''}`}
                onClick={() => handleFeeModeChange(opt.mode)}
                disabled={feeModeSaving || isStaff}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {feeMode === 'payer' && <p className="hb-note">{t.settings.payerFeeNote}</p>}
          {isStaff && <p className="hb-note">{t.settings.ownerOnlyNote}</p>}
          {feeModeMsg && <p className={`hb-msg ${feeModeMsg.ok ? 'ok' : 'err'}`}>{feeModeMsg.text(t)}</p>}
        </div>
      )}

      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.reminders}</h2>
        <p className="hb-card-sub">{t.settings.remindersSub}</p>
        <div className="hb-segment">
          {([
            { enabled: false, label: t.common.off },
            { enabled: true, label: t.common.on },
          ]).map(opt => (
            <button
              key={opt.label}
              type="button"
              className={`hb-btn${remindersEnabled === opt.enabled ? ' selected' : ''}`}
              onClick={() => handleRemindersChange(opt.enabled)}
              disabled={remindersSaving}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {remindersMsg && <p className={`hb-msg ${remindersMsg.ok ? 'ok' : 'err'}`}>{remindersMsg.text(t)}</p>}
      </div>
    </>
  );
}
