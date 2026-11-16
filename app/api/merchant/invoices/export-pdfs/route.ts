import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { zipFiles, type ZipEntry } from '@/lib/zip-write';
import { feeDocPdf, type FeeDoc, type FeeSeller } from '@/lib/fee-doc-pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Download the merchant's documents as one ZIP: the invoices HexaBee issued,
 * the 0,49 EUR fee documents (`<invoice>-M`), or both, for a month or for all
 * time (2026-11-16 - the bookkeeper takes them herself rather than asking).
 *
 * ⚠️ **This exists because Centas cannot take the document.**
 * `/documents/create` accepts the figures and carries **no PDF field at all** -
 * the only `pdf_base64` in their specification is on `/purchase/import`, which
 * is company-to-company exchange and needs the receiver to be a Centas user. A
 * school's parents are not. So the bookkeeper gets the documents this way.
 *
 * The backend reports which invoices it could not include, and the manifest
 * inside the ZIP names them. That matters more than the files: a bookkeeper
 * handed 44 documents when 46 were issued, with nothing saying so, reconciles
 * the difference as a mistake of her own. The fee documents get a manifest of
 * their own for the same reason, plus the payments that could not become one.
 *
 * ⚠️ Invoices are filtered by ISSUE date, fee documents by PAYMENT date - each
 * by the date printed on it, which is what a bookkeeper closes a period by.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const base = process.env.ADMIN_API_BASE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const api = base.replace(/\/$/, '');
  const sp = req.nextUrl.searchParams;
  const batch = sp.get('batch');
  const month = /^\d{4}-\d{2}$/.test(sp.get('month') || '') ? sp.get('month')! : null;
  const wantInvoices = sp.get('invoices') !== '0';
  const wantFees = sp.get('fees') === '1';
  if (!wantInvoices && !wantFees) return NextResponse.json({ error: 'nothing_selected' }, { status: 400 });

  const get = async (path: string, params: Record<string, string>) => {
    const url = new URL(`${api}${path}`);
    url.searchParams.set('merchant_id', session.id);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { 'X-Internal-Token': token }, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The backend's own English never reaches the portal - the status is
      // what the caller maps to a dictionary key. See CLAUDE.md.
      console.error('[export-pdfs] backend refused', path, res.status, data);
      throw new Error(String(res.status));
    }
    return data;
  };

  try {
    // Invoices alone: the backend's own archive, as before.
    if (!wantFees) {
      const data = await get('/api/plugin/merchant-invoices/export-pdfs', {
        ...(batch ? { batch } : {}), ...(month ? { month } : {}),
      });
      const zip = Buffer.from(String(data.zip_base64 || ''), 'base64');
      return new NextResponse(new Uint8Array(zip), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${String(data.filename || 'saskaitos.zip').replace(/"/g, '')}"`,
          // So the page can say "44 of 46" without opening the archive.
          'X-Invoice-Total': String(data.total ?? ''),
          'X-Invoice-Included': String(data.included ?? ''),
          'X-Invoice-Missing': String(data.missing ?? ''),
          'Cache-Control': 'no-store',
        },
      });
    }

    const entries: ZipEntry[] = [];
    const bom = '﻿';
    let inv = { total: 0, included: 0, missing: 0 };
    if (wantInvoices) {
      const data = await get('/api/plugin/merchant-invoices/export-pdfs', {
        as_files: 'true', ...(batch ? { batch } : {}), ...(month ? { month } : {}),
      });
      inv = { total: data.total ?? 0, included: data.included ?? 0, missing: data.missing ?? 0 };
      for (const f of data.files ?? []) entries.push({ name: `Saskaitos/${f.name}`, data: Buffer.from(f.base64, 'base64') });
      if (inv.total) entries.push({ name: 'Saskaitos/saskaitos.csv', data: Buffer.from(bom + String(data.manifest_csv || ''), 'utf8') });
    }

    const fees = await get('/api/plugin/merchant-invoices/fee-documents', month ? { month } : {});
    const seller = fees.seller as FeeSeller;
    // A VAT payer's fee carries VAT, and Centas was never written for them -
    // printing "PVM netaikomas" on their documents would be wrong.
    const docs: FeeDoc[] = seller?.is_vat_payer === true ? [] : (fees.documents ?? []);
    const used = new Set<string>();
    const rows = [['Dokumento nr.', 'Data', 'Pirkejas', 'Saskaita', 'Suma', 'Cente', 'PDF faile'].join(';')];
    for (const d of docs) {
      let name = `${d.number} ${d.buyer}`.replace(/[\\/:*?"<>|\r\n\t]+/g, '-').trim().slice(0, 120) + '.pdf';
      for (let n = 2; used.has(name); n++) name = name.replace(/( \(\d+\))?\.pdf$/, ` (${n}).pdf`);
      used.add(name);
      entries.push({ name: `Mokesciai_M/${name}`, data: feeDocPdf(d, seller) });
      rows.push([d.number, d.date, d.buyer, d.invoice_number, d.fee_eur.toFixed(2), d.in_centas ? 'taip' : 'ne', name].join(';'));
    }
    for (const s of fees.skipped ?? []) {
      rows.push([`${s.reference ?? '?'}-M`, s.date, '', s.reference ?? '', '', 'ne', 'NERA - saskaita nerasta'].join(';'));
    }
    if (docs.length || (fees.skipped ?? []).length) {
      entries.push({ name: 'Mokesciai_M/mokesciai.csv', data: Buffer.from(bom + rows.join('\r\n') + '\r\n', 'utf8') });
    }

    if (!entries.length) return NextResponse.json({ error: 'empty' }, { status: 404 });

    const zip = zipFiles(entries);
    const filename = `hexabee-dokumentai-${month ?? 'visi'}.zip`;
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Invoice-Total': String(inv.total),
        'X-Invoice-Included': String(inv.included),
        'X-Invoice-Missing': String(inv.missing),
        'X-Fee-Included': String(docs.length),
        'X-Fee-Skipped': String((fees.skipped ?? []).length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const status = Number((err as Error).message);
    if (status === 404) return NextResponse.json({ error: 'empty' }, { status: 404 });
    console.error('[export-pdfs] failed', String(err));
    return NextResponse.json({ error: 'upstream' }, { status: 502 });
  }
}
