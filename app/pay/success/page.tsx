'use client';

import { PayLangProvider, usePayLang, PayLangToggle } from '../i18n';

function SuccessContent() {
  const { t } = usePayLang();
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
      <section className="card" style={{ width: '100%', maxWidth: '540px', textAlign: 'center' }}>
        <PayLangToggle />
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem', letterSpacing: '0.04em' }}>{t.redirect.label}</p>
        <h1 style={{ margin: '0.6rem 0 0.8rem', fontSize: '1.8rem' }}>{t.redirect.successTitle}</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>{t.redirect.successSub}</p>
        <div style={{ marginTop: '1.2rem' }}>
          <button type="button" onClick={() => window.close()} style={{ background: 'var(--brand)', color: '#111827', border: 'none', borderRadius: '10px', padding: '0.65rem 1.2rem', fontWeight: 600, cursor: 'pointer' }}>{t.redirect.close}</button>
        </div>
      </section>
    </main>
  );
}

export default function PaymentSuccessPage() {
  return (
    <PayLangProvider>
      <SuccessContent />
    </PayLangProvider>
  );
}
