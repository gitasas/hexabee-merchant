import { NextRequest, NextResponse } from 'next/server';
import PDFParser from 'pdf2json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LT_MAP: Record<string, string> = {
  'ą':'a','č':'c','ę':'e','ė':'e','į':'i','š':'s','ų':'u','ū':'u','ž':'z',
  'Ą':'A','Č':'C','Ę':'E','Ė':'E','Į':'I','Š':'S','Ų':'U','Ū':'U','Ž':'Z',
};

function cleanPurpose(raw: string | null): string | null {
  if (!raw) return null;
  // cut at footnote markers (* or similar noise)
  const trimmed = raw.split(/\s*\*|\s{3,}/)[0].trim();
  // transliterate Lithuanian characters
  const ascii = trimmed.replace(/[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/g, c => LT_MAP[c] ?? c);
  // keep only bank-safe chars, collapse spaces, max 140 chars
  return ascii.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140) || null;
}

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
  invoice_number: string | null;
  payment_purpose: string | null;
  payment_reference_template: string | null;
  iban: string | null;
};

function cleanStr(val: unknown): string | null {
  if (!val || val === 'null' || val === 'N/A' || val === 'n/a') return null;
  return String(val).trim() || null;
}

type MerchantPatterns = {
  iban?: string | null;
  currency?: string | null;
  payment_purpose?: string | null;
  payment_reference_template?: string | null;
  invoice_number_label?: string | null;
  amount_label?: string | null;
};

async function getMerchantPatterns(slug: string): Promise<MerchantPatterns | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://checkout.hexabee.buzz'}/api/merchant/template/${slug}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

async function extractWithGemini(text: string, patterns?: MerchantPatterns | null): Promise<InvoiceData | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const knownContext = patterns ? `
IMPORTANT: This invoice is from a known merchant. From their template we already know:
${patterns.iban ? `- Recipient IBAN: ${patterns.iban}` : ''}
${patterns.currency ? `- Currency: ${patterns.currency}` : ''}
${patterns.payment_purpose ? `- Payment purpose (static): ${patterns.payment_purpose}` : ''}
${patterns.payment_reference_template ? `- Payment reference template (payer fills in): ${patterns.payment_reference_template}` : ''}
${patterns.invoice_number_label ? `- Invoice number label: "${patterns.invoice_number_label}"` : ''}
${patterns.amount_label ? `- Amount label: "${patterns.amount_label}"` : ''}

Use the known values above directly. Only extract what is unique to this specific invoice (mainly amount and invoice_number).
` : '';

  const prompt = `You are extracting payment data from an invoice. The invoice text may be in Lithuanian, English, or another language. Return ONLY valid JSON, no markdown, no explanation.
${knownContext}
Fields to extract:
- amount: total amount due as string "1234.56" (dot decimal), null if not found
- currency: ISO code EUR/USD/GBP, default "EUR"
- invoice_number: invoice/document number (use label "${patterns?.invoice_number_label ?? 'PVM sąskaitos numeris, faktūros Nr., invoice No.'}" to find it) — NOT a phone number or date, null if not found
- payment_purpose: static description. Look for "Mokėjimo paskirtis:", "Payment purpose:" etc. Ignore text after *. null if not found
- payment_reference_template: what payer must write in reference field. Look for "Rekvizitai apmokėjimui:", "Mokėjimo paskirtyje nurodyti:" etc. null if not found
- iban: recipient IBAN (longest), letters+digits no spaces, null if not found

Invoice text:
${text.slice(0, 6000)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 300 },
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
      invoice_number: cleanStr(parsed.invoice_number),
      payment_purpose: cleanPurpose(cleanStr(parsed.payment_purpose)),
      payment_reference_template: cleanStr(parsed.payment_reference_template),
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

  // invoice number: look for PVM/faktūros/invoice nr keywords, avoid phone numbers
  const invoiceNumberMatch =
    text.match(/(?:PVM\s+s[aą]skaitos?\s+numeris|faktūros?\s+nr\.?|invoice\s+no\.?|invoice\s+nr\.?|s[aą]skaitos?\s+nr\.?)[^\w\d]{0,10}(\d{1,20})/i) ||
    text.match(/(?:^|\s)([A-Z]{0,4}\d{4,10})(?=\s)/m);

  // payment purpose: static description
  const purposeMatch =
    text.match(/(?:mokėjimo\s+paskirtis|payment\s+purpose|payment\s+description|paskirtis)[:\s]{0,5}([^\n]{5,120})/i);

  // payment reference template: what payer should write in the reference field
  const refTemplateMatch =
    text.match(/(?:rekvizitai\s+apmokėjimui|mokėjimo\s+paskirtyje\s+nurodyti|please\s+quote|payment\s+details|reference)[:\s]{0,5}([^\n]{5,200})/i);

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
    invoice_number: invoiceNumberMatch?.[1] || null,
    payment_purpose: cleanPurpose(purposeMatch?.[1] ?? null),
    payment_reference_template: cleanStr(refTemplateMatch?.[1] ?? null),
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
    const merchantSlug = formData.get('merchantSlug');

    let text = '';
    try { text = await parsePdfBuffer(buffer); } catch { /* ignore */ }

    const patterns = merchantSlug ? await getMerchantPatterns(String(merchantSlug)) : null;
    const geminiResult = await extractWithGemini(text, patterns);

    // if patterns have known values and Gemini didn't find them, fill from patterns
    const base = geminiResult ?? extractFallback(text);
    const extracted: InvoiceData = {
      ...base,
      iban: base.iban ?? patterns?.iban ?? null,
      payment_purpose: base.payment_purpose ?? patterns?.payment_purpose ?? null,
      payment_reference_template: base.payment_reference_template ?? patterns?.payment_reference_template ?? null,
    };

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
