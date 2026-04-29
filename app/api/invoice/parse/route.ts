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
            decodeURIComponent(textItem.R.map((run) => run.T).join(''))
          )
        )
        .join(' ');
      resolve(text);
    });
    pdfParser.parseBuffer(buffer);
  });
}

type InvoiceData = {
  amount: string | null;
  currency: string;
  reference: string | null;
  iban: string | null;
};

function cleanStr(val: unknown): string | null {
  if (!val || val === 'null' || val === 'N/A' || val === 'n/a') return null;
  return String(val).trim() || null;
}

async function extractWithGemini(buffer: Buffer): Promise<InvoiceData | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Extract payment information from this invoice. Return ONLY valid JSON, no markdown, no explanation.

Fields:
- amount: total amount due as string like "1234.56" (dot as decimal), null if not found
- currency: ISO code EUR/USD/GBP, default "EUR"
- reference: invoice number or payment reference, null if not found
- iban: IBAN bank account, letters and digits only no spaces, null if not found`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: buffer.toString('base64'),
                },
              },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 256 },
        }),
      }
    );

    if (!res.ok) {
      console.error('Gemini error:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const jsonStr = raw.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const amount = cleanStr(parsed.amount)?.replace(',', '.') ?? null;
    const iban = cleanStr(parsed.iban)?.replace(/\s/g, '').replace(/[A-Z]+$/, '') ?? null;

    return {
      amount,
      currency: cleanStr(parsed.currency) ?? 'EUR',
      reference: cleanStr(parsed.reference),
      iban,
    };
  } catch (err) {
    console.error('Gemini parse failed:', err);
    return null;
  }
}

function extractFallback(text: string): InvoiceData {
  // 1. keyword + amount (EN + LT)
  const amountMatch =
    text.match(/(?:total amount due|amount due|total|iš viso|suma mokėti|sąskaitos suma|bendra suma|mokėtina suma)[^\d]{0,60}(\d{1,9}[.,]\d{2})/i) ||
    // 2. amount immediately followed by currency symbol
    text.match(/(\d{1,9}[.,]\d{2})\s*(EUR|USD|GBP|€|\$|£)/i) ||
    // 3. European comma-decimal not part of a date (dates use dots)
    text.match(/(?<![.\d])(\d{1,6},\d{2})(?![.,\d])/);

  // pick the largest comma-decimal if multiple present (likely the total)
  const allCommaDecimals = [...text.matchAll(/(?<![.\d])(\d{1,6},\d{2})(?![.,\d])/g)];
  const largestAmount = allCommaDecimals.length > 0
    ? allCommaDecimals.reduce((a, b) => parseFloat(b[1].replace(',', '.')) > parseFloat(a[1].replace(',', '.')) ? b : a)
    : null;

  const rawAmount = amountMatch?.[1] ?? largestAmount?.[1] ?? null;

  const invoiceMatch =
    text.match(/(?:nr\.?|invoice\s+nr\.?)[^\w]*([A-Z0-9][A-Z0-9/-]*\/[A-Z0-9/-]+)/i) ||
    text.match(/(?:invoice|nr\.?|no\.?|number)[^\w\d]*([A-Z0-9/-]+)/i);

  // prefer longer IBANs (full IBANs over partial)
  const allIbans = [...text.matchAll(/[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}/g)];
  const bestIban = allIbans.length > 0
    ? allIbans.reduce((a, b) => b[0].replace(/\s/g, '').length > a[0].replace(/\s/g, '').length ? b : a)
    : null;

  let currency = amountMatch?.[2] || null;
  if (currency === '€') currency = 'EUR';
  if (currency === '$') currency = 'USD';
  if (currency === '£') currency = 'GBP';

  return {
    amount: rawAmount?.replace(',', '.') || null,
    currency: currency || 'EUR',
    reference: invoiceMatch?.[1] || null,
    iban: bestIban?.[0]?.replace(/\s/g, '').replace(/[A-Z]+$/, '') || null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No PDF file uploaded' });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const geminiResult = await extractWithGemini(buffer);

    let text = '';
    if (!geminiResult) {
      try { text = await parsePdfBuffer(buffer); } catch { /* ignore */ }
    }

    const extracted = geminiResult ?? extractFallback(text);

    return NextResponse.json({
      success: true,
      ...extracted,
      text,
      engine: geminiResult ? 'gemini' : 'regex',
    });
  } catch (error) {
    console.error('PDF PARSE ERROR:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to parse PDF' },
      { status: 500 }
    );
  }
}
