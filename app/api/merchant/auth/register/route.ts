import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { createSession, sessionCookieOptions } from '@/lib/merchant-auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password, businessName } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Checked against merchant_users, which is where addresses are unique now.
    // A staff member invited to one merchant cannot register a second account
    // on the same address, which is what that unique index is for.
    const existing = await queryOne(
      'SELECT id FROM merchant_users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomUUID();

    const rows = await query<{ id: string; email: string }>(
      `INSERT INTO merchants (id, email, password_hash, business_name, is_active, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       RETURNING id, email`,
      [id, email.toLowerCase(), passwordHash, businessName ?? null]
    );

    const merchant = rows[0];

    // The person who registers owns the account: they chose the bank details
    // and they are who invites everyone else.
    const userRows = await query<{ id: string }>(
      `INSERT INTO merchant_users (id, merchant_id, email, password_hash, role, accepted_at, created_at)
       VALUES ($1, $2, $3, $4, 'owner', NOW(), NOW())
       RETURNING id`,
      [randomUUID(), merchant.id, merchant.email, passwordHash]
    );

    const token = await createSession({
      id: merchant.id,
      email: merchant.email,
      userId: userRows[0]?.id,
      role: 'owner',
    });

    const res = NextResponse.json({ success: true });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (err) {
    // Log details server-side only; never leak internals to the client
    console.error('REGISTER_ERROR', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
