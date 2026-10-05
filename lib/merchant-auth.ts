import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

if (!process.env.MERCHANT_JWT_SECRET) {
  throw new Error('MERCHANT_JWT_SECRET must be set');
}
const SECRET = new TextEncoder().encode(process.env.MERCHANT_JWT_SECRET);

const COOKIE = 'merchant_session';

export type MerchantRole = 'owner' | 'staff';

export type MerchantSession = {
  /**
   * The MERCHANT id, not the user's. Kept under this name deliberately: 28
   * files read `session.id` and every one of them means "which merchant", so
   * renaming it would have been a rewrite rather than a feature (2026-10-05).
   */
  id: string;
  email: string;
  /** Which person is signed in. Null on sessions issued before users existed. */
  userId?: string;
  /**
   * 'owner' may change bank details, fee settings, payment keys and other
   * users. 'staff' may do the daily work and nothing that redirects money.
   *
   * A session minted before roles existed carries none, and is read as an
   * owner: at that point every account had exactly one person in it, so that
   * is what they were. It also means nobody is logged out by this change.
   */
  role?: MerchantRole;
};

/** The one place that decides what "may change money settings" means. */
export function isOwner(session: MerchantSession | null): boolean {
  return !!session && (session.role ?? 'owner') === 'owner';
}

export async function createSession(merchant: MerchantSession): Promise<string> {
  return new SignJWT({ ...merchant })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(SECRET);
}

export async function verifySession(token: string): Promise<MerchantSession | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    // A payer token (lib/payer-auth.ts) is signed with the same secret and
    // carries no merchant id; it must never be accepted as a portal session.
    if (payload.kind === 'payer' || typeof payload.id !== 'string') return null;
    const role = payload.role === 'staff' ? 'staff' : payload.role === 'owner' ? 'owner' : undefined;
    return {
      id: payload.id,
      email: payload.email as string,
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
      role,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<MerchantSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function sessionCookieOptions(token: string) {
  return {
    name: COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  };
}
