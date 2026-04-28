import { NextRequest, NextResponse } from 'next/server';
import PDFParser from 'pdf2json';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 30;

type PatternResult = {
  amount: string | null;
  currency: string | null;
  iban: string | null;
  reference: string | null;
  rawText: string;
};

function parsePdfBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataError', (err) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
    parser.on('pdfParser_dataReady', (data) => {
      const text = data.Pages
        .flatMap((p) => p.Texts.map((t) => decodeURIComponent(t.R.map((r) => r.T).join(''))))
        .join(' ');
      resolve(text);
    });
    parser.parseBuffer(buffer);
  });
}

function extractPatterns(text: string): PatternResult {
  const amountMatch =
    text.match(/(?:total amount|total)[^\d]*(\d{1,9}[.,]\d{2})\s*(EUR|USD|GBP|€|\$|£)?/i) ||
    text.match(/(\d{1,9}[.,]\d{2})\s*(EUR|USD|GBP|€|\$|£)/i);

  const ibanMatch = text.match(/[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}/);

  const invoiceMatch =
    text.match(/(?:nr\.?|invoice\s+nr\.?)[^\w]*([A-Z0-9][A-Z0-9/-]*\/[A-Z0-9/-]+)/i) ||
    text.match(/(?:invoice|nr\.?|no\.?|number)[^\w\d]*([A-Z0-9/-]+)/i);

  let currency = amountMatch?.[2] ?? null;
  if (currency === '€') currency = 'EUR';
  if (currency === '$') currency = 'USD';
  if (currency === '£') currency = 'GBP';

  return {
    amount: amountMatch?.[1]?.replace(',', '.') ?? null,
    currency: currency ?? 'EUR',
    iban: ibanMatch?.[0]?.replace(/\s/g, '').replace(/[A-Z]+$/, '') ?? null,
    reference: invoiceMatch?.[1] ?? null,
    rawText: text.slice(0, 2000),
  };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await parsePdfBuffer(buffer);
    const patterns = extractPatterns(text);

    // Store only patterns + filename, not the PDF binary (too large for serverless)
    await query(
      `INSERT INTO merchant_templates (id, merchant_id, filename, patterns, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), session.id, file.name, JSON.stringify(patterns)]
    );

    // Keep only latest template
    await query(
      `DELETE FROM merchant_templates
       WHERE merchant_id = $1
         AND id NOT IN (
           SELECT id FROM merchant_templates WHERE merchant_id = $1
           ORDER BY created_at DESC LIMIT 1
         )`,
      [session.id]
    );

    return NextResponse.json({ success: true, patterns });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('TEMPLATE_UPLOAD_ERROR', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const template = await queryOne<{ filename: string; patterns: PatternResult; created_at: string }>(
    'SELECT filename, patterns, created_at FROM merchant_templates WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1',
    [session.id]
  );

  return NextResponse.json(template ?? null);
}
