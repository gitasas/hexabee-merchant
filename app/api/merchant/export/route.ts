import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';
import { ACCOUNTING_HEADERS, accountingRows, type IssuedRow, type FeeDocRow } from '@/lib/accounting-export';
import { PLATFORM_FEE_EUR } from '@/app/pay/methods';
import { paidSourceKey, type PaidSource } from '@/lib/paid-source';

/**
 * What the `Paid by` column says, per way of closing a row.
 *
 * ⚠️ English, and deliberately not translated: this is a CSV opened in
 * accounting software, and a column whose values change with a browser toggle
 * cannot be imported twice the same way.
 *
 * Typed as a full record of `PaidSource`, so adding a fourth way to settle an
 * invoice fails the build here rather than silently printing "HexaBee" for it.
 */
const PAID_BY_CSV: Record<PaidSource, string> = {
  hexabee: 'HexaBee',
  manual: 'Bank transfer (marked manually)',
  // Closed because the merchant's own accounting says it is paid. No HexaBee
  // payment exists for either, and neither is on our monthly invoice. The
  // system is named rather than lumped under "accounting", because the
  // accountant reading this column may want to go and look.
  //
  // ⚠️ No diacritic in `Rivile`: this file is imported into accounting
  // software, and a column value is the wrong place to discover an encoding
  // problem.
  centas: 'Bank transfer (closed from Centas)',
  rivile: 'Bank transfer (closed from Rivile)',
  statement: 'Bank transfer (closed from bank statement)',
};

/**
 * CSV export for accounting software.
 *
 * Two datasets: `payments` (what was actually collected, with the HexaBee fee
 * broken out so revenue and costs can be booked separately) and `invoices`
 * (the receivables ledger built from BCC'd invoices).
 *
 * `HexaBee fee` means a different thing on each rail, and the `Fee billing`
 * column says which. On Stripe it is deducted before the money arrives, so
 * Net is what landed. On Montonio the whole Gross lands in the merchant's bank
 * and HexaBee invoices the fee monthly - Net is what they keep after that
 * invoice. Until 2026-09-11 Montonio rows reported the fee as 0, so a merchant
 * booking from this file would have found nothing to match HexaBee's invoice to.
 *
 * European spreadsheets and most Lithuanian accounting packages expect
 * semicolon-separated files with comma decimals; the delimiter parameter
 * switches both together so the file always imports cleanly.
 */

const MAX_ROWS = 10000;

type PaymentRow = {
  provider: string;
  provider_payment_id: string | null;
  amount: string;
  currency: string;
  reference: string | null;
  status: string;
  created_at: string;
  payer_fee: string | null;
};

type InvoiceRow = {
  invoice_number: string | null;
  payer_email: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  paid_at: string | null;
  paid_source: string | null;
  created_at: string;
  reminders_sent: number | null;
};

const METHOD_LABELS: Record<string, string> = {
  card: 'Card', google_pay: 'Google Pay', apple_pay: 'Apple Pay',
  klarna: 'Klarna', afterpay: 'Afterpay / Clearpay', billie: 'Billie',
  sepa: 'SEPA Direct Debit', bacs: 'Bacs Direct Debit', bank_transfer: 'Bank Transfer',
  pay_by_bank: 'Pay By Bank', ideal: 'iDEAL', bancontact: 'Bancontact',
  blik: 'BLIK', przelewy24: 'Przelewy24', eps: 'EPS', bank: 'Bank',
  montonio_bank: 'Bank payment (Montonio)', montonio_card: 'Card (Montonio)',
};

// The Montonio rail does not use calculateHexabeeFee at all: the merchant pays
// Montonio directly, and HexaBee invoices a flat EUR 0.39 per paid invoice
// monthly in arrears. That is the number a merchant needs to see per row, or
// HexaBee's monthly invoice has nothing in their books to reconcile against.
const MONTONIO_METHODS = new Set(['montonio_bank', 'montonio_card']);

/**
 * Mirrors calculateHexabeeFee in the payments backend (index.js), computed in
 * minor units exactly like the backend: iDEAL/bank transfer/Pay by Bank = 1%
 * (min 50); BNPL (klarna/afterpay/billie) = 6.9% + 30; GBP = 2% + 20;
 * other = 2.9% + 25.
 *
 * This is the accounting export - a wrong number here lands in the merchant's
 * books, so it must be updated in the same change as calculateHexabeeFee.
 */
function hexabeeFee(amount: number, currency: string, method: string): number {
  if (MONTONIO_METHODS.has(method)) return PLATFORM_FEE_EUR;
  const amountMinor = Math.round(amount * 100);
  let feeMinor: number;
  if (method === 'ideal' || method === 'bank_transfer' || method === 'pay_by_bank') {
    feeMinor = Math.max(Math.round(amountMinor * 0.01), 50);
  } else if (method === 'klarna' || method === 'afterpay' || method === 'billie') {
    feeMinor = Math.round(amountMinor * 0.069) + 30;
  } else if (currency.toUpperCase() === 'GBP') {
    feeMinor = Math.round(amountMinor * 0.02) + 20;
  } else {
    feeMinor = Math.round(amountMinor * 0.029) + 25;
  }
  return feeMinor / 100;
}

function csvValue(value: string | number | null | undefined, delimiter: string): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Quote when the value could otherwise break the row apart
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(
  headers: string[],
  rows: (string | number | null)[][],
  delimiter: string
): string {
  const lines = [headers.join(delimiter)];
  for (const row of rows) {
    lines.push(row.map(v => csvValue(v, delimiter)).join(delimiter));
  }
  // BOM so Excel opens UTF-8 (and Lithuanian characters) correctly
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const rawType = params.get('type');
  const type = rawType === 'invoices' || rawType === 'accounting' ? rawType : 'payments';
  const useSemicolon = params.get('delimiter') !== 'comma';
  const delimiter = useSemicolon ? ';' : ',';
  const decimal = (n: number) => {
    const text = n.toFixed(2);
    return useSemicolon ? text.replace('.', ',') : text;
  };

  const from = params.get('from');
  const to = params.get('to');
  const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

  const filters: string[] = ['merchant_id = $1'];
  const values: unknown[] = [session.id];
  if (isDate(from)) {
    values.push(from);
    filters.push(`created_at >= $${values.length}`);
  }
  if (isDate(to)) {
    // inclusive of the end date
    values.push(to);
    filters.push(`created_at < ($${values.length}::date + interval '1 day')`);
  }
  const where = filters.join(' AND ');

  const stamp = [from ?? 'all', to ?? 'now'].join('_');

  try {
    // The generic file for an accounting program we have no API for
    // (2026-11-16). See lib/accounting-export.ts for what goes in and why.
    // Filtered by the date printed on each document - issue date for an
    // invoice, payment date for a fee document - which is what a bookkeeper
    // closes a month by; `from`/`to` above (created_at) do not apply.
    if (type === 'accounting') {
      const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month')! : null;
      const m = await queryOne<{ is_vat_payer: boolean | null }>(
        'SELECT is_vat_payer FROM merchants WHERE id = $1', [session.id]);
      const issued = await query<IssuedRow>(
        `SELECT invoice_number, issue_date::text AS issue_date, due_date::text AS due_date, payer_name,
                payer_email, line_items, amount, currency, status, paid_at
           FROM merchant_invoices
          WHERE merchant_id = $1 AND source = 'issued'
            ${month ? "AND to_char(issue_date, 'YYYY-MM') = $2" : ''}
          ORDER BY issue_date, invoice_number
          LIMIT ${MAX_ROWS}`,
        month ? [session.id, month] : [session.id]);

      // Fee documents come from the same reader the PDFs and Centas use, so
      // the three cannot disagree. A VAT payer has none (the fee would carry
      // VAT, which nothing here computes).
      let fees: FeeDocRow[] = [];
      if (m?.is_vat_payer !== true) {
        const base = process.env.ADMIN_API_BASE_URL?.replace(/\/$/, '');
        const token = process.env.INTERNAL_SERVICE_TOKEN;
        if (!base || !token) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
        const url = new URL(`${base}/api/plugin/merchant-invoices/fee-documents`);
        url.searchParams.set('merchant_id', session.id);
        if (month) url.searchParams.set('month', month);
        const res = await fetch(url, { headers: { 'X-Internal-Token': token }, cache: 'no-store' });
        if (!res.ok) {
          // A file missing its fee documents would look complete and be
          // imported as such - refuse instead of half-answering.
          console.error('[export] fee documents unavailable', res.status);
          return NextResponse.json({ error: 'upstream' }, { status: 502 });
        }
        fees = ((await res.json()).documents ?? []) as FeeDocRow[];
      }

      const rows = accountingRows(issued, fees, m?.is_vat_payer ?? null, (c) => decimal(c / 100));
      const csv = buildCsv(ACCOUNTING_HEADERS, rows, delimiter);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="hexabee-apskaitai-${month ?? 'visi'}.csv"`,
          'X-Rows': String(rows.length),
          'Cache-Control': 'no-store',
        },
      });
    }

    if (type === 'invoices') {
      const rows = await query<InvoiceRow>(
        `SELECT invoice_number, payer_email, amount, currency, status, paid_at, paid_source, created_at, reminders_sent
         FROM merchant_invoices
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT ${MAX_ROWS}`,
        values
      );

      const csv = buildCsv(
        ['Invoice number', 'Issued', 'Payer', 'Amount', 'Currency', 'Status', 'Paid on', 'Paid by', 'Reminders sent'],
        rows.map(r => [
          r.invoice_number ?? '',
          r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
          r.payer_email ?? '',
          r.amount !== null ? decimal(Number(r.amount)) : '',
          r.currency ?? '',
          r.status,
          r.paid_at ? new Date(r.paid_at).toISOString().slice(0, 10) : '',
          // The accountant needs to know which of these have a HexaBee payment
          // behind them: anything settled straight into the merchant's own bank
          // appears in no HexaBee statement and is not on our monthly invoice.
          //
          // ⚠️ Two of the three values mean "not ours", so this must never be
          // a single `=== 'manual'` test - that reported every Centas-closed
          // row as "HexaBee" and claimed a payment we never handled.
          r.status !== 'paid' ? '' : PAID_BY_CSV[paidSourceKey(r.paid_source)],
          r.reminders_sent ?? 0,
        ]),
        delimiter
      );

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="hexabee-invoices-${stamp}.csv"`,
        },
      });
    }

    const rows = await query<PaymentRow>(
      `SELECT provider, provider_payment_id, amount, currency, reference, status, created_at, payer_fee
       FROM merchant_payments
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${MAX_ROWS}`,
      values
    );

    const csv = buildCsv(
      ['Date', 'Time', 'Payment ID', 'Reference', 'Method', 'Status', 'Invoice amount', 'Payer fee', 'Gross', 'HexaBee fee', 'Fee billing', 'Net', 'Currency'],
      rows.map(r => {
        const created = new Date(r.created_at);
        const method = r.provider === 'stripe' ? 'card' : (r.provider ?? 'card');
        const isMontonio = MONTONIO_METHODS.has(method);
        const gross = Number(r.amount ?? 0);
        // Fees are only charged on payments that actually completed
        const fee = r.status === 'paid' ? hexabeeFee(gross, r.currency ?? 'EUR', method) : 0;
        // What the payer was charged on top of the invoice. Known exactly on
        // the Montonio rail (stored with the payment); on Stripe a grossed-up
        // amount is not recorded separately, so the columns stay blank rather
        // than guess.
        const payerFee = isMontonio && r.payer_fee != null ? Number(r.payer_fee) : null;
        return [
          created.toISOString().slice(0, 10),
          created.toISOString().slice(11, 16),
          r.provider_payment_id ?? '',
          r.reference ?? '',
          METHOD_LABELS[method] ?? method,
          r.status,
          payerFee != null ? decimal(gross - payerFee) : '',
          payerFee != null ? decimal(payerFee) : '',
          decimal(gross),
          decimal(fee),
          isMontonio ? 'invoiced monthly' : 'deducted',
          decimal(gross - fee),
          r.currency ?? '',
        ];
      }),
      delimiter
    );

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="hexabee-payments-${stamp}.csv"`,
      },
    });
  } catch (err) {
    console.error('EXPORT_FAILED', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
