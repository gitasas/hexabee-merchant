'use client';

import { PayLangProvider, PayLangToggle } from '../pay/i18n';
import PayerInbox from '../pay/PayerInbox';

/**
 * The payer inbox with no merchant in front of it: every invoice any HexaBee
 * merchant has sent to this address. The same screen a bare pay link opens,
 * reachable without a link at all.
 */
export default function ManoPage() {
  return (
    <PayLangProvider>
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 16px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 32px', maxWidth: 460, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          <PayLangToggle />
          <img src="/hexabee-logo.svg" alt="HexaBee" style={{ height: 80, display: 'block', margin: '0 auto 12px' }} />
          <PayerInbox slug={null} merchantName={null} />
        </div>
      </main>
    </PayLangProvider>
  );
}
