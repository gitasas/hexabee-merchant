'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLang } from '../../../i18n';

/**
 * Settings is a set of pages, not one long sheet.
 *
 * Real routes rather than tabs, for three reasons tabs cannot give: a section
 * has its own address that can be pasted to a merchant who cannot find a
 * field; the browser's back button works; and one page carries one save,
 * which is what removes the three identically-labelled "Save settings"
 * buttons the single page had.
 *
 * ⚠️ The section menu lives in the portal's OWN sidebar, nested under
 * Settings (see `PortalShell`), not in a second column beside the content.
 * Two menus on one screen is two places to look for the same thing. This
 * layout therefore adds nothing on a wide screen; on a phone, where the
 * sidebar is a five-icon tab bar with no room to nest, the index page is the
 * menu and this back link is the way out of a section.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  const path = usePathname();

  return (
    <>
      {path !== '/merchant/settings' && (
        <Link href="/merchant/settings" className="hb-backlink">
          ‹ {t.settings.backToSettings}
        </Link>
      )}
      {children}
    </>
  );
}
