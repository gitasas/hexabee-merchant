'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings', label: 'Settings' },
  { href: '/settings/connect', label: 'Stripe Connect' },
  { href: '/login', label: 'Login' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: '250px',
        borderRight: '1px solid var(--border)',
        padding: '1.5rem 1rem',
        background: 'var(--surface)',
      }}
    >
      <div style={{ marginBottom: '1.5rem' }}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>HexaBee</p>
        <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.1rem' }}>Merchant Admin</h2>
      </div>
      <nav>
        {links.map((link) => {
          const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href + '/') && link.href !== '/settings');

          return (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: 'block',
                marginBottom: '0.4rem',
                padding: '0.65rem 0.75rem',
                borderRadius: '10px',
                background: isActive ? '#fff6dc' : 'transparent',
                color: isActive ? '#7a5b00' : 'var(--text)',
                fontWeight: isActive ? 600 : 500,
              }}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
