'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { CHECKOUT_URL } from '@/lib/checkout-url';
import { useLang, type Dict } from '../../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';

type Msg = (t: Dict) => string;

// Inbound (BCC) domain - Resend-managed *.resend.app address; switch to a
// custom receiving domain via env. Must match INBOUND_DOMAIN on the Python
// backend, and a hardcoded address here would be a dead one.
const INBOUND_DOMAIN = process.env.NEXT_PUBLIC_INBOUND_DOMAIN || 'in.hexabee.buzz';

/**
 * Everything the merchant copies out of HexaBee or prints: the pay link, the
 * QR for an invoice, the mail-merge template, the BCC address, and the
 * counter.
 *
 * They are one section because they are one job - "give me the thing I paste
 * somewhere else" - even though they end up in four different places. The
 * counter fee threshold lives here too, with the counter it applies to, and
 * not beside the fee toggle where it would read as a qualification of it.
 */
export default function LinksSettingsPage() {
  const router = useRouter();
  const { t } = useLang();

  const [ready, setReady] = useState(false);
  const [slug, setSlug] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [feeMode, setFeeMode] = useState<'merchant' | 'payer'>('merchant');
  const [canTakePayment, setCanTakePayment] = useState(false);

  const [copied, setCopied] = useState(false);
  const [copiedTap, setCopiedTap] = useState(false);
  const [copiedPos, setCopiedPos] = useState(false);
  const [mmCopied, setMmCopied] = useState(false);
  const [bccCopied, setBccCopied] = useState(false);

  const [invoiceQr, setInvoiceQr] = useState<string | null>(null);
  const [invoiceQrMsg, setInvoiceQrMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const [posFeeMax, setPosFeeMax] = useState('');
  const [posFeeMaxStored, setPosFeeMaxStored] = useState('');
  const [posFeeMaxSaving, setPosFeeMaxSaving] = useState(false);
  const [posFeeMaxMsg, setPosFeeMaxMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (!isOnboardingComplete(data)) { router.push('/merchant/onboarding'); return; }
        setSlug(data.slug ?? '');
        setBusinessName(data.business_name ?? '');
        setFeeMode(data.fee_mode === 'payer' ? 'payer' : 'merchant');
        const stored = data.pos_fee_payer_max != null ? String(data.pos_fee_payer_max) : '';
        setPosFeeMax(stored);
        setPosFeeMaxStored(stored);
        // The counter follows the merchant's rail, so the question is whether
        // they can take a payment at all - not whether they have Stripe.
        const isMontonio = data.payment_rail === 'montonio';
        if (isMontonio) {
          setCanTakePayment(data.montonio_configured === true);
          setReady(true);
        } else {
          const id = process.env.NEXT_PUBLIC_STRIPE_ENV === 'live' ? data.stripe_account_id_live : data.stripe_account_id;
          if (!id) { setCanTakePayment(false); setReady(true); return; }
          fetch(`/api/connect/status?accountId=${encodeURIComponent(id)}`)
            .then(r => r.json())
            .then(s => setCanTakePayment(s.ok && s.chargesEnabled))
            .catch(() => setCanTakePayment(false))
            .finally(() => setReady(true));
        }
      });
  }, [router]);

  const paymentLink = slug ? `${CHECKOUT_URL}/pay/${slug}` : null;
  const posLink = slug ? `${CHECKOUT_URL}/pay/${slug}?mode=pos` : null;
  // Where a printed NFC sticker or a counter QR points. Static on purpose: the
  // amount lives in the till's request, not in the tag, so one sticker lasts
  // for ever and never has to be re-programmed.
  const tapLink = slug ? `${CHECKOUT_URL}/tap/${slug}` : null;
  const mailMergeLink = paymentLink ? `${paymentLink}?a={AMOUNT}&r={INVOICE_NO}` : null;
  const bccAddress = slug ? `${slug}@${INBOUND_DOMAIN}` : '';

  useEffect(() => {
    if (!paymentLink) { setInvoiceQr(null); return; }
    let cancelled = false;
    QRCode.toDataURL(paymentLink, { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then(url => { if (!cancelled) setInvoiceQr(url); })
      .catch(err => console.error('invoice QR failed', err));
    return () => { cancelled = true; };
  }, [paymentLink]);

  async function copyText(value: string, mark: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(value);
      mark(true);
      setTimeout(() => mark(false), 2000);
    } catch {
      // Clipboard refused (insecure context, or the browser said no) - the
      // value is on screen and can be copied by hand.
    }
  }

  async function copyInvoiceQr() {
    if (!invoiceQr) return;
    try {
      const blob = await (await fetch(invoiceQr)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setInvoiceQrMsg({ ok: true, text: tt => tt.settings.copyQrImageDone });
    } catch {
      setInvoiceQrMsg({ ok: false, text: tt => tt.settings.copyQrImageFail });
    }
    setTimeout(() => setInvoiceQrMsg(null), 3000);
  }

  function downloadDataUrl(dataUrl: string) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `hexabee-qr-${slug}.png`;
    a.click();
  }

  async function handlePosFeeMaxSave() {
    if (posFeeMaxSaving) return;
    const raw = posFeeMax.trim().replace(',', '.');
    if (raw !== '' && !(Number.isFinite(Number(raw)) && Number(raw) > 0)) {
      setPosFeeMaxMsg({ ok: false, text: tt => tt.settings.posFeeMaxInvalid });
      return;
    }
    setPosFeeMaxSaving(true);
    setPosFeeMaxMsg(null);
    try {
      const res = await fetch('/api/merchant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // '' clears the threshold; a number sets it. Sent as posFeePayerMax so
        // the route can tell "not mentioned" from "cleared".
        body: JSON.stringify({ posFeePayerMax: raw === '' ? '' : Number(raw) }),
      });
      if (res.ok) {
        setPosFeeMaxStored(raw);
        setPosFeeMaxMsg({ ok: true, text: tt => tt.common.saved });
      } else {
        setPosFeeMaxMsg({ ok: false, text: tt => tt.common.saveFailed });
      }
    } catch {
      setPosFeeMaxMsg({ ok: false, text: tt => tt.common.saveFailed });
    } finally {
      setPosFeeMaxSaving(false);
    }
  }

  async function handleGenerateQr() {
    if (!tapLink || !businessName) return;
    setQrLoading(true);
    try {
      // ⚠️ `tapLink`, never `posLink`. What this composes is a customer-facing
      // poster, so it must encode the page a customer should land on. `posLink`
      // is the till's own amount-entry screen, and it is public: stuck on a
      // table it invited the customer to type their own amount.
      const raw = await QRCode.toDataURL(tapLink, { width: 400, margin: 2, color: { dark: '#111111', light: '#ffffff' } });

      const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = raw;
      });

      const logoImg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = '/hexabee-logo.svg';
      });

      const W = 500, LOGO_H = 72, QR_SIZE = 380, PADDING = 28, NAME_H = 40, URL_H = 28;
      const H = PADDING + LOGO_H + 16 + QR_SIZE + 16 + NAME_H + 8 + URL_H + PADDING;

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = '#fffdf8';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#f1e3b6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(4, 4, W - 8, H - 8, 20);
      ctx.stroke();

      let y = PADDING;
      if (logoImg) {
        const logoW = (logoImg.width / logoImg.height) * LOGO_H;
        ctx.drawImage(logoImg, (W - logoW) / 2, y, logoW, LOGO_H);
      } else {
        ctx.font = 'bold 28px Arial';
        ctx.fillStyle = '#111111';
        ctx.textAlign = 'center';
        ctx.fillText('⬢ HexaBee', W / 2, y + LOGO_H / 2 + 10);
      }
      y += LOGO_H + 16;

      const qrX = (W - QR_SIZE) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(qrX - 6, y - 6, QR_SIZE + 12, QR_SIZE + 12, 12);
      ctx.fill();
      ctx.drawImage(qrImg, qrX, y, QR_SIZE, QR_SIZE);
      y += QR_SIZE + 16;

      ctx.font = 'bold 22px Arial';
      ctx.fillStyle = '#111111';
      ctx.textAlign = 'center';
      ctx.fillText(businessName, W / 2, y + 26);
      y += NAME_H + 8;

      ctx.font = 'bold 13px Arial';
      ctx.fillStyle = '#7a5b00';
      ctx.fillText(t.settings.qrScanToPay, W / 2, y + 16);
      ctx.font = '11px Arial';
      ctx.fillStyle = '#a78a3a';
      ctx.fillText('Powered by hexabee.buzz', W / 2, y + 32);

      setQrDataUrl(canvas.toDataURL('image/png'));
    } catch (err) {
      console.error('QR generation failed', err);
    } finally {
      setQrLoading(false);
    }
  }

  if (!ready) return <p className="hb-skeleton">{t.common.loading}</p>;

  const posFeeDirty = posFeeMax.trim().replace(',', '.') !== posFeeMaxStored;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.settings.navLinks}</h1>
          <p className="hb-sub">{t.settings.linksPageSub}</p>
        </div>
      </div>

      {paymentLink && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.yourPaymentLink}</h2>
          <p className="hb-card-sub">{t.settings.yourPaymentLinkSub}</p>
          <p className="hb-urlbox">{paymentLink}</p>
          <div className="hb-actions">
            <button type="button" className={`hb-btn sm${copied ? ' ok' : ''}`} onClick={() => copyText(paymentLink, setCopied)}>
              {copied ? t.common.copied : t.settings.copyLink}
            </button>
            <button type="button" className="hb-btn sm" onClick={() => window.open(paymentLink, '_blank')}>{t.settings.preview}</button>
          </div>

          {/* The same link as a QR, for invoices and emails - "clients are wary
              of clicking links" (Apskaitų grupė, 2026-09-17) */}
          <div className="hb-subsection">
            <p className="hb-subsection-label">{t.settings.invoiceQr}</p>
            <p className="hb-card-sub">{t.settings.invoiceQrSub}</p>
            {invoiceQr && (
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={invoiceQr} alt="QR" width={160} height={160} style={{ borderRadius: 12, border: '1px solid var(--border)', background: '#fff' }} />
                <div className="hb-actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <button type="button" className={`hb-btn sm${invoiceQrMsg?.ok ? ' ok' : ''}`} onClick={copyInvoiceQr}>{t.settings.copyQrImage}</button>
                  <button type="button" className="hb-btn sm" onClick={() => invoiceQr && downloadDataUrl(invoiceQr)}>{t.settings.downloadQrImage}</button>
                  {invoiceQrMsg && <p className="hb-note" style={{ margin: 0 }}>{invoiceQrMsg.text(t)}</p>}
                </div>
              </div>
            )}
          </div>

          <div className="hb-subsection">
            <p className="hb-subsection-label">{t.settings.bulkInvoicing}</p>
            <p className="hb-card-sub">{t.settings.bulkInvoicingSub}</p>
            <p className="hb-urlbox">{mailMergeLink}</p>
            <div className="hb-actions">
              <button type="button" className={`hb-btn sm${mmCopied ? ' ok' : ''}`} onClick={() => mailMergeLink && copyText(mailMergeLink, setMmCopied)}>
                {mmCopied ? t.common.copied : t.settings.copyTemplateLink}
              </button>
            </div>
            <p className="hb-note">
              {t.settings.mailMergeNotePrefix}{' '}
              <code>{'{AMOUNT}'}</code> {t.settings.mailMergeNoteMiddle} <code>{'{INVOICE_NO}'}</code>{' '}
              {t.settings.mailMergeNoteSuffix}
            </p>
          </div>

          <div className="hb-subsection">
            <p className="hb-subsection-label">{t.settings.invoiceInbox}</p>
            <p className="hb-card-sub">{t.settings.invoiceInboxSub}</p>
            <p className="hb-urlbox">{bccAddress}</p>
            <div className="hb-actions">
              <button type="button" className={`hb-btn sm${bccCopied ? ' ok' : ''}`} onClick={() => copyText(bccAddress, setBccCopied)}>
                {bccCopied ? t.common.copied : t.settings.copyBcc}
              </button>
            </div>
            <p className="hb-note">
              {t.settings.bccNotePrefix}{' '}
              <a href="/merchant/invoices" style={{ textDecoration: 'underline' }}>{t.settings.bccNoteLink}</a>.
            </p>
          </div>
        </div>
      )}

      {posLink && canTakePayment && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.inPerson}</h2>
          <p className="hb-card-sub">{t.settings.inPersonSub}</p>

          {/* ⚠️ The till link comes FIRST and the threshold after it, because
              `.hb-subsection` separates itself from what is above with a
              border and a top margin and adds nothing below. With the
              threshold first, this URL box sat flush against it with exactly
              0px of air. Anything following a subsection has to be a
              subsection too, or lead the card. */}
          <p className="hb-urlbox">{posLink}</p>
          <div className="hb-actions">
            <button type="button" className="hb-btn" onClick={() => posLink && copyText(posLink, setCopiedPos)}>
              {copiedPos ? t.common.copied : t.settings.copyLink}
            </button>
          </div>

          {/* Shown only when the payer covers the fee: with the merchant
              covering it there is nothing for a threshold to switch over. */}
          {feeMode === 'payer' && (
            <div className="hb-subsection">
              <p className="hb-subsection-label">{t.settings.posFeeMax}</p>
              <p className="hb-card-sub">{t.settings.posFeeMaxSub}</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="hb-input"
                  style={{ maxWidth: 160 }}
                  inputMode="decimal"
                  placeholder={t.settings.posFeeMaxPlaceholder}
                  value={posFeeMax}
                  onChange={e => { setPosFeeMax(e.target.value); setPosFeeMaxMsg(null); }}
                />
                <button type="button" className={`hb-btn sm${posFeeDirty ? ' primary' : ''}`} onClick={handlePosFeeMaxSave} disabled={posFeeMaxSaving}>
                  {posFeeMaxSaving ? t.settings.saving : t.settings.saveSettings}
                </button>
              </div>
              {posFeeMaxStored !== '' && <p className="hb-note">{t.settings.posFeeMaxNote(posFeeMaxStored)}</p>}
              {posFeeMaxMsg && <p className={`hb-msg ${posFeeMaxMsg.ok ? 'ok' : 'err'}`}>{posFeeMaxMsg.text(t)}</p>}
            </div>
          )}

          <div className="hb-subsection">
            <p className="hb-subsection-label">{t.settings.tapLink}</p>
            <p className="hb-card-sub">{t.settings.tapLinkSub}</p>
            <p className="hb-urlbox">{tapLink}</p>
            <div className="hb-actions">
              <button type="button" className="hb-btn" onClick={() => tapLink && copyText(tapLink, setCopiedTap)}>
                {copiedTap ? t.common.copied : t.settings.copyLink}
              </button>
            </div>
          </div>

          <div className="hb-actions" style={{ marginTop: 16 }}>
            <button type="button" className="hb-btn" onClick={handleGenerateQr} disabled={qrLoading}>
              {qrLoading ? t.settings.generating : t.settings.generateQr}
            </button>
            {qrDataUrl && (
              <button type="button" className="hb-btn" onClick={() => qrDataUrl && downloadDataUrl(qrDataUrl)}>
                {t.settings.downloadQr}
              </button>
            )}
          </div>

          {qrDataUrl && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt={t.settings.qrAlt} style={{ width: 200, height: 200, borderRadius: 12, border: '1px solid var(--border)' }} />
            </div>
          )}

          <p className="hb-note">{t.settings.qrNote}</p>
        </div>
      )}
    </>
  );
}
