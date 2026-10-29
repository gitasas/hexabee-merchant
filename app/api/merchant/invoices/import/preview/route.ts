import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { readXlsxSheet, readXlsxSheetNames } from '@/lib/xlsx-read';
import { buildInvoices, readHeaders, suggestMapping, type ImportMapping } from '@/lib/invoice-import';
import { computePayable } from '@/lib/invoice-pdf';
import { toInvoiceDoc, issueKeyFor, type IssueSettings } from '@/lib/invoice-issue';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * What would be issued from this spreadsheet, without issuing anything.
 *
 * **The point of the screen is the failure list, not the drop zone.** A row
 * HexaBee cannot be sure of is reported to the merchant, who is standing right
 * there, instead of becoming an invoice nobody can explain - the same rule the
 * batch upload already follows, and the opposite of the BCC path where the same
 * failure is silent because Resend already got its 200.
 *
 * ⚠️ **Nothing is written and no invoice number is allocated.** Numbering moves
 * only at issue time, so an abandoned preview leaves no gaps in the merchant's
 * own series.
 *
 * ⚠️ **The file is parsed here, not in the browser.** The totals this returns
 * are what the merchant approves and what the issued document will then say, so
 * they are computed by the same code both times - see `lib/invoice-issue.ts`.
 */

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const base = process.env.ADMIN_API_BASE_URL?.replace(/\/$/, '');
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  let file: File | null = null;
  let mappingOverride: ImportMapping | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
    const m = form.get('mapping');
    if (typeof m === 'string' && m.trim()) mappingOverride = JSON.parse(m) as ImportMapping;
  } catch {
    return NextResponse.json({ error: 'invalid_upload' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  // The letterhead, and what is still unanswered. A merchant with blockers can
  // still see a preview - finding out what the numbers look like is exactly
  // how they decide to answer the rest - but issuing is refused.
  let settings: IssueSettings;
  try {
    const res = await fetch(
      `${base}/api/plugin/merchant-invoice-settings?merchant_id=${encodeURIComponent(session.id)}`,
      { headers: { 'X-Internal-Token': token }, cache: 'no-store' }
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    settings = (await res.json()) as IssueSettings;
  } catch (err) {
    console.error('[import/preview] settings unreachable', String(err));
    return NextResponse.json({ error: 'upstream' }, { status: 502 });
  }

  const mapping = mappingOverride ?? (settings.invoice_import_mapping as ImportMapping | null);
  const buffer = Buffer.from(await file.arrayBuffer());

  let sheetNames: string[];
  try {
    sheetNames = readXlsxSheetNames(buffer);
  } catch (err) {
    // Said plainly, because the merchant is standing at the screen: a .xls, a
    // CSV renamed, or a password on the file all land here.
    console.warn('[import/preview] unreadable workbook', String(err));
    return NextResponse.json({ error: 'unreadable_file', detail: String(err) }, { status: 400 });
  }

  // With no mapping yet there is nothing to build - answer with the sheets and
  // their headings so the mapping screen has something to show.
  if (!mapping) {
    return NextResponse.json({
      ok: true, needsMapping: true, sheetNames, mapping: null,
      headers: [], ready: [], refused: [], ignored: [], skipped: 0, unreadable: [],
      blockers: settings.blockers ?? [],
    });
  }

  let sheet;
  try {
    sheet = readXlsxSheet(buffer, mapping.sheet ?? 0);
  } catch (err) {
    // ⚠️ A sheet name that is not in the file is an ERROR, not an empty result.
    // Next month's workbook has next month's tab, and reporting "no invoices"
    // would read as "nothing to bill".
    console.warn('[import/preview] sheet missing', String(err));
    return NextResponse.json(
      { error: 'sheet_missing', detail: String(err), sheetNames }, { status: 400 }
    );
  }

  let built;
  try {
    built = buildInvoices(sheet, mapping);
  } catch (err) {
    console.warn('[import/preview] mapping rejected', String(err));
    return NextResponse.json({ error: 'bad_mapping', detail: String(err) }, { status: 400 });
  }

  // Which of this batch are already in the ledger. Without this the merchant
  // would find out by sending a second copy to every family.
  const batch = sheet.name;
  const alreadyIssued = new Map<string, { invoice_number: string; sent: boolean }>();
  try {
    const res = await fetch(
      `${base}/api/plugin/merchant-invoices/issued-keys?merchant_id=${encodeURIComponent(session.id)}&batch=${encodeURIComponent(batch)}`,
      { headers: { 'X-Internal-Token': token }, cache: 'no-store' }
    );
    if (res.ok) {
      const data = (await res.json()) as { issued?: { issue_key: string; invoice_number: string; sent: boolean }[] };
      for (const row of data.issued ?? []) {
        alreadyIssued.set(row.issue_key, { invoice_number: row.invoice_number, sent: row.sent });
      }
    } else {
      throw new Error(`status ${res.status}`);
    }
  } catch (err) {
    // ⚠️ "Could not look" is never reported as "looked and found nothing". If
    // this cannot be read, the preview refuses rather than inviting the
    // merchant to issue a batch that may already exist.
    console.error('[import/preview] issued-keys unreadable', String(err));
    return NextResponse.json({ error: 'issued_keys_unreadable' }, { status: 502 });
  }

  const ctx = {
    number: '', issueDate: new Date().toISOString().slice(0, 10), dueDate: null,
    currency: 'EUR', openingBalance: null, amountInWords: false,
    issuedBy: null, note: null, lang: 'lt' as const,
  };

  let batchTotal = 0;
  const rows = built.ready.map(row => {
    // The same construction the issue step uses, so this total is the total
    // that will be printed and charged.
    const totals = computePayable(toInvoiceDoc(row, settings, ctx));
    const key = issueKeyFor(batch, row);
    const seen = alreadyIssued.get(key);
    if (!seen) batchTotal += totals.payable;
    return {
      sheetRow: row.sheetRow,
      sheetRows: row.sheetRows,
      payerName: row.payerName,
      payerEmail: row.payerEmail,
      // Everyone on the invoice, so a merged one shows both children rather
      // than looking like one child's invoice with the other's money on it.
      subjectName: row.subjectNames.join(', ') || row.subjectName,
      lines: row.lines,
      payable: totals.payable,
      balanceKnown: totals.balanceKnown,
      issueKey: key,
      alreadyIssued: seen ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    needsMapping: false,
    batch,
    sheetNames,
    mapping,
    headers: readHeaders(sheet, mapping.headerRow),
    // A first guess from the headings and the data, offered beside the editor.
    // ⚠️ Returned, never applied: it is a draft the merchant presses a button
    // to accept, which is what separates it from a stored answer nobody gave.
    // The totals check is the net underneath it either way.
    suggested: suggestMapping(
      readHeaders(sheet, mapping.headerRow),
      sheet.grid.slice(Math.max(0, mapping.firstDataRow - 1))
    ),
    rows,
    toIssue: rows.filter(r => !r.alreadyIssued).length,
    alreadyIssued: rows.filter(r => r.alreadyIssued).length,
    batchTotal,
    refused: built.refused,
    ignored: built.ignored,
    skipped: built.skipped,
    // ⚠️ Cells with no readable value. Non-empty means the file is partly
    // unreadable, which is a different statement from "those cells are empty".
    unreadable: built.unreadable,
    blockers: settings.blockers ?? [],
    currency: ctx.currency,
  });
}
