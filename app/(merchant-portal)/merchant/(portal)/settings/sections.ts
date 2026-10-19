import type { Dict } from '../../../i18n';

/**
 * The Settings sub-pages, in one place because three things read this list:
 * the sub-navigation, the index with its status chips, and the mobile back
 * link. Three copies of an ordered list is three chances for the nav and the
 * page to disagree about what exists.
 *
 * ⚠️ The slugs are ENGLISH on purpose, while the labels are translated. A
 * slug is an address: it goes in a bookmark, in a link pasted to a merchant
 * ("open this and paste the key there"), and in the browser history. Making
 * it follow the language toggle would hand two different URLs to two
 * merchants looking at the same screen.
 */
export type SettingsSection = {
  slug: string;
  label: (t: Dict) => string;
  sub: (t: Dict) => string;
  /** Still living on the temporary catch-all page rather than its own. */
  pending?: boolean;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { slug: 'business',    label: t => t.settings.navBusiness,    sub: t => t.settings.rowBusinessSub },
  { slug: 'connections', label: t => t.settings.navConnections, sub: t => t.settings.rowConnectionsSub },
  { slug: 'other',       label: t => t.settings.navOther,       sub: t => t.settings.rowOtherSub, pending: true },
];

/**
 * Sections that are designed but whose content has not been lifted out of the
 * catch-all page yet. They are listed so the shape of the finished thing is
 * visible, and they point at the page that really holds their settings today
 * - a link that works is better than a nav item that 404s.
 */
export const PLANNED_SECTIONS: SettingsSection[] = [
  { slug: 'other', label: t => t.settings.navSending, sub: t => t.settings.rowSendingSub, pending: true },
  { slug: 'other', label: t => t.settings.navLinks,   sub: t => t.settings.rowLinksSub,   pending: true },
  { slug: 'other', label: t => t.settings.navOptions, sub: t => t.settings.rowOptionsSub, pending: true },
  { slug: 'other', label: t => t.settings.navTeam,    sub: t => t.settings.rowTeamSub,    pending: true },
];
