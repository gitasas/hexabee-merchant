'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

type ExtensionPayload = {
  source?: string;
  subject?: string;
  body?: string;
  detectedAt?: string;
  parsedPdf?: {
    success?: boolean;
    amount?: string | null;
    currency?: string | null;
    reference?: string | null;
    iban?: string | null;
    text?: string;
    error?: string;
  };
};

function extractInvoiceData(text: string) {
  const amountMatch = text.match(
    /(\d{1,9}[.,]\d{2})\s?(EUR|USD|GBP|€|\$|£)/i
  );

  let amount = null;
  let currency = null;

  if (amountMatch) {
    amount = amountMatch[1].replace(',', '.');
    currency = amountMatch[2];

    if (currency === '€') currency = 'EUR';
    if (currency === '$') currency = 'USD';
    if (currency === '£') currency = 'GBP';
  }

  return { amount, currency };
}

function PayPreviewContent() {
  const params = useSearchParams();
  const payload = params.get('payload');

  let parsed: ExtensionPayload | null = null;

  try {
    parsed = payload ? JSON.parse(decodeURIComponent(payload)) : null;
  } catch (e) {
    console.error('Invalid payload', e);
  }

  const textForExtraction = parsed?.parsedPdf?.text || parsed?.body || '';
  const extracted = extractInvoiceData(textForExtraction);

  return (
    <main style={{ padding: 40, fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ fontSize: 44, marginBottom: 12 }}>
        HexaBee Payment Preview
      </h1>

      {!parsed && <p>No data received</p>}

      {parsed && (
        <>
          <section style={{ marginTop: 24 }}>
            <h2>Detected Invoice Data</h2>

            <div style={{ display: 'grid', gap: 12, maxWidth: 600, marginTop: 12 }}>
              <div><strong>Amount:</strong> {extracted.amount || parsed.parsedPdf?.amount || 'Not detected'}</div>
              <div><strong>Currency:</strong> {extracted.currency || parsed.parsedPdf?.currency || 'Not detected'}</div>
              <div><strong>Reference:</strong> {parsed.parsedPdf?.reference || 'Not detected'}</div>
              <div><strong>IBAN:</strong> {parsed.parsedPdf?.iban || 'Not detected'}</div>
              <div><strong>Source:</strong> {parsed.source || 'Unknown'}</div>
              <div><strong>Subject:</strong> {parsed.subject || 'No subject'}</div>
              <div><strong>PDF Parse:</strong> {parsed.parsedPdf?.success ? 'Success' : parsed.parsedPdf?.error || 'Not parsed'}</div>
            </div>
          </section>

          <section style={{ marginTop: 32 }}>
            <h2>Raw Payload</h2>
            <pre style={{ background: '#111', color: '#00ff66', padding: 20, borderRadius: 12, overflowX: 'auto' }}>
              {JSON.stringify(parsed, null, 2)}
            </pre>
          </section>
        </>
      )}
    </main>
  );
}

export default function PayPreview() {
  return (
    <Suspense fallback={<main style={{ padding: 40 }}>Loading...</main>}>
      <PayPreviewContent />
    </Suspense>
  );
}