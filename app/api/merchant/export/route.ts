import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/merchant-auth';
import { query } from '@/lib/db';

/**
 * CSV export for accounting software.
 *
 * Two datasets: `payments` (what was actually collected, with the HexaBee fee
 * broken out so revenue and costs can be booked separately) and `invoices`
 * (the receivables ledger built from BCC'd invoices).
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
};

type InvoiceRow = {
  invoice_number: string | null;
  payer_email: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
  reminders_sent: number | null;
};

const METHOD_LABELS: Record<string, string> = {
  card: 'Card', google_pay: 'Google Pay', apple_pay: 'Apple Pay',
  klarna: 'Klarna', afterpay: 'Afterpay / Clearpay', billie: 'Billie',
  sepa: 'SEPA Direct Debit', bacs: 'Bacs Direct Debit', bank_transfer: 'Bank Transfer',
  pay_by_bank: 'Pay By Bank', ideal: 'iDEAL', bancontact: 'Bancontact',
  blik: 'BLIK', przelewy24: 'Przelewy24', eps: 'EPS', bank: 'Bank',
};

/**
 * Mirrors calculateHexabeeFee in the payments backend (index.js), computed in
 * minor units exactly like the backend: iDEAL/bank transfer = 1% (min 50);
 * BNPL (klarna/afterpay/billie) = 6.9% + 30; GBP = 2% + 20; other = 2.9% + 25.
 */
function hexabeeFee(amount: number, currency: string, method: string): number {
  const amountMinor = Math.round(amount * 100);
  let feeMinor: number;
  if (method === 'ideal' || method === 'bank_transfer') {
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
  const type = params.get('type') === 'invoices' ? 'invoices' : 'payments';
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
    if (type === 'invoices') {
      const rows = await query<InvoiceRow>(
        `SELECT invoice_number, payer_email, amount, currency, status, paid_at, created_at, reminders_sent
         FROM merchant_invoices
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT ${MAX_ROWS}`,
        values
      );

      const csv = buildCsv(
        ['Invoice number', 'Issued', 'Payer', 'Amount', 'Currency', 'Status', 'Paid on', 'Reminders sent'],
        rows.map(r => [
          r.invoice_number ?? '',
          r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
          r.payer_email ?? '',
          r.amount !== null ? decimal(Number(r.amount)) : '',
          r.currency ?? '',
          r.status,
          r.paid_at ? new Date(r.paid_at).toISOString().slice(0, 10) : '',
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
      `SELECT provider, provider_payment_id, amount, currency, reference, status, created_at
       FROM merchant_payments
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${MAX_ROWS}`,
      values
    );

    const csv = buildCsv(
      ['Date', 'Time', 'Payment ID', 'Reference', 'Method', 'Status', 'Gross', 'HexaBee fee', 'Net', 'Currency'],
      rows.map(r => {
        const created = new Date(r.created_at);
        const method = r.provider === 'stripe' ? 'card' : (r.provider ?? 'card');
        const gross = Number(r.amount ?? 0);
        // Fees are only charged on payments that actually completed
        const fee = r.status === 'paid' ? hexabeeFee(gross, r.currency ?? 'EUR', method) : 0;
        return [
          created.toISOString().slice(0, 10),
          created.toISOString().slice(11, 16),
          r.provider_payment_id ?? '',
          r.reference ?? '',
          METHOD_LABELS[method] ?? method,
          r.status,
          decimal(gross),
          decimal(fee),
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
