import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SECRET = new TextEncoder().encode(
  process.env.MERCHANT_JWT_SECRET ?? 'hexabee-merchant-secret-change-in-prod'
);

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
    return { id: payload.id as string, email: payload.email as string };
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
