import { NextRequest, NextResponse } from 'next/server';
import { callInternal, normaliseEmail } from '@/lib/payer-auth';

/**
 * Ask for a password reset link.
 *
 * Always answers the same way, whatever happens behind it: a 200 and nothing
 * else. Whether an address is registered with HexaBee is exactly what an
 * attacker would like this form to tell them, and a merchant's own customers
 * would be the list to try. The page shows "if that address has an account, a
 * link is on its way" regardless.
 *
 * That also means a rate limit, an unknown address and a failed send are
 * indistinguishable from here. They are logged on the backend, which is where
 * somebody can look.
 */
export async function POST(req: NextRequest) {
  let email: string | null = null;
  try {
    const body = await req.json();
    email = normaliseEmail(body?.email);
  } catch {
    // A malformed body gets the same answer as everything else.
  }

  if (email) {
    const origin = req.nextUrl.origin;
    await callInternal('/api/plugin/merchant/password-reset/request', {
      email,
      // The backend sends the mail, so it has to be told where the link should
      // land. Built from this request's own origin rather than an env var, so
      // a staging reset cannot mail somebody a production link.
      reset_url: `${origin}/merchant/reset`,
    });
  }

  return NextResponse.json({ ok: true });
}
