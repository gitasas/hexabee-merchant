'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLang } from '../../../i18n';
import { SETTINGS_SECTIONS } from './sections';

/**
 * Settings is a set of pages, not one long sheet.
 *
 * Real routes rather than tabs, for three reasons that tabs cannot give:
 * a sub-page has its own address that can be pasted to a merchant who cannot
 * find a field; the browser's back button works; and each page carries one
 * save button, which is what removes the three identically-labelled
 * "Save settings" buttons the single page had.
 *
 * On a phone the sub-navigation is hidden and the index page IS the menu -
 * a list you tap into and come back from, which is how every phone's own
 * settings behave and therefore needs no explaining.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  const path = usePathname();
  const isIndex = path === '/merchant/settings';

  return (
    <div className="hb-settings">
      <nav className="hb-subnav" aria-label={t.settings.title}>
        {SETTINGS_SECTIONS.map(s => {
          const href = `/merchant/settings/${s.slug}`;
          return (
            <Link
              key={s.slug}
              href={href}
              className={`hb-subnav-item${path === href ? ' is-active' : ''}`}
            >
              {s.label(t)}
            </Link>
          );
        })}
      </nav>

      <div className="hb-settings-body">
        {!isIndex && (
          <Link href="/merchant/settings" className="hb-backlink">
            ‹ {t.settings.backToSettings}
          </Link>
        )}
        {children}
      </div>
    </div>
  );
}
