'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PayLangProvider, usePayLang, PayLangToggle } from '../pay/i18n';

type SessionData = {
  id: string;
  amount_total: number | null;
  currency: string | null;
  payment_status: string;
  created: number;
  // Present on the Montonio rail (from merchant_payments.payer_fee); absent on a
  // Stripe session, where the gross-up is baked into the amount and not recorded.
  payer_fee?: number | null;
  invoice_amount?: number | null;
  metadata: Record<string, string>;
  customer_details: { email?: string | null; name?: string | null } | null;
};

/**
 * The PDF embeds Noto Sans (see receipt-font.ts), subset to Latin-1, Latin
 * Extended-A, the euro sign and the punctuation the receipt uses. That covers
 * Lithuanian, Latvian, Estonian and Polish names and every string in the
 * dictionary. Anything outside the subset has no glyph and would print as an
 * empty box, so it is dropped here: this guards the fields that come from a
 * merchant or a payer, not our own copy.
 *
 * ✓ is one of those characters — it is not in Noto Sans. The receipt's status
 * is a word (`t.receipt.paid`), never the checkmark the screen uses.
 */
function pdfSafe(value: string): string {
  return value.replace(
    /[^\u0020-\u007e\u00a0-\u017f\u2010-\u2015\u2018-\u201e\u2026\u20ac]/g,
    ''
  );
}

/**
 * The fallback if the embedded font ever fails to register: drop the accents and
 * keep the letters, so "Apmokėta" becomes "Apmoketa" — ugly, but a receipt. It
 * is what the whole PDF used to look like before 2026-09-23.
 */
function asciiFold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\u0020-\u007e]/g, '');
}

/**
 * Does the embedded font actually work? jsPDF parses a TTF inside a PubSub
 * handler and **swallows whatever that handler throws**, so `addFont` reports
 * success for a font it failed to read; the failure surfaces only at the first
 * doc.text(), as `Cannot read properties of undefined (reading 'widths')`, by
 * which point the payer is looking at a button that does nothing.
 *
 * So ask the font to do the one thing that breaks, before drawing anything.
 * getTextWidth walks exactly the metrics that a broken font is missing.
 */
function unicodeFontWorks(doc: {
  setFont: (f: string, s: string) => void;
  getTextWidth: (s: string) => number;
}): boolean {
  try {
    for (const style of ['normal', 'bold']) {
      doc.setFont(RECEIPT_FONT, style);
      if (!(doc.getTextWidth('Apmokėta €') > 0)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const RECEIPT_FONT = 'NotoSans';

/** Amount for the PDF: the code after the number, never a symbol. */
function pdfAmount(amount: number | null, currency: string | null) {
  if (amount == null || !currency) return '-';
  return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function formatAmount(amount: number | null, currency: string | null, locale = 'en-GB') {
  if (!amount || !currency) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
}

function formatDate(timestamp: number, locale = 'en-GB') {
  return new Date(timestamp * 1000).toLocaleString(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const { t } = usePayLang();
  const sessionId = searchParams.get('session_id');
  // Payments that did not go through Stripe arrive with our own payment id. Same
  // page, same receipt — the payer should not get a different experience because
  // of which rail carried their money.
  const paymentId = searchParams.get('payment_id');
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  // Still true while the provider's notification may yet arrive. Once the polls
  // are spent and the payment is still not paid, it did not happen.
  const [settling, setSettling] = useState(true);
  const [generating, setGenerating] = useState(false);
  // A receipt that fails to generate used to fail in the console only: the
  // button stopped spinning, no file arrived, and the payer was left guessing.
  const [receiptFailed, setReceiptFailed] = useState(false);

  useEffect(() => {
    const url = sessionId
      ? `/api/payment/session/${sessionId}`
      : paymentId
        ? `/api/payment/receipt/${paymentId}`
        : null;
    if (!url) { setLoading(false); return; }

    let cancelled = false;
    let attempts = 0;

    // On a bank payment the payer lands here before the provider's notification
    // does, so the first read can still say 'initiated'. Give it a few seconds
    // rather than showing someone who has just paid an unpaid receipt.
    //
    // But not forever, and never optimistically: Montonio sends a payer who
    // cancelled at the bank to this same URL, and this page used to greet them
    // with "Payment successful — Paid ✓" and a receipt to download. Once the
    // polls run out with the status still not paid, say so.
    const load = () => {
      fetch(url)
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (cancelled) return;
          setSession(data);
          setLoading(false);
          attempts += 1;
          if (data && data.payment_status !== 'paid' && attempts < 6) {
            setTimeout(load, 2000);
          } else {
            setSettling(false);
          }
        })
        .catch(() => { if (!cancelled) { setLoading(false); setSettling(false); } });
    };
    load();

    return () => { cancelled = true; };
  }, [sessionId, paymentId]);

  async function downloadReceipt() {
    if (!session) return;
    setGenerating(true);
    setReceiptFailed(false);
    try {
      // Both load only on this click — jspdf and ~44 kB of font stay out of the
      // page bundle for every payer who never downloads a receipt.
      const [{ jsPDF }, { NOTO_SANS_REGULAR_BASE64, NOTO_SANS_BOLD_BASE64 }] = await Promise.all([
        import('jspdf'),
        import('./receipt-font'),
      ]);
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });

      // The receipt is written in the payer's language, which is only possible
      // with a Unicode font: jsPDF's built-in Helvetica is WinAnsi, so it can
      // render neither "Apmokėta" nor the euro sign. Registered under one family
      // in two weights, so every setFont(font, …) below resolves.
      doc.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR_BASE64);
      doc.addFont('NotoSans-Regular.ttf', RECEIPT_FONT, 'normal');
      doc.addFileToVFS('NotoSans-Bold.ttf', NOTO_SANS_BOLD_BASE64);
      doc.addFont('NotoSans-Bold.ttf', RECEIPT_FONT, 'bold');

      // Never assume that worked. If the font is unusable the receipt is still
      // produced, in folded ASCII on Helvetica, and the reason is logged — a
      // payer standing in a shop gets a document either way, and the regression
      // shows up in the console rather than as a dead button.
      const unicode = unicodeFontWorks(doc);
      const font = unicode ? RECEIPT_FONT : 'helvetica';
      const txt = unicode ? pdfSafe : asciiFold;
      if (!unicode) {
        console.error(
          '[receipt] the embedded Noto Sans did not register — falling back to ASCII. ' +
            'If receipt-font.ts was regenerated, check its name table: see the header of that file.'
        );
      }

      const pageW = doc.internal.pageSize.getWidth();
      let y = 20;

      // Header
      doc.setFontSize(22);
      doc.setFont(font, 'bold');
      doc.setTextColor(26, 26, 26);
      doc.text('HexaBee', pageW / 2, y, { align: 'center' });
      y += 8;

      doc.setFontSize(12);
      doc.setFont(font, 'normal');
      doc.setTextColor(107, 114, 128);
      doc.text(txt(t.receipt.title), pageW / 2, y, { align: 'center' });
      y += 12;

      // Divider
      doc.setDrawColor(229, 231, 235);
      doc.line(20, y, pageW - 20, y);
      y += 10;

      // Status badge
      doc.setFontSize(11);
      doc.setFont(font, 'bold');
      doc.setTextColor(session.payment_status === 'paid' ? 22 : 107, session.payment_status === 'paid' ? 163 : 114, session.payment_status === 'paid' ? 74 : 128);
      doc.text(
        session.payment_status === 'paid'
          ? txt(t.receipt.statusPaid)
          : txt(`${t.receipt.statusLabel}: ${session.payment_status}`),
        pageW / 2,
        y,
        { align: 'center' }
      );
      y += 14;

      // Amount
      doc.setFontSize(28);
      doc.setFont(font, 'bold');
      doc.setTextColor(26, 26, 26);
      doc.text(pdfAmount(session.amount_total, session.currency), pageW / 2, y, { align: 'center' });
      y += 16;

      // Divider
      doc.setDrawColor(229, 231, 235);
      doc.line(20, y, pageW - 20, y);
      y += 10;

      // Details table. When the fee is known, the receipt itemises it: the
      // payer's accountant needs a line for the 0.49, and it must be clear that
      // the merchant — not HexaBee — is who received it.
      // A fee of zero is not a fee: when the merchant covers it the payer paid
      // the invoice amount and nothing else, so there is no line to itemise.
      const hasFee = session.payer_fee != null && session.payer_fee > 0 && session.invoice_amount != null;
      const rows: [string, string][] = hasFee
        ? [
            [t.receipt.invoiceAmount, pdfAmount(session.invoice_amount!, session.currency)],
            [t.receipt.linkFee, pdfAmount(session.payer_fee!, session.currency)],
            [t.receipt.totalPaid, pdfAmount(session.amount_total, session.currency)],
          ]
        : [[t.receipt.amount, pdfAmount(session.amount_total, session.currency)]];
      rows.push(
        [t.receipt.date, formatDate(session.created, t.locale)],
        [t.receipt.paymentId, `...${session.id.slice(-16)}`],
        [t.receipt.statusLabel, session.payment_status === 'paid' ? t.receipt.paid : session.payment_status],
      );

      if (session.metadata?.reference) rows.push([t.receipt.reference, session.metadata.reference]);
      const merchantName = session.metadata?.receiver ?? session.metadata?.merchant ?? '';
      if (merchantName) {
        rows.push([hasFee ? t.receipt.paidTo : t.receipt.merchant, merchantName]);
        if (session.metadata?.merchant_company_code) {
          rows.push([t.receipt.companyCode, session.metadata.merchant_company_code]);
        }
      }
      if (session.customer_details?.email) rows.push([t.receipt.payerEmail, session.customer_details.email]);
      if (session.customer_details?.name) rows.push([t.receipt.payerName, session.customer_details.name]);

      doc.setFontSize(11);
      for (const [label, value] of rows) {
        doc.setFont(font, 'normal');
        doc.setTextColor(107, 114, 128);
        doc.text(txt(label), 20, y);

        doc.setFont(font, 'bold');
        doc.setTextColor(26, 26, 26);
        // Wrapped against the space actually left after the label column, not a
        // guess — a long merchant name used to run back under its own label.
        const lines = doc.splitTextToSize(txt(value), pageW - 20 - 55);
        doc.text(lines, pageW - 20, y, { align: 'right' });
        y += 7 * lines.length + 2;
      }

      y += 6;
      doc.setDrawColor(229, 231, 235);
      doc.line(20, y, pageW - 20, y);
      y += 10;

      // Footer
      doc.setFontSize(9);
      doc.setTextColor(156, 163, 175);
      doc.setFont(font, 'normal');
      if (hasFee) {
        // The one sentence the payer's accountant is looking for.
        const note = doc.splitTextToSize(
          txt(t.receipt.feeNote.replace('{merchant}', merchantName || t.receipt.theMerchant)),
          pageW - 40
        );
        doc.text(note, pageW / 2, y, { align: 'center' });
        y += 4 * note.length + 3;
      }
      doc.text(txt(t.receipt.automated), pageW / 2, y, { align: 'center' });
      y += 5;
      doc.text('hexabee.buzz', pageW / 2, y, { align: 'center' });

      const filename = `${asciiFold(t.receipt.filename)}-${session.id.slice(-8)}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error('PDF generation failed:', err);
      setReceiptFailed(true);
    } finally {
      setGenerating(false);
    }
  }

  // Three states, decided by the payment and not by the URL: paid, still
  // settling (a bank notification can trail the redirect by a few seconds), or
  // not paid once the wait is over.
  const isPaid = session?.payment_status === 'paid';
  const isPending = !isPaid && settling;
  // No row at all is not a failed payment — it is a link we cannot read.
  const isUnknown = !loading && !session;
  // Reference only — amount_total is what was charged, fee included, and
  // prefilling it would have the fee added a second time on the retry.
  const retryHref = session?.metadata?.merchant_slug
    ? `/pay/${session.metadata.merchant_slug}?r=${encodeURIComponent(session.metadata?.reference ?? '')}`
    : null;

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 16px' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 32px', maxWidth: 460, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)', textAlign: 'center' }}>
        <PayLangToggle />

        {/* Icon */}
        <div style={{ fontSize: 56, marginBottom: 16 }}>{isUnknown ? 'ℹ️' : isPaid ? '✅' : isPending ? '⏳' : '❌'}</div>

        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 8px', color: 'var(--text)' }}>
          {isUnknown ? t.successPage.unavailable : isPaid ? t.successPage.title : isPending ? t.successPage.pendingTitle : t.successPage.failedTitle}
        </h1>
        {!isUnknown && (
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 24px', lineHeight: 1.6 }}>
            {isPaid ? t.successPage.sub : isPending ? t.successPage.pendingSub : t.successPage.failedSub}
          </p>
        )}

        {loading && (
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t.successPage.loadingReceipt}</p>
        )}

        {!loading && session && (
          <>
            {/* Summary */}
            <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '16px 18px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              {session.payer_fee != null && session.payer_fee > 0 && session.invoice_amount != null ? (
                <>
                  <Row label={t.successPage.invoiceAmount} value={formatAmount(session.invoice_amount, session.currency, t.locale)} />
                  <Row label={t.successPage.linkFee} value={formatAmount(session.payer_fee, session.currency, t.locale)} />
                  <Row label={t.successPage.totalPaid} value={formatAmount(session.amount_total, session.currency, t.locale)} />
                </>
              ) : (
                <Row label={t.successPage.amount} value={formatAmount(session.amount_total, session.currency, t.locale)} />
              )}
              <Row label={t.successPage.date} value={formatDate(session.created, t.locale)} />
              <Row label={t.successPage.reference} value={session.metadata?.reference || '—'} />
              <Row
                label={session.payer_fee ? t.successPage.paidTo : t.successPage.merchant}
                value={session.metadata?.receiver || session.metadata?.merchant || '—'}
              />
              <Row
                label={t.successPage.status}
                value={isPaid ? t.successPage.paid : isPending ? t.successPage.pending : t.successPage.notPaid}
                highlight={isPaid}
              />
              {session.payer_fee != null && session.payer_fee > 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  {t.successPage.feeNote}
                </p>
              )}
            </div>

            {/* A receipt exists only for a payment that happened. */}
            {isPaid && (
              <button
                type="button"
                onClick={downloadReceipt}
                disabled={generating}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'var(--brand)',
                  color: '#111',
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: generating ? 'wait' : 'pointer',
                  opacity: generating ? 0.7 : 1,
                }}
              >
                {generating ? t.successPage.generating : t.successPage.download}
              </button>
            )}

            {receiptFailed && (
              <p style={{ margin: '10px 0 0', fontSize: 13, color: '#b45309', lineHeight: 1.5 }}>
                {t.successPage.downloadFailed}
              </p>
            )}

            {!isPaid && !isPending && retryHref && (
              <a
                href={retryHref}
                style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: '14px', borderRadius: 12, background: 'var(--brand)', color: '#111', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}
              >
                {t.successPage.tryAgain}
              </a>
            )}
          </>
        )}


      </div>
    </main>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, gap: 16 }}>
      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, color: highlight ? '#16a34a' : 'var(--text)', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<main style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</main>}>
      <PayLangProvider>
        <PaymentSuccessContent />
      </PayLangProvider>
    </Suspense>
  );
}