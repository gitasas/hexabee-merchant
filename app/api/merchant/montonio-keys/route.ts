import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

/**
 * The merchant stores their own Montonio keys.
 *
 * Montonio issues these to the merchant once KYC passes, so the merchant is who
 * holds them. Routing them through a person — emailed to us, pasted by us —
 * added a hop and put an API secret in an inbox.
 *
 * Nothing is written until the keys are proven: the backend signs a token with
 * them and makes a read-only call to Montonio. A key that only fails later fails
 * as a declined payment, in front of a customer, long after the moment anyone
 * could connect the two.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    console.error('BACKEND_URL is not set — cannot validate Montonio keys');
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const accessKey = String(body?.accessKey ?? '').trim();
  const secretKey = String(body?.secretKey ?? '').trim();
  if (!accessKey || !secretKey) {
    return NextResponse.json({ error: 'Both keys are required' }, { status: 400 });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.BACKEND_API_TOKEN) headers['X-Backend-Token'] = process.env.BACKEND_API_TOKEN;

  let check: { valid?: boolean; error?: string };
  try {
    const res = await fetch(`${backendUrl}/validate-montonio-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ access_key: accessKey, secret_key: secretKey }),
    });
    check = await res.json();
  } catch (err) {
    console.error('[montonio-keys] validation call failed', String(err));
    return NextResponse.json({ error: 'Could not reach Montonio just now' }, { status: 502 });
  }

  if (!check?.valid) {
    return NextResponse.json(
      { error: check?.error || 'Montonio did not accept these keys' },
      { status: 400 }
    );
  }

  try {
    await query(
      `UPDATE merchants
       SET montonio_access_key = $1, montonio_secret_key = $2, payment_rail = 'montonio'
       WHERE id = $3`,
      [accessKey, secretKey, session.id]
    );
  } catch (err) {
    // montonio_access_key is unique: the same store cannot serve two merchants,
    // because the webhook has only that key to say whose payment it is.
    const message = String(err);
    if (message.includes('idx_merchants_montonio_access_key') || message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'These keys already belong to another HexaBee account' },
        { status: 409 }
      );
    }
    console.error('[montonio-keys] save failed', message);
    return NextResponse.json({ error: 'Could not save the keys' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
