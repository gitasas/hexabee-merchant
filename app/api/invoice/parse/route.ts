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

type InvoiceData = {
  amount: string | null;
  currency: string;
  reference: string | null;
  iban: string | null;
};

async function extractWithGemini(text: string): Promise<InvoiceData | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Extract payment information from this invoice text. Return ONLY valid JSON, no markdown, no explanation.

Fields to extract:
- amount: total amount due as a string like "1234.56" (use dot as decimal separator), null if not found
- currency: ISO code EUR/USD/GBP, default "EUR"
- reference: invoice number or payment reference string, null if not found
- iban: IBAN bank account number, letters and digits only no spaces, null if not found

Invoice text:
${text.slice(0, 8000)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 256 },
        }),
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const jsonStr = raw.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const rawAmount = parsed.amount;
    const amountStr = (rawAmount && rawAmount !== 'null' && rawAmount !== 'N/A')
      ? String(rawAmount).replace(',', '.')
      : null;

    const rawIban = parsed.iban;
    const ibanStr = (rawIban && rawIban !== 'null' && rawIban !== 'N/A')
      ? String(rawIban).replace(/\s/g, '').replace(/[A-Z]+$/, '')
      : null;

    const rawRef = parsed.reference;
    const refStr = (rawRef && rawRef !== 'null' && rawRef !== 'N/A')
      ? String(rawRef)
      : null;

    return {
      amount: amountStr,
      currency: (parsed.currency && parsed.currency !== 'null') ? parsed.currency : 'EUR',
      reference: refStr,
      iban: ibanStr,
    };
  } catch {
    return null;
  }
}

function extractFallback(text: string): InvoiceData {
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
      return NextResponse.json({ success: false, error: 'No PDF file uploaded' });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await parsePdfBuffer(buffer);

    const geminiResult = await extractWithGemini(text);
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
