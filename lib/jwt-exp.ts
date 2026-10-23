/**
 * When does this JWT stop working?
 *
 * The Tele2 SMS key is a JWT, which nobody told us - Tele2 said on the
 * telephone that their keys have no expiry at all, and SB „Žaluma"'s key
 * carries `exp` 2027-01-31. So the date exists, it is printed inside the
 * credential the merchant pastes, and until now we stored the key and threw
 * the date away. On 2027-02-01 every send would have started returning 401,
 * and the way we would have found out is the merchant telephoning to say the
 * texts stopped.
 *
 * ⚠️ **Nothing here is authentication.** The signature is not checked and
 * cannot be - the key is signed by Tele2 with a secret we do not have, and we
 * are not verifying a claim from a stranger: this is our own merchant's own
 * credential, read to put a date on their settings page. A forged `exp` would
 * mislead nobody but the merchant who forged it.
 *
 * Mirrored by `token_expiry()` in `hexabee-backend/app/sms_sender.py`, because
 * the merchant portal and the admin panel each write this column. The pair is
 * pinned by `npm run verify:sms` and `scripts/check_sms.py`, the same way
 * `smsSegments` and `segments()` are - this repo has paid for an unpinned pair
 * more than once.
 */
export function jwtExpiryDate(token: string): string | null {
  const parts = (token || '').trim().split('.');
  // A JWT is header.payload.signature. Anything else is a key of some other
  // shape, and inventing a date for it would be worse than having none.
  if (parts.length !== 3) return null;

  let payload: unknown;
  try {
    // base64url, and the padding Tele2 omit. atob is available in both the
    // Node and the edge runtimes Next.js uses.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    payload = JSON.parse(
      decodeURIComponent(
        atob(padded)
          .split('')
          .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join('')
      )
    );
  } catch {
    return null;
  }

  const exp = (payload as { exp?: unknown })?.exp;
  // Seconds since the epoch, per RFC 7519. A string that happens to parse is
  // accepted; anything else is not a date we may act on.
  const seconds = typeof exp === 'number' ? exp : typeof exp === 'string' ? Number(exp) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const when = new Date(seconds * 1000);
  if (Number.isNaN(when.getTime())) return null;
  // ⚠️ Sanity-bounded on purpose. A token whose `exp` is in milliseconds -
  // an easy mistake for an issuer to make - would otherwise land in the year
  // 56000 and print as a reassuring date far in the future, which is the one
  // wrong answer worse than none.
  const year = when.getUTCFullYear();
  if (year < 2020 || year > 2100) return null;

  return when.toISOString().slice(0, 10);
}
