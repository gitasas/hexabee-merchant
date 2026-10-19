import type { Dict } from './i18n';

/**
 * What to tell the merchant when `/api/merchant/montonio-keys` refuses.
 *
 * Mapped from the HTTP status and never from the response's `error` field:
 * that field is the backend's own English, and rendering it answers a
 * Lithuanian merchant in English - the rule this portal documents in
 * `i18n.tsx` and broke anyway.
 *
 * Shared by Settings and onboarding because both paste the same keys against
 * the same route. Two copies of this mapping would drift the first time one
 * of the statuses changed.
 */
export function montonioKeyError(status: number): (t: Dict) => string {
  if (status === 502) return t => t.onboarding.keysUnreachable;
  if (status === 409) return t => t.onboarding.keysTaken;
  if (status === 400) return t => t.onboarding.keysRejected;
  return t => t.common.saveFailed;
}
