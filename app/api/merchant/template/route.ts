import { NextRequest, NextResponse } from 'next/server';
import PDFParser from 'pdf2json';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/merchant-auth';
import { query, queryOne } from '@/lib/db';

export const runtime = 'nodejs';

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

async function learnPatternsWithGemini(text: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return {};

  const prompt = `Analyze this merchant invoice template and extract the payment fields. Return ONLY valid JSON, no markdown.

Fields to extract:
- iban: recipient IBAN (letters+digits, no spaces, longest one), null if not found
- currency: ISO code EUR/USD/GBP, default "EUR"
- payment_purpose: static payment description text (from "Mokėjimo paskirtis:" or "Payment purpose:" label), null if not found
- payment_reference_template: what the PAYER must write in payment reference (from "Rekvizitai apmokėjimui:", "Mokėjimo paskirtyje nurodyti:" etc.), null if not found
- invoice_number_label: the exact label used before the invoice number (e.g. "PVM sąskaitos numeris", "Invoice No", "Faktūros Nr"), null if not found
- amount_label: the exact label or keyword that appears before/near the amount value (e.g. "Data", "Suma", "Total"), null if not found

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
          generationConfig: { temperature: 0, maxOutputTokens: 400 },
        }),
      }
    );

    if (!res.ok) {
      console.error('Gemini learn error:', res.status, await res.text());
      return {};
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const jsonStr = raw.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // transliterate Lithuanian chars in payment_purpose
    const LT_MAP: Record<string, string> = {
      'ą':'a','č':'c','ę':'e','ė':'e','į':'i','š':'s','ų':'u','ū':'u','ž':'z',
      'Ą':'A','Č':'C','Ę':'E','Ė':'E','Į':'I','Š':'S','Ų':'U','Ū':'U','Ž':'Z',
    };
    const clean = (v: unknown) => v && v !== 'null' ? String(v).replace(/[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/g, c => LT_MAP[c] ?? c).replace(/[^\x20-\x7E]/g, '').trim() || null : null;

    return {
      iban: clean(parsed.iban)?.replace(/\s/g, '').replace(/[A-Z]+$/, '') ?? null,
      currency: clean(parsed.currency) ?? 'EUR',
      payment_purpose: clean(parsed.payment_purpose),
      payment_reference_template: clean(parsed.payment_reference_template),
      invoice_number_label: clean(parsed.invoice_number_label),
      amount_label: clean(parsed.amount_label),
    };
  } catch (err) {
    console.error('Gemini learn parse failed:', err);
    return {};
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const contentType = req.headers.get('content-type') ?? '';
    let filename = 'template.pdf';
    let patterns: Record<string, unknown> = {};

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');

      if (file instanceof File) {
        filename = file.name;
        const buffer = Buffer.from(await file.arrayBuffer());
        let text = '';
        try { text = await parsePdfBuffer(buffer); } catch { /* ignore */ }
        if (text.trim()) {
          patterns = await learnPatternsWithGemini(text);
        }
      }
    } else {
      const body = await req.json();
      filename = body.filename ?? 'template.pdf';
    }

    await query(
      `INSERT INTO merchant_templates (id, merchant_id, filename, patterns, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), session.id, filename, JSON.stringify(patterns)]
    );

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
    console.error('TEMPLATE_SAVE_ERROR', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const template = await queryOne<{ filename: string; patterns: unknown; created_at: string }>(
    'SELECT filename, patterns, created_at FROM merchant_templates WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1',
    [session.id]
  );

  return NextResponse.json(template ?? null);
}
