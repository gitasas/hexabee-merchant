import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

/**
 * The payer's session — an email address the payer has proven they can read.
 *
 * It is a separate cookie from the merchant session and its token carries
 * `kind: 'payer'`, which `verifySession` in merchant-auth refuses: both are
 * signed with the same secret, and a payer token must never open the portal.
 */
if (!process.env.MERCHANT_JWT_SECRET) {
  throw new Error('MERCHANT_JWT_SECRET must be set');
}
const SECRET = new TextEncoder().encode(process.env.MERCHANT_JWT_SECRET);

export const PAYER_COOKIE = 'hb_payer';

/**
 * How long a payer stays signed in: **12 months** (Gytis, 2026-10-07, raised
 * from 30 days).
 *
 * Thirty days was wrong for what these invoices actually are. A garden
 * association collects its membership fee **once a year**, and a school bills
 * monthly - so at 30 days almost every payer would have had to request a code
 * again before their next invoice, which is the friction the payer inbox was
 * built to remove.
 *
 * ⚠️ **One number, two places, and they must never drift.** The cookie's
 * `maxAge` and the JWT's own expiry both encode this. Changing only one gives
 * the worst outcome: a cookie the browser keeps sending against a token that
 * expired, so the payer is silently signed out while still appearing to have a
 * session. Hence the single constant below.
 *
 * Why 12 months is acceptable and not a legal problem: this session proves
 * nothing but "this person can read this mailbox", and it authorises **no
 * payment** - every payment is authenticated again in the payer's own bank app.
 * So PSD2 strong customer authentication does not reach it. Under ePrivacy a
 * sign-in cookie is strictly necessary for a service the user asked for, and
 * GDPR sets no fixed session limit.
 *
 * ⚠️ What it does change is a **shared device**: for a year, whoever uses that
 * browser can see this payer's unpaid invoices - including, where the merchant
 * has `use_invoice_payment_purpose` on, a line naming their children. The
 * logout button is the mitigation and must stay easy to find.
 */
const SESSION_DAYS = 365;
const MAX_AGE = 60 * 60 * 24 * SESSION_DAYS;

export async function createPayerSession(email: string): Promise<string> {
  return new SignJWT({ kind: 'payer', email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(SECRET);
}

export async function getPayerSession(): Promise<{ email: string } | null> {
  const token = (await cookies()).get(PAYER_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (payload.kind !== 'payer' || typeof payload.email !== 'string') return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

export function payerCookieOptions(token: string) {
  return {
    name: PAYER_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: MAX_AGE,
    path: '/',
  };
}

export function normaliseEmail(raw: unknown): string | null {
  const email = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

/** Call an internal FastAPI endpoint; returns the status and parsed body. */
export async function callInternal(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const baseUrl = process.env.ADMIN_API_BASE_URL?.trim();
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !token) return { status: 503, body: null };
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* empty */ }
    return { status: res.status, body };
  } catch (err) {
    console.error('[payer] internal call failed', path, String(err));
    return { status: 502, body: null };
  }
}
