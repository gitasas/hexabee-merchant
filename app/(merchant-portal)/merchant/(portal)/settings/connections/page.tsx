'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang, type Dict } from '../../../../i18n';
import { montonioKeyError } from '../../../../montonio-key-error';
import { isOnboardingComplete } from '@/lib/onboarding';

type Msg = (t: Dict) => string;

const isLiveMode = process.env.NEXT_PUBLIC_STRIPE_ENV === 'live';

type Profile = {
  role?: 'owner' | 'staff';
  business_name: string | null;
  stripe_account_id: string | null;
  stripe_account_id_live: string | null;
  payment_rail: string | null;
  montonio_configured: boolean;
  montonio_sandbox?: boolean;
};

/**
 * Connections: the outside companies that move money and send messages for
 * this merchant.
 *
 * Montonio and Tele2 sit together deliberately, and NOT because both happen
 * to be "API keys" - grouping by technical kind is how a page ends up making
 * sense only to the person who built it. They belong together because they
 * are the same job for the merchant: a one-time setup, done by the owner,
 * pasted from a third party, that either works or does not. The SMS message
 * text is daily work and stays with the letter, where that work lives.
 */
export default function ConnectionsSettingsPage() {
  const router = useRouter();
  const { t } = useLang();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [connectStatus, setConnectStatus] = useState<{ chargesEnabled: boolean; payoutsEnabled: boolean } | null>(null);

  const [showKeyForm, setShowKeyForm] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [keysSaving, setKeysSaving] = useState(false);
  const [keysMsg, setKeysMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectMsg, setConnectMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  // The Tele2 credentials are write-only: `hasToken` says whether one exists
  // and the token itself is never returned, exactly like the Montonio keys.
  const [smsHasToken, setSmsHasToken] = useState(false);
  const [smsToken, setSmsToken] = useState('');
  const [smsSender, setSmsSender] = useState('');
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsMsg, setSmsMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  const isStaff = profile?.role === 'staff';

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (!isOnboardingComplete(data)) { router.push('/merchant/onboarding'); return; }
        setProfile(data);
        const activeAccountId = isLiveMode ? data.stripe_account_id_live : data.stripe_account_id;
        if (activeAccountId) {
          fetch(`/api/connect/status?accountId=${encodeURIComponent(activeAccountId)}`)
            .then(r => r.json())
            .then(s => { if (s.ok) setConnectStatus({ chargesEnabled: s.chargesEnabled, payoutsEnabled: s.payoutsEnabled }); })
            .catch(() => null);
        }
      });

    fetch('/api/merchant/sms-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setSmsHasToken(d.hasToken === true);
        setSmsSender(d.senderName ?? '');
      })
      .catch(() => { /* the bank half of this page works without it */ });
  }, [router]);

  async function handleSaveKeys(e: React.FormEvent) {
    e.preventDefault();
    setKeysSaving(true);
    setKeysMsg(null);
    try {
      const res = await fetch('/api/merchant/montonio-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: accessKey.trim(), secretKey: secretKey.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setKeysMsg({ ok: false, text: montonioKeyError(res.status) });
        if (data?.error) console.error('[settings/connections] montonio keys failed', res.status, data.error);
        return;
      }
      setKeysMsg({ ok: true, text: tt => tt.onboarding.keysStored });
      setProfile(p => (p ? { ...p, montonio_configured: true } : p));
      setAccessKey('');
      setSecretKey('');
      setShowKeyForm(false);
    } catch {
      setKeysMsg({ ok: false, text: tt => tt.common.saveFailed });
    } finally {
      setKeysSaving(false);
    }
  }

  async function handleConnect() {
    setConnectLoading(true);
    setConnectMsg(null);
    try {
      const res = await fetch('/api/connect/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.ok) {
        setConnectMsg({ ok: false, text: (tt: Dict) => tt.settings.onboardFailed });
        if (data?.error) console.error('[settings/connections] connect onboard failed', data.error);
        return;
      }
      window.location.href = data.url;
    } catch {
      setConnectMsg({ ok: false, text: tt => tt.common.genericError });
    } finally {
      setConnectLoading(false);
    }
  }

  /**
   * Credentials only. The message template saves on its own page, which is
   * what stopped a rejected template from taking the key down with it
   * (SB „Žaluma", on a call, 2026-10-16).
   */
  async function saveSmsCredentials() {
    if (smsSaving) return;
    setSmsSaving(true);
    setSmsMsg(null);
    try {
      const body: Record<string, string> = {};
      // Omitting `token` means "leave it alone"; an empty string would be read
      // as "remove it", so a sender-name change alone must not send the key.
      if (smsToken.trim()) body.token = smsToken.trim();
      if (!isStaff) body.senderName = smsSender;
      const res = await fetch('/api/merchant/sms-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (smsToken.trim()) setSmsHasToken(true);
        setSmsToken('');
        setSmsMsg({ ok: true, text: (tt: Dict) => tt.common.saved });
      } else {
        setSmsMsg({
          ok: false,
          text: res.status === 403
            ? (tt: Dict) => tt.settings.ownerOnlyNote
            : (tt: Dict) => tt.settings.smsSaveFailed,
        });
      }
    } catch {
      setSmsMsg({ ok: false, text: (tt: Dict) => tt.settings.smsSaveFailed });
    } finally {
      setSmsSaving(false);
    }
  }

  if (!profile) return <p className="hb-skeleton">{t.common.loading}</p>;

  const activeAccountId = isLiveMode ? profile.stripe_account_id_live : profile.stripe_account_id;
  const isMontonio = profile.payment_rail === 'montonio';

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.settings.navConnections}</h1>
          <p className="hb-sub">{t.settings.rowConnectionsSub}</p>
        </div>
      </div>

      {/* Bank payments - Montonio merchants have no Stripe account and never
          will, so showing them a Stripe card is showing them a product they
          cannot use and did not ask for. */}
      {isMontonio ? (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.bankPayments}</h2>
          <p className="hb-card-sub">{t.settings.bankPaymentsSub}</p>
          <div className="hb-actions">
            <span className={`hb-badge ${profile.montonio_configured ? 'is-paid' : 'is-pending'}`}>
              {profile.montonio_sandbox
                ? t.onboarding.sandboxReady
                : profile.montonio_configured ? t.settings.bankConnected : t.onboarding.bankPending}
            </span>
          </div>
          {showKeyForm ? (
            <form onSubmit={handleSaveKeys} style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input className="hb-input" placeholder={t.onboarding.accessKeyPlaceholder} value={accessKey} autoComplete="off" onChange={e => setAccessKey(e.target.value)} required />
              <input className="hb-input" type="password" placeholder={t.onboarding.secretKeyPlaceholder} value={secretKey} autoComplete="new-password" onChange={e => setSecretKey(e.target.value)} required />
              <div className="hb-actions">
                <button type="submit" className="hb-btn primary" disabled={keysSaving}>
                  {keysSaving ? t.onboarding.checkingKeys : t.onboarding.connectStore}
                </button>
              </div>
              {keysMsg && <p className={`hb-msg ${keysMsg.ok ? 'ok' : 'err'}`}>{keysMsg.text(t)}</p>}
            </form>
          ) : (
            <div className="hb-actions" style={{ marginTop: 12 }}>
              <button type="button" className="hb-btn" onClick={() => setShowKeyForm(true)}>{t.settings.replaceKeys}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.stripeConnect} {isLiveMode ? t.settings.liveMode : t.settings.testMode}</h2>
          <p className="hb-card-sub">{t.settings.stripeSub}</p>
          {activeAccountId ? (
            <>
              <div className="hb-actions">
                <span className={`hb-badge ${connectStatus?.chargesEnabled ? 'is-paid' : 'is-pending'}`}>
                  {connectStatus?.chargesEnabled ? t.settings.chargesEnabled : t.settings.chargesPending}
                </span>
                <span className={`hb-badge ${connectStatus?.payoutsEnabled ? 'is-paid' : 'is-pending'}`}>
                  {connectStatus?.payoutsEnabled ? t.settings.payoutsEnabled : t.settings.payoutsPending}
                </span>
              </div>
              <p className="hb-note hb-mono">{activeAccountId}</p>
              {connectStatus && !connectStatus.chargesEnabled && (
                <div className="hb-actions" style={{ marginTop: 12 }}>
                  <button type="button" className="hb-btn" onClick={handleConnect} disabled={connectLoading}>
                    {connectLoading ? t.settings.redirecting : t.settings.completeStripe}
                  </button>
                </div>
              )}
            </>
          ) : (
            <button type="button" className="hb-btn primary" onClick={handleConnect} disabled={connectLoading}>
              {connectLoading ? t.settings.redirecting : t.settings.connectStripe}
            </button>
          )}
          {connectMsg && <p className="hb-msg err">{connectMsg.text(t)}</p>}
        </div>
      )}

      {/* SMS sending - the credentials only. */}
      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.smsCredentials}</h2>
        <p className="hb-card-sub">{t.settings.smsWhoseAccount}</p>

        <div className="hb-actions">
          <span className={`hb-badge ${smsHasToken ? 'is-paid' : 'is-pending'}`}>
            {smsHasToken ? t.settings.smsKeySet : t.settings.smsKeyMissing}
          </span>
        </div>

        <label className="hb-label" htmlFor="sms-sender">{t.settings.smsSender}</label>
        {/* ⚠️ No placeholder, and specifically not the merchant's own business
            name: Tele2 accept only a sender name they have themselves
            activated, and suggesting the company name sends the merchant
            straight into "Invalid sender name provided". */}
        <input
          id="sms-sender"
          className="hb-input"
          value={smsSender}
          maxLength={40}
          disabled={isStaff}
          onChange={e => { setSmsSender(e.target.value); setSmsMsg(null); }}
        />
        <p className="hb-note">{t.settings.smsSenderNote}</p>

        <label className="hb-label" htmlFor="sms-token" style={{ marginTop: 12 }}>{t.settings.smsToken}</label>
        <input
          id="sms-token"
          className="hb-input"
          type="password"
          autoComplete="off"
          value={smsToken}
          disabled={isStaff}
          placeholder={smsHasToken ? t.settings.smsTokenStored : t.settings.smsTokenPlaceholder}
          onChange={e => { setSmsToken(e.target.value); setSmsMsg(null); }}
        />
        <p className="hb-note">{smsHasToken ? t.settings.smsTokenReplace : t.settings.smsTokenWhere}</p>
        {isStaff && <p className="hb-note">{t.settings.ownerOnlyNote}</p>}

        {/* ⚠️ Yellow only while something still needs doing.
            The bank card above goes quiet once the store is connected - badge
            plus a plain button - while this one stayed primary-yellow for
            ever, so a fully configured page kept shouting one unfinished-
            looking task at the merchant. Spotted by Gytis on staging
            2026-10-19. With a key stored the button also saves the sender
            name, so it says "save changes" rather than naming the key. */}
        <div className="hb-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`hb-btn${smsHasToken ? '' : ' primary'}`}
            onClick={saveSmsCredentials}
            disabled={smsSaving || isStaff}
          >
            {smsSaving ? t.settings.saving : smsHasToken ? t.settings.smsSaveChanges : t.settings.smsSaveKey}
          </button>
        </div>
        {smsMsg && <p className={`hb-msg ${smsMsg.ok ? 'ok' : 'err'}`}>{smsMsg.text(t)}</p>}
      </div>
    </>
  );
}
