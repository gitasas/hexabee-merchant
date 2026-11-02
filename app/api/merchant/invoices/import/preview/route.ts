import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { readXlsxSheet, readXlsxSheetNames } from '@/lib/xlsx-read';
import { buildInvoices, detectLayout, readHeaders, suggestMapping, type ImportMapping } from '@/lib/invoice-import';
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

  let mapping = mappingOverride ?? (settings.invoice_import_mapping as ImportMapping | null);
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

  // ⚠️ With no stored mapping this used to answer `needsMapping` and nothing
  // else, so the merchant's first screen was a form asking for "Header row"
  // and "First data row" - the one thing they cannot know. Gytis could not
  // fill them in himself on staging, which is the whole report. Now the
  // layout is FOUND and the preview runs on the draft, so the first thing
  // they see is their own invoices and the form is there to correct it.
  //
  // Every sheet is tried, because the data is not always on the first tab -
  // their workbook carries "2026m. rugsėjo mėn." and an empty "Lapas1". The
  // one whose header stands over the most numeric columns wins; a sheet that
  // cannot be read is simply not a candidate, never an error here.
  let detected: { sheet: string; headerRow: number; firstDataRow: number; labelCount: number } | null = null;
  if (!mapping) {
    let bestScore = -1;
    for (const name of sheetNames) {
      try {
        const candidate = readXlsxSheet(buffer, name);
        const layout = detectLayout(candidate);
        if (layout && layout.numericLabels > bestScore) {
          bestScore = layout.numericLabels;
          detected = { sheet: name, headerRow: layout.headerRow, firstDataRow: layout.firstDataRow, labelCount: layout.labelCount };
        }
      } catch { /* not a candidate */ }
    }
    if (!detected) {
      // Nothing header-shaped anywhere. Asking is the honest answer here, and
      // the only case where the old form is still the first screen.
      return NextResponse.json({
        ok: true, needsMapping: true, detectionFailed: true, sheetNames, mapping: null,
        headers: [], rows: [], refused: [], ignored: [], skipped: 0, unreadable: [],
        blockers: settings.blockers ?? [],
      });
    }
    const draftSheet = readXlsxSheet(buffer, detected.sheet);
    mapping = {
      mode: 'row_per_invoice',
      sheet: detected.sheet,
      headerRow: detected.headerRow,
      firstDataRow: detected.firstDataRow,
      columns: suggestMapping(
        readHeaders(draftSheet, detected.headerRow),
        draftSheet.grid.slice(Math.max(0, detected.firstDataRow - 1))
      ),
    };
  }

  let sheet;
  try {
    sheet = readXlsxSheet(buffer, mapping.sheet ?? 0);
  } catch (err) {
    // ⚠️ **The stored sheet name is this month's tab, and a tab is renamed
    // every month.** Their workbook is called "2026m. rugsėjo mėn." and
    // October's is not, so a mapping saved in September used to meet a dead
    // end in October - a 400 the merchant can do nothing about, every single
    // month, for the one merchant this feature exists for.
    //
    // So the sheet is re-found rather than demanded. What is KEPT is the
    // merchant's own answer about what each column means, because that is
    // stable between months; what is re-read is where this file happens to
    // put its headings. If the layout really did change, the totals check
    // refuses those rows loudly and in front of them, which is the net under
    // all of this.
    console.warn('[import/preview] stored sheet missing - re-detecting', String(err));
    let found: { sheet: string; headerRow: number; firstDataRow: number; labelCount: number } | null = null;
    let bestScore = -1;
    for (const name of sheetNames) {
      try {
        const candidate = readXlsxSheet(buffer, name);
        const layout = detectLayout(candidate);
        if (layout && layout.numericLabels > bestScore) {
          bestScore = layout.numericLabels;
          found = { sheet: name, headerRow: layout.headerRow, firstDataRow: layout.firstDataRow, labelCount: layout.labelCount };
        }
      } catch { /* not a candidate */ }
    }
    if (!found) {
      return NextResponse.json(
        { error: 'sheet_missing', detail: String(err), sheetNames }, { status: 400 }
      );
    }
    detected = found;
    mapping = { ...mapping, sheet: found.sheet, headerRow: found.headerRow, firstDataRow: found.firstDataRow };
    sheet = readXlsxSheet(buffer, found.sheet);
  }

  let built;
  try {
    built = buildInvoices(sheet, mapping);
  } catch (err) {
    console.warn('[import/preview] mapping rejected', String(err));
    // ⚠️ A mapping the merchant stored is their own, so a rejection is an
    // error they must see. A mapping WE detected is a draft, and a dead-end
    // 400 on our own guess would leave them with nothing to do - so that case
    // falls back to the form instead, which is what the form is for.
    if (detected) {
      return NextResponse.json({
        ok: true, needsMapping: true, detectionFailed: true, sheetNames, mapping: null,
        headers: [], rows: [], refused: [], ignored: [], skipped: 0, unreadable: [],
        blockers: settings.blockers ?? [],
      });
    }
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
    // ⚠️ Non-null means the mapping on this response was FOUND, not
    // stored - the screen says so and offers the column editor as a
    // correction. Saving it is still the merchant pressing save.
    detected,
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
