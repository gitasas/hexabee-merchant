'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PayLangProvider, PayLangToggle, usePayLang } from '../pay/i18n';

/**
 * "I already paid this invoice", reached from the link in a reminder email.
 *
 * An invoice settled by ordinary bank transfer never reaches HexaBee, so the
 * ledger row stays unpaid and the reminders keep coming. The payer is the only
 * person who knows that is wrong, and until now the email could only ask them to
 * ignore it. Confirming here stops the reminders and flags the invoice for the
 * merchant to settle against their bank.
 *
 * The claim is a POST behind a button, never the page load itself: mail clients
 * and security scanners open links in messages, and claiming on GET would have
 * them answering for the payer.
 */

type Claim = {
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  merchant_name: string | null;
  slug: string | null;
  status: string;
  claimed: boolean;
  already_paid?: boolean;
};

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; claim: Claim }
  | { kind: 'sending'; claim: Claim }
  | { kind: 'done'; claim: Claim }
  | { kind: 'error'; claim: Claim };

function formatAmount(amount: string | null, currency: string | null): string | null {
  if (amount === null || amount === '') return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(2)} ${(currency ?? 'EUR').toUpperCase()}`;
}

function InvoicePaidInner() {
  const { t } = usePayLang();
  const token = useSearchParams().get('t');
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!token) { setState({ kind: 'invalid' }); return; }
    let live = true;
    fetch(`/api/pay/invoice-paid?t=${encodeURIComponent(token)}`)
      .then(async r => (r.ok ? ((await r.json()) as Claim) : null))
      .then(claim => {
        if (!live) return;
        setState(claim ? { kind: 'ready', claim } : { kind: 'invalid' });
      })
      .catch(() => { if (live) setState({ kind: 'invalid' }); });
    return () => { live = false; };
  }, [token]);

  const confirm = useCallback(async () => {
    if (state.kind !== 'ready' || !token) return;
    const claim = state.claim;
    setState({ kind: 'sending', claim });
    try {
      const res = await fetch(`/api/pay/invoice-paid?t=${encodeURIComponent(token)}`, { method: 'POST' });
      if (!res.ok) { setState({ kind: 'error', claim }); return; }
      setState({ kind: 'done', claim: (await res.json()) as Claim });
    } catch {
      setState({ kind: 'error', claim });
    }
  }, [state, token]);

  if (state.kind === 'loading') return <p style={s.muted}>{t.loading}</p>;

  if (state.kind === 'invalid') {
    return (
      <>
        <h1 style={s.title}>{t.claimPaid.invalidTitle}</h1>
        <p style={s.body}>{t.claimPaid.invalidBody}</p>
      </>
    );
  }

  const { claim } = state;
  const amount = formatAmount(claim.amount, claim.currency);
  const settled = claim.status === 'paid' || claim.already_paid === true;

  const details = (
    <dl style={s.details}>
      {claim.invoice_number && (
        <div style={s.row}>
          <dt style={s.dt}>{t.claimPaid.invoiceNo}</dt>
          <dd style={s.dd}>{claim.invoice_number}</dd>
        </div>
      )}
      {amount && (
        <div style={s.row}>
          <dt style={s.dt}>{t.claimPaid.amount}</dt>
          <dd style={{ ...s.dd, fontWeight: 700 }}>{amount}</dd>
        </div>
      )}
      {claim.merchant_name && (
        <div style={s.row}>
          <dt style={s.dt}>{t.claimPaid.payee}</dt>
          <dd style={s.dd}>{claim.merchant_name}</dd>
        </div>
      )}
    </dl>
  );

  if (settled) {
    return (
      <>
        <h1 style={s.title}>{t.claimPaid.alreadyPaidTitle}</h1>
        {details}
        <p style={s.body}>{t.claimPaid.alreadyPaidBody}</p>
      </>
    );
  }

  if (state.kind === 'done' || claim.claimed) {
    const done = state.kind === 'done';
    return (
      <>
        <h1 style={s.title}>{done ? t.claimPaid.doneTitle : t.claimPaid.claimedTitle}</h1>
        {details}
        <p style={s.body}>{done ? t.claimPaid.doneBody : t.claimPaid.claimedBody}</p>
      </>
    );
  }

  return (
    <>
      <h1 style={s.title}>{t.claimPaid.title}</h1>
      <p style={s.body}>{t.claimPaid.intro}</p>
      {details}
      <button
        type="button"
        onClick={confirm}
        disabled={state.kind === 'sending'}
        style={{ ...s.button, opacity: state.kind === 'sending' ? 0.6 : 1 }}
      >
        {state.kind === 'sending' ? t.claimPaid.sending : t.claimPaid.confirm}
      </button>
      {state.kind === 'error' && <p style={s.error}>{t.claimPaid.failed}</p>}
      {/* The payer may have clicked this by mistake, or meant to pay after all. */}
      {claim.slug && claim.invoice_number && (
        <p style={s.muted}>
          <a
            style={s.link}
            href={`/pay/${encodeURIComponent(claim.slug)}?r=${encodeURIComponent(claim.invoice_number)}`}
          >
            {t.claimPaid.notPaidYet}
          </a>
        </p>
      )}
    </>
  );
}

export default function InvoicePaidPage() {
  return (
    <PayLangProvider>
      <main style={s.main}>
        <div style={s.card}>
          <PayLangToggle />
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 12px' }} />
          <Suspense fallback={<p style={s.muted}>...</p>}>
            <InvoicePaidInner />
          </Suspense>
        </div>
      </main>
    </PayLangProvider>
  );
}

const s: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: '24px 16px',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '36px 32px',
    maxWidth: 460,
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    textAlign: 'center',
  },
  title: { fontSize: 20, margin: '0 0 8px', color: 'var(--text)' },
  body: { fontSize: 14, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.5 },
  details: { margin: '0 0 20px', padding: 0, textAlign: 'left' },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' },
  dt: { margin: 0, fontSize: 13, color: 'var(--muted)' },
  dd: { margin: 0, fontSize: 14, color: 'var(--text)' },
  button: {
    display: 'block',
    width: '100%',
    background: '#f4b400',
    color: '#111',
    fontWeight: 800,
    fontSize: 16,
    padding: '14px 20px',
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
  },
  error: { fontSize: 13, color: '#b91c1c', margin: '12px 0 0' },
  muted: { fontSize: 13, color: 'var(--muted)', margin: '16px 0 0' },
  link: { color: 'var(--muted)', textDecoration: 'underline' },
};
