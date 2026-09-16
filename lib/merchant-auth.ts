import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

if (!process.env.MERCHANT_JWT_SECRET) {
  throw new Error('MERCHANT_JWT_SECRET must be set');
}
const SECRET = new TextEncoder().encode(process.env.MERCHANT_JWT_SECRET);

const COOKIE = 'merchant_session';

export type MerchantSession = {
  id: string;
  email: string;
};

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
    return { id: payload.id, email: payload.email as string };
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
