import { NextRequest, NextResponse } from 'next/server';
import { getSession, isOwner } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';
import { jwtExpiryDate } from '@/lib/jwt-exp';

// The merchant's Tele2 credentials and their SMS text.
//
// A route of its own, like /api/merchant/invoice-template and for the same
// reason: /api/merchant/profile already carries seventeen parameters and
// decides the payment rail, the slug and the fee mode on the way through.
//
// ⚠️ **The token is never returned.** Same rule as the Montonio keys: this
// answers `configured` and nothing else, so a read-only session, a logged
// response or a browser cache cannot leak a credential that spends the
// merchant's money. It can be replaced but not retrieved.
//
// All three columns arrive by backend migration, so a missing column is
// answered as "not set up yet" rather than a 500 - this app can deploy first.

const COLUMNS = /tele2_api_token|tele2_sender_name|sms_template|tele2_token_valid_until/;

type Row = {
  has_token: boolean;
  tele2_sender_name: string | null;
  tele2_token_valid_until: string | Date | null;
  sms_template: string | null;
  business_name: string | null;
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const row = await queryOne<Row>(
      `SELECT (tele2_api_token IS NOT NULL AND tele2_api_token <> '') AS has_token,
              tele2_sender_name, tele2_token_valid_until, sms_template, business_name
         FROM merchants WHERE id = $1`,
      [session.id]
    );
    const validUntil = row?.tele2_token_valid_until ?? null;
    return NextResponse.json({
      // Whether a token exists, never the token.
      hasToken: row?.has_token === true,
      senderName: row?.tele2_sender_name ?? null,
      // ⚠️ **Read out of the key itself, never asked for.** The Tele2 key is a
      // JWT and carries `exp` - Tele2 told us on the telephone that their keys
      // do not expire, and SB „Žaluma"'s expires on 2027-01-31. See
      // `lib/jwt-exp.ts`. Returned as a bare YYYY-MM-DD so the portal renders
      // it without timezone arithmetic moving it a day.
      tokenValidUntil: validUntil
        ? (validUntil instanceof Date ? validUntil.toISOString().slice(0, 10) : String(validUntil).slice(0, 10))
        : null,
      template: row?.sms_template ?? null,
      // Offered as the suggested sender name: Tele2 send from the account's
      // registered name, which for our merchants is their business name.
      businessName: row?.business_name ?? null,
    });
  } catch (err) {
    if (!COLUMNS.test(String(err))) throw err;
    console.warn('[merchant/sms-settings] columns missing - backend deploy pending');
    return NextResponse.json({ hasToken: false, senderName: null, tokenValidUntil: null, template: null, businessName: null });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let token: string | null = null;
  let clearToken = false;
  let senderName: string | null = null;
  let template: string | null = null;
  let templateTouched = false;
  try {
    const payload = await req.json();
    // An absent token means "leave it alone"; an explicit empty string means
    // "remove it". Those are different intentions and a single falsy check
    // would turn the first into the second - which is how a merchant saving
    // their message text would silently lose their credentials.
    if (typeof payload?.token === 'string') {
      const trimmed = payload.token.trim();
      if (trimmed) token = trimmed;
      else clearToken = true;
    }
    senderName = typeof payload?.senderName === 'string' ? payload.senderName.trim() : null;
    if (typeof payload?.template === 'string') {
      templateTouched = true;
      template = payload.template.trim() || null;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // ⚠️ The credentials belong with the owner, the message with whoever does the
  // work. Same split as the bank details against the letter template: a
  // phished staff password must not be able to spend money on the merchant's
  // telecom account or change the name an SMS about money appears to come
  // from - the sender name is what makes the message readable as legitimate
  // rather than as a smishing attempt. Writing the text is daily work.
  const ownerOnly = token !== null || clearToken || senderName !== null;
  if (ownerOnly && !isOwner(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (senderName !== null && senderName.length > 40) {
    return NextResponse.json({ error: 'sender_too_long' }, { status: 400 });
  }
  // Tele2 accept at most 480 latin / 210 non-latin characters. A longer value
  // cannot be sent at all, so refusing it here beats storing a template whose
  // every send fails.
  if (template !== null && template.length > 480) {
    return NextResponse.json({ error: 'template_too_long' }, { status: 400 });
  }
  // A template with no link is a message telling someone they owe money and
  // giving them no way to pay it - which is worse than sending nothing, since
  // it costs the merchant and confuses the reader. The default has {link}; an
  // empty box falls back to the default, so this only catches real text that
  // forgot it.
  if (template !== null && !template.includes('{link}')) {
    return NextResponse.json({ error: 'template_needs_link' }, { status: 400 });
  }

  try {
    await query(
      `UPDATE merchants
          SET tele2_api_token   = CASE WHEN $5 THEN NULL
                                       ELSE COALESCE($1, tele2_api_token) END,
              tele2_sender_name = COALESCE($2, tele2_sender_name),
              -- $6 says whether the request mentioned the template at all, so
              -- clearing it back to the default stays possible while a save of
              -- the credentials alone leaves the text untouched.
              sms_template      = CASE WHEN $6 THEN $3 ELSE sms_template END,
              -- Derived from the key, never asked for: a new key brings its
              -- own expiry, clearing the key clears the date, and a save that
              -- does not touch the key must not touch the date either.
              tele2_token_valid_until = CASE WHEN $5 THEN NULL
                                             WHEN $1 IS NOT NULL THEN $7::date
                                             ELSE tele2_token_valid_until END
        WHERE id = $4`,
      [token, senderName || null, template, session.id, clearToken, templateTouched,
       token ? jwtExpiryDate(token) : null]
    );
  } catch (err) {
    if (!COLUMNS.test(String(err))) throw err;
    return NextResponse.json({ error: 'not_ready' }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
