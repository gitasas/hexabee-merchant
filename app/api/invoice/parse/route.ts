import { NextRequest, NextResponse } from 'next/server';
import PDFParser from 'pdf2json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePdfBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on('pdfParser_dataError', (errData) => {
      reject(errData instanceof Error ? errData : new Error(String(errData.parserError)));
    });

    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      const text = pdfData.Pages
        .flatMap((page) =>
          page.Texts.map((textItem) =>
            decodeURIComponent(
              textItem.R.map((run) => run.T).join('')
            )
          )
        )
        .join(' ');

      resolve(text);
    });

    pdfParser.parseBuffer(buffer);
  });
}

function extractInvoiceData(text: string) {
  const amountMatch =
    text.match(/(?:total amount|total)[^\d]*(\d{1,9}[.,]\d{2})\s*(EUR|USD|GBP|€|\$|£)?/i) ||
    text.match(/(\d{1,9}[.,]\d{2})\s*(EUR|USD|GBP|€|\$|£)/i);

  const invoiceMatch =
    text.match(/(?:nr\.?|invoice\s+nr\.?)[^\w]*([A-Z0-9][A-Z0-9/-]*\/[A-Z0-9/-]+)/i) ||
    text.match(/(?:invoice|nr\.?|no\.?|number)[^\w\d]*([A-Z0-9/-]+)/i);

  const ibanMatch = text.match(/[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}/);

  let currency = amountMatch?.[2] || null;
  if (currency === '€') currency = 'EUR';
  if (currency === '$') currency = 'USD';
  if (currency === '£') currency = 'GBP';

  return {
    amount: amountMatch?.[1]?.replace(',', '.') || null,
    currency: currency || 'EUR',
    reference: invoiceMatch?.[1] || null,
    iban: ibanMatch?.[0]?.replace(/\s/g, '').replace(/[A-Z]+$/, '') || null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({
        success: false,
        error: 'No PDF file uploaded',
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await parsePdfBuffer(buffer);
    const extracted = extractInvoiceData(text);

    return NextResponse.json({
      success: true,
      ...extracted,
      text,
    });
  } catch (error) {
    console.error('PDF PARSE ERROR:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse PDF',
      },
      { status: 500 }
    );
  }
}