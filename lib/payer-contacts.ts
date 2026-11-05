import type { ImportedInvoice } from '@/lib/invoice-import';

/**
 * Fill a spreadsheet's blank recipients from what the merchant already told us.
 *
 * ⚠️ **The Excel path could not see `merchant_payers` at all until
 * 2026-11-05.** That table has remembered a payer's address against their name
 * since the send was built, and the PDF upload path has always used it - so a
 * merchant who answers "who is this for" once a month was asked again for
 * every row whose own column happened to be blank, and the one merchant this
 * feature exists for keys 46 addresses by hand out of Outlook. Gytis asked for
 * it in those words: *"kai ikeliamas excelis irgi is atminties kontaktus
 * papildyk"*.
 *
 * ⚠️ **The SHEET wins and memory only fills blanks - the opposite of the
 * upload path, deliberately.** There the remembered address beats the one
 * printed on the PDF, because a scanner read the PDF and a human typed the
 * memory. Here the merchant typed the sheet *this month*, so it is the fresher
 * answer of the two; overriding it would quietly undo a correction they had
 * just made.
 *
 * ⚠️ **Matching happens in the Python backend, never here.** `payer_name_key`
 * folds case and diacritics, and a second copy of that rule in TypeScript is
 * the pairing this project keeps paying for - except this one would fail by
 * sending a family another family's invoice. The names go out as printed and
 * the remembered contacts come back; one language owns the rule.
 *
 * ⚠️ **Called AFTER merging, never before.** Merging groups by email, so
 * filling addresses first could join two rows whose names differ but whose
 * remembered address is the same - a merge the merchant never stated. Who
 * shares an invoice is decided by their file alone.
 *
 * ⚠️ **A failure here is not an error.** The worst case is the merchant typing
 * an address they would have typed anyway, so a backend that cannot be reached
 * costs a convenience and must never cost the preview or the issue. It is
 * logged, not raised.
 */
export async function fillRememberedContacts(
  rows: ImportedInvoice[],
  merchantId: string,
  base: string,
  token: string
): Promise<{ rows: ImportedInvoice[]; filled: number }> {
  // Only rows actually missing something are worth asking about, and a row
  // with no name cannot be matched at all.
  const asking = rows.filter(r => r.payerName && (!r.payerEmail || !r.payerPhone));
  if (!asking.length) return { rows, filled: 0 };

  let matches: Record<string, { email?: string | null; email_cc?: string | null; phone?: string | null }> = {};
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/plugin/merchant-payers/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      body: JSON.stringify({
        merchant_id: merchantId,
        names: [...new Set(asking.map(r => r.payerName))],
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn('[payer-contacts] lookup refused', res.status);
      return { rows, filled: 0 };
    }
    const data = await res.json().catch(() => ({}));
    matches = data?.matches ?? {};
  } catch (err) {
    console.warn('[payer-contacts] backend unreachable', String(err));
    return { rows, filled: 0 };
  }

  let filled = 0;
  const out = rows.map(row => {
    const known = row.payerName ? matches[row.payerName] : undefined;
    if (!known) return row;
    const email = row.payerEmail || known.email || null;
    const phone = row.payerPhone || known.phone || null;
    // ⚠️ The cc only ever travels with the address it was remembered beside.
    // Attaching a remembered second parent to an address the sheet supplied
    // would mail this month's invoice to someone the merchant did not list.
    const emailCc = row.payerEmail
      ? row.payerEmailCc
      : (row.payerEmailCc || (known.email ? known.email_cc ?? null : null));
    if (email === row.payerEmail && phone === row.payerPhone && emailCc === row.payerEmailCc) {
      return row;
    }
    filled += 1;
    return { ...row, payerEmail: email, payerPhone: phone, payerEmailCc: emailCc };
  });
  return { rows: out, filled };
}
