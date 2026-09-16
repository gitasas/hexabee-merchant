'use client';

import { useEffect, useState } from 'react';
import { usePayLang } from './i18n';

/**
 * What a bare pay link shows: the payer's own invoices, found by the email
 * address they were sent to.
 *
 * A link with nothing after `/pay/<slug>` carries no amount and no reference,
 * and nothing about the click says which invoice it was for. The BCC ledger
 * does know — it has the invoice and the address it went to — so the page
 * asks for that address, proves it with a one-time code, and lists what is
 * outstanding. Choosing an invoice sends the payer to the normal pay page with
 * `?r=`, which is the same screen a `?a=&r=` template link opens. No mail
 * client, extension or add-in is involved on either side.
 *
 * Once verified the browser keeps a 30-day cookie, so the second invoice from
 * any HexaBee merchant opens straight on the list.
 */
type Invoice = {
  id: string;
  invoice_number: string;
  amount: string | null;
  currency: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
};
type MerchantGroup = { slug: string; business_name: string; invoices: Invoice[] };
type Step = 'loading' | 'email' | 'code' | 'list';

function money(amount: string | null, currency: string | null, locale: string) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: (currency || 'EUR').toUpperCase() }).format(n);
}

function day(iso: string | null, locale: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function PayerInbox({
  slug,
  merchantName,
  onManual,
}: {
  slug: string | null;
  merchantName: string | null;
  /** Present when the page has a manual amount/reference form to fall back to. */
  onManual?: () => void;
}) {
  const { t } = usePayLang();
  const [step, setStep] = useState<Step>('loading');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<MerchantGroup[]>([]);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  async function loadList(): Promise<boolean> {
    const res = await fetch(`/api/pay/me${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`, { cache: 'no-store' });
    if (res.status !== 200) return false;
    const data = await res.json();
    setGroups(data.merchants ?? []);
    setSessionEmail(data.email ?? null);
    setStep('list');
    return true;
  }

  useEffect(() => {
    loadList().then(ok => { if (!ok) setStep('email'); }).catch(() => setStep('email'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendCode() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/pay/me/identify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      if (res.status === 200) { setCode(''); setStep('code'); }
      else if (res.status === 404) setError(t.inbox.noInvoices);
      else if (res.status === 429) setError(t.inbox.rateLimited);
      else if (res.status === 400) setError(t.inbox.noInvoices);
      else setError(t.inbox.unavailable);
    } catch { setError(t.inbox.unavailable); }
    finally { setBusy(false); }
  }

  async function confirmCode() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/pay/me/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }),
      });
      if (res.status === 200) { if (!(await loadList())) setError(t.inbox.unavailable); }
      else if (res.status === 401 || res.status === 400) setError(t.inbox.wrongCode);
      else setError(t.inbox.unavailable);
    } catch { setError(t.inbox.unavailable); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await fetch('/api/pay/me/logout', { method: 'POST' });
    setGroups([]); setSessionEmail(null); setCode(''); setStep('email');
  }

  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: 10,
    border: '1px solid var(--border)', fontSize: 15, background: 'var(--bg)', color: 'var(--text)',
  };
  const button: React.CSSProperties = {
    width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: 'var(--brand)',
    color: '#111', fontWeight: 700, fontSize: 15, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
  };
  const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, color: 'var(--muted)', fontSize: 12,
    textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer',
  };
  const title: React.CSSProperties = { fontSize: 17, fontWeight: 700, margin: '0 0 4px' };
  const sub: React.CSSProperties = { color: 'var(--muted)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.5 };
  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 6 };

  if (step === 'loading') {
    return <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, margin: '24px 0' }}>…</p>;
  }

  if (step === 'email') {
    return (
      <form onSubmit={e => { e.preventDefault(); if (!busy) sendCode(); }} style={{ margin: '8px 0 0' }}>
        <p style={title}>{t.inbox.emailTitle}</p>
        <p style={sub}>{merchantName ? t.inbox.emailSub(merchantName) : t.inbox.emailSubGeneric}</p>
        <label style={label} htmlFor="payer-email">{t.inbox.emailLabel}</label>
        <input
          id="payer-email"
          style={{ ...input, marginBottom: 12 }}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        {error && <p style={{ fontSize: 12, color: '#b45309', margin: '0 0 10px', lineHeight: 1.5 }}>{error}</p>}
        <button type="submit" style={button} disabled={busy}>{busy ? t.inbox.sending : t.inbox.sendCode}</button>
        {onManual && (
          <p style={{ textAlign: 'center', margin: '14px 0 0' }}>
            <button type="button" style={linkBtn} onClick={onManual}>{t.inbox.manualInstead}</button>
          </p>
        )}
      </form>
    );
  }

  if (step === 'code') {
    return (
      <form onSubmit={e => { e.preventDefault(); if (!busy) confirmCode(); }} style={{ margin: '8px 0 0' }}>
        <p style={title}>{t.inbox.codeTitle}</p>
        <p style={sub}>{t.inbox.codeSub(email)}</p>
        <label style={label} htmlFor="payer-code">{t.inbox.codeLabel}</label>
        <input
          id="payer-code"
          style={{ ...input, marginBottom: 12, fontSize: 24, fontWeight: 700, letterSpacing: 8, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && <p style={{ fontSize: 12, color: '#b45309', margin: '0 0 10px' }}>{error}</p>}
        <button type="submit" style={button} disabled={busy || code.length !== 6}>{busy ? t.inbox.confirming : t.inbox.confirm}</button>
        <p style={{ textAlign: 'center', margin: '14px 0 0', display: 'flex', gap: 14, justifyContent: 'center' }}>
          <button type="button" style={linkBtn} onClick={() => { if (!busy) sendCode(); }}>{t.inbox.resend}</button>
          <button type="button" style={linkBtn} onClick={() => { setError(null); setStep('email'); }}>{t.inbox.changeEmail}</button>
        </p>
      </form>
    );
  }

  // list
  const first = groups[0];
  const rest = groups.slice(1);
  const unpaidTotal = groups.reduce((n, g) => n + g.invoices.filter(i => i.status !== 'paid').length, 0);

  const renderGroup = (g: MerchantGroup) => (
    <div key={g.slug} style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>{g.business_name}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {g.invoices.map(inv => {
          const paid = inv.status === 'paid';
          return (
            <div
              key={inv.id}
              style={{
                border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px',
                display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px', alignItems: 'center',
                opacity: paid ? 0.55 : 1,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-all' }}>{inv.invoice_number}</span>
              <span style={{ fontWeight: 700, fontSize: 15, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(inv.amount, inv.currency, t.locale)}</span>
              <span style={{ fontSize: 12, color: paid ? '#15803d' : 'var(--muted)' }}>
                {paid ? t.inbox.paidOn(day(inv.paid_at, t.locale)) : t.inbox.issuedOn(day(inv.created_at, t.locale))}
              </span>
              {!paid ? (
                <a
                  href={`/pay/${encodeURIComponent(g.slug)}?r=${encodeURIComponent(inv.invoice_number)}`}
                  style={{ fontSize: 12, fontWeight: 700, background: 'var(--brand)', color: '#111', borderRadius: 8, padding: '6px 12px', textDecoration: 'none', textAlign: 'center' }}
                >
                  {t.inbox.payInvoice}
                </a>
              ) : <span />}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ margin: '8px 0 0' }}>
      <p style={title}>{t.inbox.listTitle}</p>
      <p style={sub}>{sessionEmail}</p>
      {unpaidTotal === 0 && <p style={{ ...sub, textAlign: 'center' }}>{t.inbox.noneUnpaid}</p>}
      {first && renderGroup(first)}
      {rest.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: '20px 0 10px' }}>{t.inbox.otherMerchants}</p>
          {rest.map(renderGroup)}
        </>
      )}
      <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', margin: '8px 0 0', lineHeight: 1.5 }}>{t.inbox.ledgerNote}</p>
      <p style={{ textAlign: 'center', margin: '12px 0 0', display: 'flex', gap: 14, justifyContent: 'center' }}>
        {onManual && <button type="button" style={linkBtn} onClick={onManual}>{t.inbox.manualInstead}</button>}
        <button type="button" style={linkBtn} onClick={signOut}>{t.inbox.notYou}</button>
      </p>
    </div>
  );
}
