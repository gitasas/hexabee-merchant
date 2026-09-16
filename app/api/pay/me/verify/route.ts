import { NextRequest, NextResponse } from 'next/server';
import { callInternal, createPayerSession, normaliseEmail, payerCookieOptions } from '@/lib/payer-auth';

/** Step two: the code from the inbox. On a match the browser gets a 30-day payer cookie. */
export async function POST(req: NextRequest) {
  let body: { email?: unknown; code?: unknown } = {};
  try { body = await req.json(); } catch { /* fall through */ }
  const email = normaliseEmail(body.email);
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!email || !/^\d{6}$/.test(code)) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { status } = await callInternal('/api/plugin/payer/verify', { email, code });
  if (status === 401) return NextResponse.json({ error: 'wrong_code' }, { status: 401 });
  if (status !== 200) return NextResponse.json({ error: 'unavailable' }, { status: 503 });

  const res = NextResponse.json({ ok: true, email });
  res.cookies.set(payerCookieOptions(await createPayerSession(email)));
  return res;
}
