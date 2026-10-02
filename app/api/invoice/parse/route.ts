import { NextRequest, NextResponse } from 'next/server';
import PDFParser from 'pdf2json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


function cleanPurpose(raw: string | null): string | null {
  if (!raw) return null;
  // cut at footnote markers (* or similar noise)
  const trimmed = raw.split(/\s*\*|\s{3,}/)[0].trim();
  // Lithuanian letters are kept (2026-10-01). This used to transliterate
  // ąčęėįšųūž and then strip everything outside printable ASCII, so a school
  // invoice printed "Už Rytį Černiauską" reached the parent's bank as "Uz Ryti
  // Cerniauska". Montonio and the Baltic banks behind it handle Lithuanian
  // perfectly well, and the merchant reconciles against the line as printed.
  //
  // Only control characters are removed now, which also leaves Latvian,
  // Estonian, Polish and Finnish intact - every country on this rail. If some
  // payment system ever rejects a non-ASCII description, narrow it there,
  // where the rejection happens, rather than flattening everyone's names here.
  return trimmed.replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140) || null;
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
            textItem.R.map((run) => { try { return decodeURIComponent(run.T); } catch { return run.T; } }).join('')
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

/**
 * Read an amount that may legitimately be zero or negative.
 *
 * Both are real readings, not failures. A school invoice settled by a parent's
 * prepayment prints "Mokėti: 0,00", and one where the parent overpaid prints
 * "Mokėti: -45,30" - money the school owes them. Treating either as missing fell
 * back to the invoice total, which turned a 45,30 refund into a 45,30 demand
 * (Baltijos licėjus, 2026-10-02).
 *
 * The sign is kept here and judged downstream: anything <= 0 means there is
 * nothing to pay, and `isPayable` in lib/invoice-amount.ts is the one place that
 * says so.
 */
export function cleanAmount(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '' || s === 'null' || s === 'N/A' || s === 'n/a' || s === '-') return null;
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || Math.abs(n) > 1_000_000) return null;
  return n.toFixed(2);
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000); // 2s max

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://checkout.hexabee.buzz'}/api/merchant/template/${slug}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

async function extractWithGemini(text: string, patterns?: MerchantPatterns | null, pdfBuffer?: Buffer): Promise<InvoiceData | null> {
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
- amount: what the payer still has to pay, as string "1234.56" (dot decimal), null if not found. This is NOT always the invoice total. When the invoice shows a total and then applies a previous balance, credit or prepayment ("Pradinis įsiskolinimas", "Permoka", "Previous balance"), take the final payable line ("Mokėti", "Mokėtina suma", "Amount due", "Total due") and NOT the total ("Bendra suma", "Iš viso", "Total"). If that final line is zero return "0.00". If it is negative, because the payer overpaid and is owed money, return it WITH the minus sign, e.g. "-45.30". Never drop a minus sign and never return the absolute value
- currency: ISO code EUR/USD/GBP, default "EUR"
- invoice_number: invoice/document number (use label "${patterns?.invoice_number_label ?? 'PVM sąskaitos numeris, faktūros Nr., invoice No.'}" to find it) — NOT a phone number or date, null if not found
- payment_purpose: if the invoice prints a line of its own beginning with "Už " naming who the payment is for (for example "Už Rytį Černiauską" or "Už Rytį Černiauską, Akvilę Vikontaitę"), return that line VERBATIM, exactly as printed, including the leading "Už". Preserve every Lithuanian letter exactly as printed: ą č ę ė į š ų ū ž. Return "Už Rytį Černiauską", NEVER "Uz Ryti Cerniauska". Do not transliterate to ASCII. Do not paraphrase it, do not translate it, do not strip accents, do not append the invoice number, and do not build a description out of the service lines. If there is no such line, look for a labelled "Mokėjimo paskirtis:" or "Payment purpose:" and return that. Otherwise null. Note that "už" also appears lower-case inside service lines such as "Mokymo paslaugos už 2026-05" - that is a billing period, not a payment purpose.
- payment_reference_template: what payer must write in reference field. Look for "Rekvizitai apmokėjimui:", "Mokėjimo paskirtyje nurodyti:" etc. null if not found
- iban: recipient IBAN (longest), letters+digits no spaces, null if not found

Invoice text:
${text.slice(0, 6000)}`;

    // The image path does NOT use the prompt above - only this. A bare field list
  // is why the model invented "Mokymo paslaugos ir maitinimas uz Ryti
  // Cerniauska, saskaita BL2605040" instead of returning the line the invoice
  // actually prints (2026-10-01). Rules that matter have to live here too.
  const jsonInstruction = `Return ONLY valid JSON, no markdown, no explanation. Fields: amount, currency, invoice_number, payment_purpose, payment_reference_template, iban

- amount: what the payer still has to pay, as string "1234.56" (dot decimal), null if not found. This is NOT always the invoice total. When the invoice shows a total and then applies a previous balance, credit or prepayment ("Pradinis įsiskolinimas", "Permoka", "Previous balance"), take the final payable line ("Mokėti", "Mokėtina suma", "Amount due", "Total due") and NOT the total ("Bendra suma", "Iš viso", "Total"). If that final line is zero return "0.00". If it is negative, because the payer overpaid and is owed money, return it WITH the minus sign, e.g. "-45.30". Never drop a minus sign and never return the absolute value
- currency: ISO code EUR/USD/GBP, default "EUR"
- invoice_number: the invoice or document number, null if not found
- iban: recipient IBAN, letters and digits, no spaces, null if not found
- payment_purpose: if the invoice prints a line of its own beginning with "Už " naming who the payment is for (for example "Už Rytį Černiauską" or "Už Rytį Černiauską, Akvilę Vikontaitę"), return that line VERBATIM, exactly as printed, including the leading "Už". Preserve every Lithuanian letter exactly as printed: ą č ę ė į š ų ū ž. Return "Už Rytį Černiauską", NEVER "Uz Ryti Cerniauska". Do not transliterate to ASCII. Do not paraphrase it, do not translate it, do not strip accents, do not append the invoice number, and do not build a description out of the service lines. If there is no such line, look for a labelled "Mokėjimo paskirtis:" or "Payment purpose:" and return that. Otherwise null. Note that "už" also appears lower-case inside service lines such as "Mokymo paslaugos už 2026-05" - that is a billing period, not a payment purpose.`;

  let contents;
  if (pdfBuffer && pdfBuffer.length > 0) {
    contents = [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: pdfBuffer.toString('base64') } }, { text: `Extract payment data from this invoice PDF.\n${knownContext}\n${jsonInstruction}` }] }];
  } else {
    contents = [{ parts: [{ text: prompt }] }];
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
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

    // Not cleanStr: the model may answer with the JSON number 0 rather than the
    // string "0.00", and cleanStr's `!val` test reads 0 as missing. A zero is an
    // answer here - it is what a school invoice says when a prepayment already
    // covers it - so it has to survive the trip (2026-10-02).
    const amount = cleanAmount(parsed.amount);
    const iban = cleanStr(parsed.iban)?.replace(/\s/g, '').replace(/[A-Z]+$/, '') ?? null;

    return {
      amount,
      currency: normaliseCurrency(cleanStr(parsed.currency)),
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

function parsePdfBufferWithTimeout(buffer: Buffer, ms = 5000): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(""); }, ms);
    parsePdfBuffer(buffer)
      .then((text) => { clearTimeout(timer); resolve(text); })
      .catch(() => { clearTimeout(timer); resolve(""); });
  });
}

/**
 * Invoices write the currency however they like - "Eur", "eur", "EUR", "€".
 * Gemini echoes what it read, so "720,40 Eur" came back as "Eur" and the pay
 * page printed it beside the amount exactly like that (2026-10-01). Normalise
 * at the source, so every surface downstream gets a real ISO code and none of
 * them has to remember to upper-case it.
 */
function normaliseCurrency(raw: string | null | undefined): string {
  const v = String(raw ?? '').trim().toUpperCase();
  if (v === '€' || v === 'EURO' || v === 'EUR') return 'EUR';
  if (v === '$' || v === 'USD') return 'USD';
  if (v === '£' || v === 'GBP') return 'GBP';
  // Anything else that is not a plausible ISO code is not worth guessing at.
  return /^[A-Z]{3}$/.test(v) ? v : 'EUR';
}

function extractFallback(text: string): InvoiceData {
  // 0. A stated payable beats a computed total, and it is the only one of the
  // two that can be zero or negative. Baltijos licėjus print "Bendra suma
  // 117,40" and then, after applying the parent's prepayment, "Mokėti: -45,30"
  // - the school owes them 45,30. "bendra suma" is in the list below and
  // appears higher up the page, so it would win on position alone and the
  // refund would be read as a charge (2026-10-02).
  //
  // The gap between label and number is whitespace and an optional colon,
  // nothing else. That is what keeps "Apmokėti iki 2026.06.19" out: a due date
  // never follows its label with only a space and a digit-dot-digit pair, and a
  // looser gap would have captured "2026.06" as an amount. A label separated
  // from its number by dot leaders or a currency word simply falls through to
  // the rules below, which is exactly what happened before this existed.
  const payableMatch = text.match(
    /(?:mokėti|mokėtina\s+suma|suma\s+mokėti|amount\s+due|total\s+due)\s*:?\s*(-?\d{1,9}[.,]\d{2})(?![.,]?\d)/i
  );

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

  const rawAmount = payableMatch?.[1] ?? amountMatch?.[1] ?? largestAmount?.[1] ?? null;

  // invoice number: look for PVM/faktūros/invoice nr keywords, avoid phone numbers
  const invoiceNumberMatch =
    text.match(/(?:serija\s+\w+\s+nr\.?|s[aą]skaitos?\s+nr\.?|PVM\s+s[aą]skaitos?\s+numeris|faktūros?\s+nr\.?|invoice\s+no\.?|invoice\s+nr\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/\.]{2,20})/i) ||
    text.match(/(?:PVM\s+s[aą]skaitos?\s+numeris|faktūros?\s+nr\.?|invoice\s+no\.?|invoice\s+nr\.?|s[aą]skaitos?\s+nr\.?)[^\w\d]{0,10}(\d{1,20})/i) ||
    text.match(/(?:^|\s)([A-Z]{0,4}\d{4,10})(?=\s)/m);

  // payment purpose: either a labelled line, or a line of its own naming who the
  // payment is for. Lithuanian school invoices print "Už Rytį Černiauską" with
  // no label at all, and that - not the invoice number - is what the school
  // reconciles against. Only a line BEGINNING with capital "Už " counts: the
  // same word appears lower-case inside "Mokymo paslaugos už 2026-05", and
  // matching that would put the billing month in the payment purpose. Kept in
  // step with detectPaymentPurpose() in the Node backend's index.js.
  const purposeMatch =
    text.match(/(?:mokėjimo\s+paskirtis|payment\s+purpose|payment\s+description|paskirtis)[:\s]{0,5}([^\n]{5,120})/i);
  const forWhomMatch = [...text.matchAll(/^[ \t]*(Už[ \t]+[^\n]{3,160})$/gm)]
    .map(m => m[1].trim().replace(/\s+/g, ' '))
    .find(v => !/^Už\s+\d/.test(v));

  // payment reference template: what payer should write in the reference field
  const refTemplateMatch =
    text.match(/(?:rekvizitai\s+apmokėjimui|mokėjimo\s+paskirtyje\s+nurodyti|please\s+quote|payment\s+details|reference)[:\s]{0,5}([^\n]{5,200})/i);

  // prefer longer IBANs (full IBANs over partial)
  const allIbans = [...text.matchAll(/[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}/g)];
  const bestIban = allIbans.length > 0
    ? allIbans.reduce((a, b) => b[0].replace(/\s/g, '').length > a[0].replace(/\s/g, '').length ? b : a)
    : null;

  const currency = normaliseCurrency(amountMatch?.[2]);

  return {
    amount: rawAmount?.replace(',', '.') || null,
    currency,
    invoice_number: invoiceNumberMatch?.[1] || null,
    payment_purpose: cleanPurpose(purposeMatch?.[1] ?? forWhomMatch ?? null),
    payment_reference_template: cleanStr(refTemplateMatch?.[1] ?? null),
    iban: bestIban?.[0]?.replace(/\s/g, '').replace(/[A-Z]+$/, '') || null,
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-vercel-protection-bypass',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    let file: File | null = null;
    let merchantSlug: string | null = null;

    if (contentType.includes('application/json')) {
      const json = await req.json();
      if (json.fileBase64) {
        const binaryStr = atob(json.fileBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        file = new File([bytes], 'invoice.pdf', { type: 'application/pdf' });
      }
      merchantSlug = json.merchantSlug ?? null;
    } else {
      const formData = await req.formData();
      file = formData.get('file') as File | null;
      merchantSlug = formData.get('merchantSlug') as string | null;
    }

    if (!file) {
      return NextResponse.json({ success: false, error: "No PDF file uploaded" }, { headers: CORS_HEADERS });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let text = '';
    try { text = await parsePdfBufferWithTimeout(buffer, 5000); } catch { /* ignore */ }

    const patterns = merchantSlug ? await getMerchantPatterns(String(merchantSlug)) : null;

    // Text can be present and still be worthless, so an empty-string check is
    // not enough. Baltijos licėjus issue PDFs whose font carries no usable
    // encoding: ~580 characters of letters come out shifted by a constant, and
    // every real digit is dropped. Not empty, so the page was never handed to
    // the model - the payer saw "invoice read" and an amount of 0.00, which is
    // the worst of both, because it looks like it worked (2026-10-01).
    //
    // Ask whether anything came out of the text, not whether text came out. No
    // amount and no IBAN means the rule-based pass found nothing an invoice
    // must have, so the model should see the page instead of the characters.
    const ruleBased = extractFallback(text);
    const textYieldedNothing = !ruleBased.amount && !ruleBased.iban;
    const sendPdfToModel = text === '' || textYieldedNothing;
    console.log(
      '[parse] text length:', text.length, 'buffer size:', buffer.length,
      'pdf to model:', sendPdfToModel, textYieldedNothing && text !== '' ? '(text yielded nothing)' : ''
    );
    const geminiResult = await extractWithGemini(text, patterns, sendPdfToModel ? buffer : undefined);
    console.log("[parse] geminiResult:", geminiResult ? "found" : "null");

    // if patterns have known values and Gemini didn't find them, fill from patterns
    const base = geminiResult ?? ruleBased;
    const extracted: InvoiceData = {
      ...base,
      iban: base.iban ?? patterns?.iban ?? null,
      // The rule wins over the model for this one field. It reads the raw text,
      // so it keeps "Už Rytį Černiauską" exactly; the model returns the right
      // words but flattens every Lithuanian letter to ASCII - confirmed on a
      // clean PDF whose text layer is perfect, so it is the model's behaviour,
      // not a limit of the input. The model stays as the fallback, because on a
      // PDF with broken encoding it is the only thing that reads anything.
      payment_purpose: ruleBased.payment_purpose ?? base.payment_purpose ?? patterns?.payment_purpose ?? null,
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
