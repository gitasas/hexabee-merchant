'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { CHECKOUT_URL } from '@/lib/checkout-url';
import { useLang, type Dict } from '../../../../i18n';
import {
  SMS_DEFAULT_TEMPLATE, SMS_PRICE_PER_SEGMENT, renderSmsTemplate,
  smsSampleVars, smsSegments,
} from '@/lib/sms-template';

type Msg = (t: Dict) => string;

/**
 * What the customer receives: the covering letter, and the text message for
 * customers who have no email address.
 *
 * The Tele2 credentials are NOT here - they are a one-time connection and
 * live under Connections with the bank keys. What is here is a status line
 * saying whether sending works, because a message editor that cannot tell you
 * the channel is switched off is worse than no editor: you would write the
 * text, save it, and find out nothing sends.
 */
export default function SendingSettingsPage() {
  const { t } = useLang();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [slug, setSlug] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [attachPdf, setAttachPdf] = useState(false);
  const [keepPdf, setKeepPdf] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplMsg, setTplMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [tplLoaded, setTplLoaded] = useState(false);
  // What is actually stored, so the save button can be plain until something
  // differs from it - the colour rule the rest of Settings follows.
  const [tplSaved, setTplSaved] = useState({ replyTo: '', attachPdf: false, keepPdf: false });

  const [smsHasToken, setSmsHasToken] = useState(false);
  const [smsTemplate, setSmsTemplate] = useState('');
  const [smsSaved, setSmsSaved] = useState('');
  const [smsMsgSaving, setSmsMsgSaving] = useState(false);
  const [smsMsg, setSmsMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [smsServerCost, setSmsServerCost] = useState<{ segments: number; encoding: string; chars: number; limit: number } | null>(null);
  const [smsServerRendered, setSmsServerRendered] = useState<string | null>(null);

  const [template, setTemplate] = useState<{ filename: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => (r.ok ? r.json() : null))
      .then(p => { if (p) { setSlug(p.slug ?? null); setTemplate(p.template ?? null); } })
      .catch(() => null);

    fetch('/api/merchant/invoice-template')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d) {
          setAttachPdf(d.attachPdf === true);
          setKeepPdf(d.keepPdf === true);
          setReplyTo(d.replyTo ?? '');
          setAccountEmail(d.accountEmail ?? '');
          setTplSaved({ replyTo: d.replyTo ?? '', attachPdf: d.attachPdf === true, keepPdf: d.keepPdf === true });
        }
        setTplLoaded(true);
      })
      .catch(() => setTplLoaded(true));

    fetch('/api/merchant/sms-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setSmsHasToken(d.hasToken === true);
        setSmsTemplate(d.template ?? '');
        setSmsSaved(d.template ?? '');
      })
      .catch(() => { /* the letter half works without it */ });
  }, []);

  const smsRendered = useMemo(() => {
    const lang: 'lt' | 'en' = t.locale.startsWith('lt') ? 'lt' : 'en';
    const text = smsTemplate.trim() || SMS_DEFAULT_TEMPLATE[lang];
    return renderSmsTemplate(text, smsSampleVars(slug ?? undefined, CHECKOUT_URL));
  }, [smsTemplate, t.locale, slug]);
  const smsCost = useMemo(() => smsSegments(smsRendered), [smsRendered]);

  // Ask the backend what it makes of the same template, once typing settles.
  // Its figure wins: the browser prices an invented invoice number, while the
  // backend prices the merchant's own next one - and one Lithuanian letter in
  // that number doubles the price.
  useEffect(() => {
    const handle = setTimeout(() => {
      fetch('/api/merchant/sms/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: smsTemplate }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          setSmsServerCost(d?.cost ? { segments: d.cost.segments, encoding: d.cost.encoding, chars: d.cost.chars, limit: d.cost.limit } : null);
          setSmsServerRendered(typeof d?.rendered === 'string' ? d.rendered : null);
        })
        .catch(() => { setSmsServerCost(null); setSmsServerRendered(null); });
    }, 600);
    return () => clearTimeout(handle);
  }, [smsTemplate]);

  async function saveTemplate() {
    if (tplSaving) return;
    setTplSaving(true);
    setTplMsg(null);
    try {
      const res = await fetch('/api/merchant/invoice-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachPdf, keepPdf, replyTo }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setReplyTo(data.replyTo ?? '');
        setTplSaved({ replyTo: data.replyTo ?? '', attachPdf, keepPdf });
        setTplMsg({ ok: true, text: (tt: Dict) => tt.common.saved });
      } else {
        setTplMsg({
          ok: false,
          text: data.error === 'invalid_reply_to'
            ? (tt: Dict) => tt.settings.replyToInvalid
            : (tt: Dict) => tt.settings.letterSaveFailed,
        });
      }
    } catch {
      setTplMsg({ ok: false, text: (tt: Dict) => tt.settings.letterSaveFailed });
    } finally {
      setTplSaving(false);
    }
  }

  async function saveSmsMessage() {
    if (smsMsgSaving) return;
    setSmsMsgSaving(true);
    setSmsMsg(null);
    try {
      const res = await fetch('/api/merchant/sms-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: smsTemplate }),
      });
      if (res.ok) {
        setSmsSaved(smsTemplate);
        setSmsMsg({ ok: true, text: (tt: Dict) => tt.common.saved });
      } else {
        const data = await res.json().catch(() => ({}));
        const code = String(data?.error || '');
        setSmsMsg({
          ok: false,
          text: code === 'template_needs_link'
            ? (tt: Dict) => tt.settings.smsNeedsLink
            : code === 'template_too_long'
              ? (tt: Dict) => tt.settings.smsTooLong
              : res.status === 403
                ? (tt: Dict) => tt.settings.ownerOnlyNote
                : (tt: Dict) => tt.settings.smsSaveFailed,
        });
      }
    } catch {
      setSmsMsg({ ok: false, text: (tt: Dict) => tt.settings.smsSaveFailed });
    } finally {
      setSmsMsgSaving(false);
    }
  }

  async function handleTemplateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const res = await fetch('/api/merchant/template', { method: 'POST', body: fd });
      if (res.ok) {
        setUploadMsg({ ok: true, text: (tt: Dict) => tt.settings.templateSaved(file.name) });
        setTemplate({ filename: file.name });
      } else {
        setUploadMsg({ ok: false, text: (tt: Dict) => tt.settings.templateFailed });
      }
    } catch {
      setUploadMsg({ ok: false, text: (tt: Dict) => tt.settings.uploadFailed });
    } finally {
      setUploading(false);
    }
  }

  if (!tplLoaded) return <p className="hb-skeleton">{t.common.loading}</p>;

  const shown = smsServerCost ?? smsCost;
  const authoritative = smsServerCost !== null;
  const smsDirty = smsTemplate !== smsSaved;
  const tplDirty =
    replyTo !== tplSaved.replyTo ||
    attachPdf !== tplSaved.attachPdf ||
    keepPdf !== tplSaved.keepPdf;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.settings.navSending}</h1>
          {/* The page holds the letter, the text message and the sample
              invoice, so its subtitle describes the page - `letterSub`
              describes only the letter and stays on that card. */}
          <p className="hb-sub">{t.settings.sendingPageSub}</p>
        </div>
      </div>

      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.sendOptions}</h2>
        <p className="hb-card-sub">{t.settings.sendOptionsSub}</p>

        {/* The letter text moved to the Invoices page (2026-11-12), next to the
            send button, with saved letters to pick from. What stays here applies
            to every send, whichever letter is used. */}
        <p className="hb-note" style={{ marginBottom: 16 }}>
          {t.settings.letterMoved}{' '}
          <a href="/merchant/invoices" style={{ textDecoration: 'underline' }}>{t.settings.letterMovedLink}</a>
        </p>

        <div className="hb-subsection">
          <p className="hb-subsection-label">{t.settings.replyTo}</p>
          <p className="hb-card-sub">{t.settings.replyToSub}</p>
          <input
            className="hb-input"
            type="email"
            value={replyTo}
            placeholder={accountEmail}
            onChange={e => { setReplyTo(e.target.value); setTplMsg(null); }}
          />
        </div>

        <div className="hb-subsection">
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={attachPdf} onChange={e => { setAttachPdf(e.target.checked); setTplMsg(null); }} style={{ marginTop: 3 }} />
            <span>
              <span className="hb-subsection-label">{t.settings.attachPdf}</span>
              <span className="hb-card-sub" style={{ display: 'block' }}>{t.settings.attachPdfSub}</span>
            </span>
          </label>
        </div>

        {/* Off unless ticked, and it has to stay that way: we have told a
            merchant in writing that we do not keep their invoices, so the
            answer for anyone who never saw this box must be no. */}
        <div className="hb-subsection">
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={keepPdf} onChange={e => { setKeepPdf(e.target.checked); setTplMsg(null); }} style={{ marginTop: 3 }} />
            <span>
              <span className="hb-subsection-label">{t.settings.keepPdf}</span>
              <span className="hb-card-sub" style={{ display: 'block' }}>{t.settings.keepPdfSub}</span>
            </span>
          </label>
        </div>

        <div className="hb-actions">
          <button type="button" className={`hb-btn${tplDirty ? ' primary' : ''}`} onClick={saveTemplate} disabled={tplSaving}>
            {/* Named, not "Save settings": this page has a second save right
                below it for the text message, and a generic label next to a
                specific one is the old three-identical-buttons problem in
                miniature. */}
            {tplSaving ? t.settings.saving : t.settings.saveSendOptions}
          </button>
        </div>
        {tplMsg && <p className={`hb-msg ${tplMsg.ok ? 'ok' : 'err'}`}>{tplMsg.text(t)}</p>}
      </div>

      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.sms}</h2>
        <p className="hb-card-sub">{t.settings.smsSub}</p>

        {/* The channel's own state, left behind when the credentials moved to
            Connections. Without it this editor would happily take a message
            for a channel that is switched off. */}
        {!smsHasToken && (
          <p className="hb-msg err">
            {t.settings.smsNotSetUp}{' '}
            <a href="/merchant/settings/connections" style={{ textDecoration: 'underline' }}>
              {t.settings.navConnections}
            </a>.
          </p>
        )}

        <label className="hb-label" htmlFor="sms-template">{t.settings.smsTemplate}</label>
        <textarea
          id="sms-template"
          className="hb-input"
          rows={3}
          value={smsTemplate}
          maxLength={480}
          placeholder={SMS_DEFAULT_TEMPLATE[t.locale.startsWith('lt') ? 'lt' : 'en']}
          onChange={e => { setSmsTemplate(e.target.value); setSmsMsg(null); }}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
        <p className="hb-note">
          {t.settings.letterTokens}{' '}
          <code>{'{link}'}</code> {t.settings.smsTokenLink},{' '}
          <code>{'{invoice}'}</code> {t.settings.letterTokenInvoice},{' '}
          <code>{'{amount}'}</code> {t.settings.letterTokenAmount},{' '}
          <code>{'{name}'}</code> {t.settings.letterTokenName},{' '}
          <code>{'{due}'}</code> {t.settings.letterTokenDue}.
        </p>

        {/* ⚠️ Shown as a price, not a character count: one Lithuanian letter
            moves the message from 160 characters a segment to 70, and nobody
            reads "UCS-2" and thinks about money. */}
        <div className="hb-subsection">
          <p className="hb-subsection-label">{t.settings.smsCost}</p>
          <p className="hb-card-sub" style={{ wordBreak: 'break-all' }}>{smsServerRendered ?? smsRendered}</p>
          <p className="hb-card-sub">
            {shown.chars} {t.settings.smsChars}
            {' · '}
            {shown.encoding === 'unicode' ? t.settings.smsUnicode : t.settings.smsLatin}
            {' · '}
            <strong>{t.settings.smsSegmentCount(shown.segments)}</strong>
            {' · ~'}
            {(shown.segments * SMS_PRICE_PER_SEGMENT).toFixed(3)} EUR
          </p>
          {shown.encoding === 'unicode' && <p className="hb-msg err">{t.settings.smsDiacriticWarning}</p>}
          {smsCost.overLimit && <p className="hb-msg err">{t.settings.smsTooLong}</p>}
          {authoritative && smsServerCost!.segments !== smsCost.segments && (
            <p className="hb-note">{t.settings.smsCostFromSender}</p>
          )}
        </div>

        <div className="hb-actions">
          <button type="button" className={`hb-btn${smsDirty ? ' primary' : ''}`} onClick={saveSmsMessage} disabled={smsMsgSaving}>
            {smsMsgSaving ? t.settings.saving : t.settings.smsSaveMessage}
          </button>
        </div>
        {smsMsg && <p className={`hb-msg ${smsMsg.ok ? 'ok' : 'err'}`}>{smsMsg.text(t)}</p>}
      </div>

      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.invoiceTemplate}</h2>
        <p className="hb-card-sub">{t.settings.invoiceTemplateSub}</p>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleTemplateUpload} />
        <div className="hb-actions">
          <button type="button" className="hb-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? t.settings.uploading : t.settings.uploadSample}
          </button>
        </div>
        {template && <p className="hb-note">{t.settings.currentTemplate} <strong>{template.filename}</strong></p>}
        {uploadMsg && <p className={`hb-msg ${uploadMsg.ok ? 'ok' : 'err'}`}>{uploadMsg.text(t)}</p>}
      </div>
    </>
  );
}
