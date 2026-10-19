'use client';

import { Fragment } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLang, LangToggle } from './i18n';
import { SETTINGS_SECTIONS } from './merchant/(portal)/settings/sections';

const NAV = [
  { href: '/merchant/dashboard', key: 'dashboard' as const, icon: '📊' },
  { href: '/merchant/invoices', key: 'invoices' as const, icon: '🧾' },
  { href: '/merchant/payment-links', key: 'links' as const, longKey: 'linksLong' as const, icon: '🔗' },
  { href: '/merchant/payment_methods', key: 'methods' as const, longKey: 'methodsLong' as const, icon: '💳' },
  { href: '/merchant/settings', key: 'settings' as const, icon: '⚙️' },
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
  const { t } = useLang();

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
            <Fragment key={item.href}>
              <a
                href={item.href}
                className={`hb-nav-item${isActive(item.href) ? ' active' : ''}`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {t.shell.nav[item.longKey ?? item.key]}
              </a>

              {/* Settings is a set of pages, and its sections belong in the
                  one menu this portal already has rather than in a second
                  menu beside the content. They appear only while Settings is
                  open: a sidebar that always showed every sub-page would make
                  the shortest list in the portal the longest. */}
              {item.key === 'settings' && isActive(item.href) && (
                <div className="hb-nav-sub">
                  {SETTINGS_SECTIONS.map(s => {
                    const href = `/merchant/settings/${s.slug}`;
                    return (
                      <a
                        key={s.slug}
                        href={href}
                        className={`hb-nav-subitem${pathname === href ? ' active' : ''}`}
                      >
                        {s.label(t)}
                      </a>
                    );
                  })}
                </div>
              )}
            </Fragment>
          ))}
        </nav>
        <div className="hb-sidebar-foot">
          {businessName && (
            <p className="hb-note" style={{ margin: '0 0 8px', padding: '0 12px' }}>
              {businessName}
            </p>
          )}
          <LangToggle style={{ margin: '0 0 8px', padding: '0 12px' }} />
          <button type="button" className="hb-btn sm block" onClick={handleLogout}>
            {t.shell.logout}
          </button>
        </div>
      </aside>

      <div className="hb-main">
        <header className="hb-topbar">
          <a href="/merchant/dashboard">
            <img className="hb-topbar-logo" src="/hexabee-logo.svg" alt="HexaBee" />
          </a>
          <span className="hb-biz">{businessName ?? ''}</span>
          <LangToggle />
          <button type="button" className="hb-btn sm" onClick={handleLogout}>
            {t.shell.logout}
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
              {t.shell.nav[item.key]}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
