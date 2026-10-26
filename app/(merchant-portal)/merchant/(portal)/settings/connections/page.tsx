'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang, type Dict } from '../../../../i18n';
import { montonioKeyError } from '../../../../montonio-key-error';
import { isOnboardingComplete } from '@/lib/onboarding';

type Msg = (t: Dict) => string;

type RivileStatus = {
  configured: boolean;
  valid_until: string | null;
  days_left: number | null;
  expired: boolean;
  last_sync_at?: string | null;
  pending_first_read?: boolean;
  stale?: boolean;
  last_open_items?: number | null;
  last_closed?: number | null;
  has_error?: boolean;
};

type CentasStatus = {
  configured: boolean;
  valid_until: string | null;
  days_left: number | null;
  expired: boolean;
  // ⚠️ When their accounting was last read, and whether that has gone stale.
  // A dead link answers exactly the way a clean ledger does, so this is the
  // only thing that tells working from broken - and it is their reminders
  // reaching their own customers, so they get to see it.
  last_sync_at?: string | null;
  stale?: boolean;
  pending_first_read?: boolean;
  stale_after_hours?: number;
  last_documents?: number | null;
  last_closed?: number | null;
  has_error?: boolean;
};

/**
 * How long a key has left, in words rather than as a bare date.
 *
 * ⚠️ Both keys on this page stop working on a date, and the two failures are
 * not alike - which is why the wording is shared but the consequence is not.
 * An expired Tele2 key fails a send loudly: the batch stops and says so. An
 * expired Centas key answers "no documents", which the reader cannot tell
 * apart from "nobody owes anything", so nothing closes and reminders quietly
 * resume going to people who have already paid. The date is a convenience on
 * one card and the only warning there will ever be on the other.
 *
 * Days, not just the date: "2026-11-22" asks the reader to do subtraction, and
 * nobody does it.
 */
function expiryNote(t: Dict, validUntil: string | null): { text: string; bad: boolean } | null {
  if (!validUntil) return null;
  const day = new Date(`${validUntil}T00:00:00`);
  if (Number.isNaN(day.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: t.settings.expiredOn.replace('{date}', validUntil), bad: true };
  if (days === 0) return { text: t.settings.expiresToday, bad: true };
  return {
    text: `${validUntil} - ${t.settings.expiresInDays.replace('{n}', String(days))}`,
    // Three weeks is enough notice to ask a bookkeeper for a new key without
    // it becoming an emergency.
    bad: days <= 21,
  };
}

const isLiveMode = process.env.NEXT_PUBLIC_STRIPE_ENV === 'live';

type Profile = {
  role?: 'owner' | 'staff';
  business_country?: string | null;
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
  const [smsValidUntil, setSmsValidUntil] = useState('');
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsMsg, setSmsMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  // Centas accounting. Read-only access to the merchant's own books, so an
  // invoice settled by a plain bank transfer stops being chased here.
  const [centas, setCentas] = useState<CentasStatus | null>(null);
  const [centasToken, setCentasToken] = useState('');
  const [centasSaving, setCentasSaving] = useState(false);
  const [centasMsg, setCentasMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  // Rivilė ERP. Same job as the Centas card, and shown beside it because a
  // merchant uses one or the other and knows which.
  const [rivile, setRivile] = useState<RivileStatus | null>(null);
  const [rivileKey, setRivileKey] = useState('');
  const [rivileUntil, setRivileUntil] = useState('');
  const [rivileSaving, setRivileSaving] = useState(false);
  const [rivileMsg, setRivileMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

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
        setSmsValidUntil(d.tokenValidUntil ?? '');
      })
      .catch(() => { /* the bank half of this page works without it */ });

    fetch('/api/merchant/centas-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setCentas(d); })
      .catch(() => { /* an unreachable accounting service must not blank the page */ });

    fetch('/api/merchant/rivile-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setRivile(d);
        setRivileUntil(d.valid_until ?? '');
      })
      .catch(() => { /* same */ });
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
        if (smsToken.trim()) {
          setSmsHasToken(true);
          // The expiry is derived from the key the backend just stored, so it
          // is only knowable after the save. Without this the card keeps
          // showing the old key's date next to the new key - the one place a
          // stale value here would actively mislead.
          fetch('/api/merchant/sms-settings')
            .then(r => (r.ok ? r.json() : null))
            .then(d => { if (d) setSmsValidUntil(d.tokenValidUntil ?? ''); })
            .catch(() => null);
        }
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

  /**
   * Store or clear the Centas key.
   *
   * ⚠️ The backend proves the key against Centas before storing it, so a
   * failure here is a real answer worth showing - and the status is mapped to
   * a dictionary key rather than printing `data.error`, which is the
   * backend's own English and would answer a Lithuanian merchant in English.
   */
  async function saveCentas(clear = false) {
    if (centasSaving) return;
    setCentasSaving(true);
    setCentasMsg(null);
    try {
      const res = await fetch('/api/merchant/centas-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: clear ? '' : centasToken.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCentasMsg({
          ok: false,
          text: res.status === 403
            ? (tt: Dict) => tt.settings.ownerOnlyNote
            : res.status === 502
              ? (tt: Dict) => tt.settings.centasUnreachable
              : (tt: Dict) => tt.settings.centasRejected,
        });
        if (data?.error) console.error('[settings/connections] centas save failed', res.status, data.error);
        return;
      }
      setCentas(data as CentasStatus);
      setCentasToken('');
      setCentasMsg({ ok: true, text: (tt: Dict) => tt.common.saved });
    } catch {
      setCentasMsg({ ok: false, text: (tt: Dict) => tt.settings.centasUnreachable });
    } finally {
      setCentasSaving(false);
    }
  }

  async function saveRivile(clear = false) {
    if (rivileSaving) return;
    setRivileSaving(true);
    setRivileMsg(null);
    try {
      const res = await fetch('/api/merchant/rivile-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: clear ? '' : rivileKey.trim(),
          validUntil: clear ? '' : rivileUntil,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRivileMsg({
          ok: false,
          text: res.status === 403
            ? (tt: Dict) => tt.settings.ownerOnlyNote
            : res.status === 502
              ? (tt: Dict) => tt.settings.rivileUnreachable
              : (tt: Dict) => tt.settings.rivileRejected,
        });
        if (data?.error) console.error('[settings/connections] rivile save failed', res.status, data.error);
        return;
      }
      setRivile(data as RivileStatus);
      setRivileKey('');
      setRivileMsg({ ok: true, text: (tt: Dict) => tt.common.saved });
    } catch {
      setRivileMsg({ ok: false, text: (tt: Dict) => tt.settings.rivileUnreachable });
    } finally {
      setRivileSaving(false);
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

        {/* ⚠️ Read out of the key, not asked for. Tele2 said their keys do not
            expire; SB „Žaluma"'s expires on 2027-01-31, and the date is
            printed inside the JWT the merchant pastes. Nothing to type, and
            nothing to get wrong. */}
        {(() => {
          const note = expiryNote(t, smsValidUntil || null);
          return note ? (
            <p className={`hb-note${note.bad ? ' hb-note-warn' : ''}`}>
              {t.settings.smsValidUntil}: {note.text}
            </p>
          ) : null;
        })()}

        <label className="hb-label" htmlFor="sms-token">{t.settings.smsToken}</label>
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

      {/* Accounting. Third on this page on purpose: it is the one connection a
          merchant can live without - the other two decide whether they can be
          paid at all, this one only decides whether we stop chasing.

          ⚠️ Shown to Lithuanian merchants, and to anyone who already has a key
          stored. Centas is Lithuanian accounting software, so offering it to a
          UK merchant on Stripe is offering a product they have never heard of
          and cannot use - and this page is where they go to find the two
          settings that decide whether they can be paid at all. The
          already-configured case is in the condition on purpose: a card that
          disappeared after someone changed their country would hide a live
          integration rather than tidy the page. */}
      {(profile.business_country === 'LT' || centas?.configured) && (
      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.centasTitle}</h2>
        <p className="hb-card-sub">{t.settings.centasSub}</p>

        <div className="hb-actions">
          <span className={`hb-badge ${centas?.configured && !centas?.expired ? 'is-paid' : 'is-pending'}`}>
            {centas?.configured ? t.settings.centasConnected : t.settings.centasMissing}
          </span>
        </div>

        {/* ⚠️ The expiry is the whole reason this card shows a date at all.
            An expired Centas key answers "no documents", which is read as
            "nothing is owed" - so the integration stops working and reports
            success, while reminders resume reaching people who have paid.
            Nothing else anywhere would say so. */}
        {centas?.configured && (() => {
          const note = expiryNote(t, centas.valid_until);
          return (
            <>
              {note && (
                <p className={`hb-note${note.bad ? ' hb-note-warn' : ''}`}>
                  {t.settings.smsValidUntil}: {note.text}
                </p>
              )}
              {centas.expired && <p className="hb-msg err">{t.settings.centasExpiredNote}</p>}

              {/* ⚠️ The only thing that tells a working link from a dead one.
                  Every way this breaks answers the way a clean ledger does, so
                  without this line the merchant's reminders could quietly go
                  back to chasing customers who have already paid and nothing
                  anywhere would say why. Shown even when healthy, because a
                  warning nobody has ever seen in its normal state is a
                  warning nobody trusts. */}
              {/* ⚠️ Three states, and the middle one was wrong until the
                  first real key was pasted on staging: a key saved minutes
                  ago reported "we have not managed to read your accounting
                  for some hours", when nothing had failed and nothing had
                  been attempted. Pending is not a fault and must not read as
                  one. */}
              {centas.pending_first_read ? (
                <p className="hb-note">{t.settings.centasPendingNote}</p>
              ) : centas.stale && !centas.expired ? (
                <p className="hb-msg err">{t.settings.centasStaleNote}</p>
              ) : centas.has_error && !centas.expired ? (
                /* ⚠️ We ARE reading their accounting - every hour, fine. What
                   we cannot do is settle from it. Routing this through the
                   stale message told a merchant we could not reach them and
                   sent them to check a key that was perfectly good. Different
                   problem, different sentence, and no blame on their side. */
                <p className="hb-msg err">{t.settings.centasUnusableNote}</p>
              ) : centas.last_sync_at ? (
                <p className="hb-note">
                  {t.settings.centasLastRead}:{' '}
                  {new Date(centas.last_sync_at).toLocaleString(t.locale)}
                  {typeof centas.last_documents === 'number'
                    ? ` - ${t.settings.centasLastDocuments.replace('{n}', String(centas.last_documents))}`
                    : ''}
                </p>
              ) : null}
            </>
          );
        })()}

        <label className="hb-label" htmlFor="centas-token">{t.settings.centasToken}</label>
        <input
          id="centas-token"
          className="hb-input"
          type="password"
          autoComplete="off"
          value={centasToken}
          placeholder={centas?.configured ? t.settings.centasTokenStored : t.settings.centasTokenPlaceholder}
          onChange={e => { setCentasToken(e.target.value); setCentasMsg(null); }}
        />
        <p className="hb-note">{centas?.configured ? t.settings.centasTokenReplace : t.settings.centasTokenWhere}</p>
        {/* ⚠️ No owner-only note here on purpose - the key belongs to whoever
            holds it, which at a school is the bookkeeper, not the director.
            See /api/merchant/centas-settings for why that is the safer way
            round. */}

        {/* Yellow only while something still needs doing - same rule as the
            Tele2 card above. An expired key counts as unfinished. */}
        <div className="hb-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`hb-btn${centas?.configured && !centas.expired ? '' : ' primary'}`}
            onClick={() => saveCentas(false)}
            disabled={centasSaving || !centasToken.trim()}
          >
            {centasSaving ? t.settings.saving : centas?.configured ? t.settings.centasSaveChanges : t.settings.centasSaveKey}
          </button>
          {centas?.configured && (
            <button
              type="button"
              className="hb-btn"
              onClick={() => saveCentas(true)}
              disabled={centasSaving}
            >
              {t.settings.centasDisconnect}
            </button>
          )}
        </div>
        {centasMsg && <p className={`hb-msg ${centasMsg.ok ? 'ok' : 'err'}`}>{centasMsg.text(t)}</p>}
      </div>
      )}

      {/* Rivilė ERP - the same job as the card above, for merchants on the
          other accounting system. Shown beside it rather than behind a
          chooser: a bookkeeper knows which program she uses, and a chooser
          would be one more thing to get wrong on the day she connects it. */}
      {(profile.business_country === 'LT' || rivile?.configured) && (
      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.rivileTitle}</h2>
        <p className="hb-card-sub">{t.settings.rivileSub}</p>

        <div className="hb-actions">
          <span className={`hb-badge ${rivile?.configured && !rivile?.expired ? 'is-paid' : 'is-pending'}`}>
            {rivile?.configured ? t.settings.centasConnected : t.settings.centasMissing}
          </span>
        </div>

        {rivile?.configured && (() => {
          const note = expiryNote(t, rivile.valid_until);
          return (
            <>
              {note && (
                <p className={`hb-note${note.bad ? ' hb-note-warn' : ''}`}>
                  {t.settings.smsValidUntil}: {note.text}
                </p>
              )}
              {rivile.expired && <p className="hb-msg err">{t.settings.centasExpiredNote}</p>}
              {rivile.pending_first_read ? (
                <p className="hb-note">{t.settings.rivilePendingNote}</p>
              ) : rivile.stale && !rivile.expired ? (
                <p className="hb-msg err">{t.settings.centasStaleNote}</p>
              ) : rivile.has_error && !rivile.expired ? (
                <p className="hb-msg err">{t.settings.centasUnusableNote}</p>
              ) : rivile.last_sync_at ? (
                <p className="hb-note">
                  {t.settings.centasLastRead}: {new Date(rivile.last_sync_at).toLocaleString(t.locale)}
                </p>
              ) : null}
            </>
          );
        })()}

        <label className="hb-label" htmlFor="rivile-key">{t.settings.rivileKey}</label>
        <input
          id="rivile-key"
          className="hb-input"
          type="password"
          autoComplete="off"
          value={rivileKey}
          placeholder={rivile?.configured ? t.settings.centasTokenStored : t.settings.rivileKeyPlaceholder}
          onChange={e => { setRivileKey(e.target.value); setRivileMsg(null); }}
        />

        {/* ⚠️ Typed in, because Rivilė will not tell us. Their check answers a
            bare "valid" with no date, and there is nothing in the key to
            decode - yet it expires on a date chosen when it was made. */}
        <label className="hb-label" htmlFor="rivile-until">{t.settings.rivileValidUntil}</label>
        <input
          id="rivile-until"
          className="hb-input"
          type="date"
          value={rivileUntil}
          onChange={e => { setRivileUntil(e.target.value); setRivileMsg(null); }}
        />
        <p className="hb-note">{t.settings.rivileWhere}</p>

        <div className="hb-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`hb-btn${rivile?.configured && !rivile.expired ? '' : ' primary'}`}
            onClick={() => saveRivile(false)}
            disabled={rivileSaving || !rivileKey.trim()}
          >
            {rivileSaving ? t.settings.saving : rivile?.configured ? t.settings.centasSaveChanges : t.settings.centasSaveKey}
          </button>
          {rivile?.configured && (
            <button type="button" className="hb-btn" onClick={() => saveRivile(true)} disabled={rivileSaving}>
              {t.settings.centasDisconnect}
            </button>
          )}
        </div>
        {rivileMsg && <p className={`hb-msg ${rivileMsg.ok ? 'ok' : 'err'}`}>{rivileMsg.text(t)}</p>}
      </div>
      )}
    </>
  );
}
