import type { Dict } from '../../../i18n';

/**
 * The Settings sub-pages, in one place because three things read this list:
 * the sub-navigation nested under Settings in the sidebar, the index with its
 * status chips, and the mobile back link. Three copies of an ordered list is
 * three chances for the nav and the page to disagree about what exists.
 *
 * ⚠️ The slugs are ENGLISH on purpose, while the labels are translated. A
 * slug is an address: it goes in a bookmark, in a link pasted to a merchant
 * ("open this and paste the key there"), and in the browser history. Making
 * it follow the language toggle would hand two different URLs to two
 * merchants looking at the same screen.
 *
 * Order is by how often a merchant needs the section, not by setup order:
 * the things changed once sit above the things never changed again.
 */
export type SettingsSection = {
  slug: string;
  label: (t: Dict) => string;
  sub: (t: Dict) => string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { slug: 'business',    label: t => t.settings.navBusiness,    sub: t => t.settings.rowBusinessSub },
  { slug: 'connections', label: t => t.settings.navConnections, sub: t => t.settings.rowConnectionsSub },
  { slug: 'sending',     label: t => t.settings.navSending,     sub: t => t.settings.rowSendingSub },
  { slug: 'links',       label: t => t.settings.navLinks,       sub: t => t.settings.rowLinksSub },
  { slug: 'options',     label: t => t.settings.navOptions,     sub: t => t.settings.rowOptionsSub },
  { slug: 'team',        label: t => t.settings.navTeam,        sub: t => t.settings.rowTeamSub },
];
