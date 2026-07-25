'use client';

import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  { href: '/merchant/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/merchant/invoices', label: 'Invoices', icon: '🧾' },
  { href: '/merchant/payment-links', label: 'Links', longLabel: 'Payment Links', icon: '🔗' },
  { href: '/merchant/payment_methods', label: 'Methods', longLabel: 'Payment Methods', icon: '💳' },
  { href: '/merchant/settings', label: 'Settings', icon: '⚙️' },
];

export default function PortalShell({
  businessName,
  children,
}: {
  businessName: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/merchant/auth/logout', { method: 'POST' });
    router.push('/merchant/login');
  }

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <div className="hb hb-shell">
      <aside className="hb-sidebar">
        <a className="hb-brand" href="/merchant/dashboard">
          <img src="/hexabee-logo.svg" alt="HexaBee" />
        </a>
        <nav>
          {NAV.map(item => (
            <a
              key={item.href}
              href={item.href}
              className={`hb-nav-item${isActive(item.href) ? ' active' : ''}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.longLabel ?? item.label}
            </a>
          ))}
        </nav>
        <div className="hb-sidebar-foot">
          {businessName && (
            <p className="hb-note" style={{ margin: '0 0 8px', padding: '0 12px' }}>
              {businessName}
            </p>
          )}
          <button type="button" className="hb-btn sm block" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>

      <div className="hb-main">
        <header className="hb-topbar">
          <a href="/merchant/dashboard">
            <img className="hb-topbar-logo" src="/hexabee-logo.svg" alt="HexaBee" />
          </a>
          <span className="hb-biz">{businessName ?? ''}</span>
          <button type="button" className="hb-btn sm" onClick={handleLogout}>
            Log out
          </button>
        </header>

        <main className="hb-content">{children}</main>

        <nav className="hb-tabbar">
          {NAV.map(item => (
            <a
              key={item.href}
              href={item.href}
              className={`hb-tab${isActive(item.href) ? ' active' : ''}`}
            >
              <span className="hb-tab-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
