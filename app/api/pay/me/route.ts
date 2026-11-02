import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getPayerSession } from '@/lib/payer-auth';

/**
 * The payer's invoices, across every HexaBee merchant that has invoiced this
 * address through the BCC ledger. Grouped by merchant; the merchant whose pay
 * link the payer arrived on (`?slug=`) comes first, the rest follow.
 *
 * Only rows with an invoice number are returned - without one there is nothing
 * for the pay page to look up, so the row could not be paid from here anyway.
 *
 * ⚠️ **It matches `payer_email_cc` as well as `payer_email` (2026-11-02).** The
 * send path deliberately stores a second address - that is what the column is
 * for, copied from the remembered payer - and HexaBee emails the invoice to
 * both. Matching only the first meant the second parent verified their address
 * and was told there was nothing for them, about an invoice sitting in their
 * own inbox. Reported by Kauno Valdorfo mokykla's director, who sent himself
 * one invoice at two addresses.
 *
 * It does NOT fix the BCC path, where the second recipient is never stored at
 * all: `_ingest_email` takes the first To/Cc that is not ours and discards the
 * rest. Whether a BCC'd invoice should remember both is a decision about who
 * may reach an invoice, not a bug - see inbound.py.
 */
type Row = {
  id: string;
  invoice_number: string;
  amount: string | null;
  currency: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
  slug: string;
  business_name: string | null;
  // What the payer's bank statement will say, when this merchant's payments
  // carry it. NULL for every merchant whose flag is off - the SELECT applies
  // the condition, so the list can simply render what it is given.
  payment_purpose: string | null;
  // ⚠️ Whether this invoice went to TWO addresses. It exists so a paid
  // invoice can say why it is paid when the viewer did not pay it: one parent
  // settles it and the other opens the list to a row marked "Paid" with no
  // explanation, which reads as either "I already did this" or an error.
  //
  // Deliberately a plain "there were two recipients" and NOT "the other one
  // paid it": we do not know who paid. Montonio returns `senderIban` and
  // `senderName` as null on a real bank payment, and nothing else on the
  // payment row carries a payer identity - so naming the other person would
  // be an assertion the product cannot support.
  shared_recipients: boolean;
};

export async function GET(req: NextRequest) {
  const session = await getPayerSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const slug = req.nextUrl.searchParams.get('slug')?.trim().toLowerCase() || null;

  // ⚠️ The purpose is served only when THIS merchant's payments really carry
  // it - the same condition /api/payment/montonio applies before reading that
  // column, and the same one /api/pay/[slug]/invoice-lookup applies. A payer
  // told "your bank will show X" about a payment that will in fact carry the
  // invoice number is a promise the product then breaks.
  //
  // It is here because a parent with three children sees three invoice
  // numbers - VAL25485, VAL25486, VAL25487 - with no way to tell which child
  // each one is for, and these are paid one by one. Safe to show: this route
  // needs a verified payer session and only ever returns rows addressed to
  // that payer, which is strictly less than the public lookup already gives.
  // ⚠️ `match` and `shared` are separate arguments because BOTH mention
  // `payer_email_cc`, and the fallback below exists precisely for the deploy
  // where that column is not there yet. Folding the shared-recipients
  // expression into the fixed part of this query would have made the retry
  // reference the missing column too - so the degradation would throw a second
  // time and answer 503, taking the inbox down rather than costing one field.
  const listSql = (match: string, shared: string) =>
    `SELECT i.id, i.invoice_number, i.amount, i.currency, i.status, i.paid_at, i.created_at,
            m.slug, m.business_name,
            CASE WHEN m.use_invoice_payment_purpose IS TRUE
                 THEN i.payment_purpose ELSE NULL END AS payment_purpose,
            ${shared} AS shared_recipients
     FROM merchant_invoices i
     JOIN merchants m ON m.id = i.merchant_id
     WHERE ${match} AND i.invoice_number IS NOT NULL
     ORDER BY (i.status = 'paid'), i.created_at DESC
     LIMIT 300`;

  const SHARED = `(i.payer_email IS NOT NULL AND i.payer_email_cc IS NOT NULL
                   AND LOWER(i.payer_email) <> LOWER(i.payer_email_cc))`;

  let rows: Row[] = [];
  try {
    rows = await query<Row>(
      listSql('(LOWER(i.payer_email) = $1 OR LOWER(i.payer_email_cc) = $1)', SHARED),
      [session.email]
    );
  } catch (err) {
    // The column arrives by backend migration, and here it sits in the WHERE
    // clause - so on a split deploy the throw would reach the catch below and
    // answer 503, taking the whole inbox down rather than costing one column.
    // Retry without it, like /api/merchant/invoices does for due_date.
    if (String(err).includes('payer_email_cc')) {
      console.warn('[payer/me] payer_email_cc missing - matching the primary address only');
      try {
        // No column, so no second recipient can exist: FALSE is the truth here,
        // not a placeholder.
        rows = await query<Row>(listSql('LOWER(i.payer_email) = $1', 'FALSE'), [session.email]);
      } catch (retryErr) {
        console.error('[payer/me] ledger query failed', String(retryErr));
        return NextResponse.json({ error: 'unavailable' }, { status: 503 });
      }
    } else {
      console.error('[payer/me] ledger query failed', String(err));
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
  }

  const groups = new Map<string, { slug: string; business_name: string; invoices: Omit<Row, 'slug' | 'business_name'>[] }>();
  for (const r of rows) {
    const g = groups.get(r.slug) ?? { slug: r.slug, business_name: r.business_name ?? r.slug, invoices: [] };
    const { slug: _s, business_name: _b, ...inv } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
    g.invoices.push(inv);
    groups.set(r.slug, g);
  }
  const merchants = Array.from(groups.values()).sort((a, b) => {
    if (a.slug === slug) return -1;
    if (b.slug === slug) return 1;
    return 0;
  });

  return NextResponse.json({ email: session.email, merchants });
}
