'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang, type Dict } from '../../../../i18n';

type Msg = (t: Dict) => string;
type User = { id: string; email: string; role: string; accepted: boolean };

/**
 * Who can sign in to this account.
 *
 * Hidden from staff entirely rather than shown disabled: the API refuses
 * them, and a page that only ever answers "forbidden" is worse than one that
 * is not offered. A merchant is a company and a login is a person - at
 * Baltijos licėjus the director registered and the administrator does the
 * invoicing, which is the whole reason this exists.
 */
export default function TeamSettingsPage() {
  const router = useRouter();
  const { t } = useLang();

  const [role, setRole] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'staff'>('staff');
  const [usersBusy, setUsersBusy] = useState(false);
  const [usersMsg, setUsersMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setRole(data.role ?? 'owner');
        // Only an owner may read the list, and the route refuses the rest -
        // asking anyway would just log a 403 on every visit.
        if (data.role !== 'staff') loadUsers();
      });
  }, [router]);

  async function loadUsers() {
    try {
      const res = await fetch('/api/merchant/users');
      if (!res.ok) return;
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch { /* the page still renders without it */ }
  }

  function userError(code: string): Msg {
    if (code === 'last_owner') return tt => tt.settings.usersLastOwner;
    if (code === 'cannot_demote_self') return tt => tt.settings.usersNotSelfRole;
    if (code === 'cannot_remove_self') return tt => tt.settings.usersNotSelfRemove;
    return tt => tt.settings.usersFailed;
  }

  async function inviteUser() {
    const email = inviteEmail.trim();
    if (!email || usersBusy) return;
    setUsersBusy(true);
    setUsersMsg(null);
    try {
      const res = await fetch('/api/merchant/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInviteEmail('');
        // The row exists even if the mail failed, so say which happened rather
        // than leaving the owner unsure whether the person was added at all.
        setUsersMsg({
          ok: true,
          text: data.sent
            ? (tt: Dict) => tt.settings.usersInvited(email)
            : (tt: Dict) => tt.settings.usersAddedNoMail(email),
        });
        loadUsers();
      } else {
        const map: Record<string, Msg> = {
          already_member: tt => tt.settings.usersAlreadyMember,
          email_taken: tt => tt.settings.usersEmailTaken,
          invalid_email: tt => tt.settings.usersInvalidEmail,
        };
        setUsersMsg({ ok: false, text: map[String(data.detail ?? data.error)] ?? ((tt: Dict) => tt.settings.usersFailed) });
      }
    } catch {
      setUsersMsg({ ok: false, text: (tt: Dict) => tt.settings.usersFailed });
    } finally {
      setUsersBusy(false);
    }
  }

  async function changeUserRole(id: string, next: 'owner' | 'staff') {
    if (usersBusy) return;
    setUsersBusy(true);
    setUsersMsg(null);
    try {
      const res = await fetch(`/api/merchant/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) loadUsers();
      else setUsersMsg({ ok: false, text: userError(String(data.detail ?? data.error)) });
    } catch {
      setUsersMsg({ ok: false, text: (tt: Dict) => tt.settings.usersFailed });
    } finally {
      setUsersBusy(false);
    }
  }

  async function removeUser(id: string) {
    if (usersBusy) return;
    setUsersBusy(true);
    setUsersMsg(null);
    try {
      const res = await fetch(`/api/merchant/users/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) loadUsers();
      else setUsersMsg({ ok: false, text: userError(String(data.detail ?? data.error)) });
    } catch {
      setUsersMsg({ ok: false, text: (tt: Dict) => tt.settings.usersFailed });
    } finally {
      setUsersBusy(false);
    }
  }

  if (role === null) return <p className="hb-skeleton">{t.common.loading}</p>;

  if (role === 'staff') {
    return (
      <>
        <div className="hb-page-head">
          <div><h1 className="hb-title">{t.settings.navTeam}</h1></div>
        </div>
        <div className="hb-card"><p className="hb-note">{t.settings.ownerOnlyNote}</p></div>
      </>
    );
  }

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.settings.navTeam}</h1>
          <p className="hb-sub">{t.settings.usersSub}</p>
        </div>
      </div>

      <div className="hb-card">
        {users.map(u => (
          <div key={u.id} className="hb-subsection">
            <p className="hb-subsection-label">
              {u.email}
              {!u.accepted && <span className="hb-note"> {t.settings.usersPending}</span>}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="hb-input"
                style={{ maxWidth: 180 }}
                value={u.role}
                disabled={usersBusy}
                onChange={e => changeUserRole(u.id, e.target.value === 'owner' ? 'owner' : 'staff')}
              >
                <option value="owner">{t.settings.roleOwner}</option>
                <option value="staff">{t.settings.roleStaff}</option>
              </select>
              <button type="button" className="hb-btn sm" onClick={() => removeUser(u.id)} disabled={usersBusy}>
                {t.settings.usersRemove}
              </button>
            </div>
          </div>
        ))}

        <div className="hb-subsection">
          <p className="hb-subsection-label">{t.settings.usersInvite}</p>
          <p className="hb-card-sub">{t.settings.usersInviteSub}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="hb-input"
              type="email"
              style={{ flex: 1, minWidth: 220 }}
              placeholder={t.settings.usersEmailPlaceholder}
              value={inviteEmail}
              onChange={e => { setInviteEmail(e.target.value); setUsersMsg(null); }}
            />
            <select
              className="hb-input"
              style={{ maxWidth: 180 }}
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value === 'owner' ? 'owner' : 'staff')}
            >
              <option value="staff">{t.settings.roleStaff}</option>
              <option value="owner">{t.settings.roleOwner}</option>
            </select>
            {/* Yellow: inviting someone is an action with an outcome, not a
                save of something already settled. */}
            <button type="button" className={`hb-btn sm${inviteEmail.trim() ? ' primary' : ''}`} onClick={inviteUser} disabled={usersBusy}>
              {usersBusy ? t.settings.saving : t.settings.usersInviteBtn}
            </button>
          </div>
        </div>

        <p className="hb-note">{t.settings.usersRoleNote}</p>
        {usersMsg && <p className={`hb-msg ${usersMsg.ok ? 'ok' : 'err'}`}>{usersMsg.text(t)}</p>}
      </div>
    </>
  );
}
