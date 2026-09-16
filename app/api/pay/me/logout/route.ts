import { NextResponse } from 'next/server';
import { PAYER_COOKIE } from '@/lib/payer-auth';

/** "Not you?" — forget the payer on this browser. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: PAYER_COOKIE, value: '', maxAge: 0, path: '/' });
  return res;
}
