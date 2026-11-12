'use client';

import { useEffect, useRef, useState } from 'react';
import { useLang, type Dict } from '../../../i18n';
import { DEFAULT_TEMPLATE } from '@/lib/invoice-email-template';

type Tpl = { id: string; name: string; subject: string; body: string };
type Msg = { ok: boolean; text: (t: Dict) => string };

/**
 * The covering letter, edited where the batch is sent (moved from Settings on
 * 2026-11-12). A school sends monthly invoices and extra-services invoices
 * with different words, and changing the letter in Settings before every batch
 * was the complaint.
 *
 * ⚠️ What goes out is still `invoice_email_subject/body`. This box writes to it
 * by itself a moment after typing stops, and `onDirty` tells the page to hold
 * the send button until that write has landed - otherwise a batch could leave
 * with the previous wording while the screen shows the new one.
 *
 * Saved letters are only a source to copy from; deleting one never touches the
 * letter on screen.
 */
export default function LetterEditor({ onSaved, onDirty }: { onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const { t } = useLang();
  const lang: 'lt' | 'en' = t.locale.startsWith('lt') ? 'lt' : 'en';
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  // The page passes a fresh function every render; a ref keeps that from
  // restarting the save timer while the merchant types.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const [loaded, setLoaded] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [stored, setStored] = useState({ subject: '', body: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [selected, setSelected] = useState('');
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tplMsg, setTplMsg] = useState<Msg | null>(null);

  useEffect(() => {
    fetch('/api/merchant/invoice-template')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const s = d?.subject ?? '', b = d?.body ?? '';
        setSubject(s); setBody(b); setStored({ subject: s, body: b });
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    fetch('/api/merchant/letter-templates')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setTemplates(Array.isArray(d?.templates) ? d.templates : []))
      .catch(() => {});
  }, []);

  const dirty = subject.trim() !== stored.subject.trim() || body.trim() !== stored.body.trim();
  useEffect(() => { onDirty(dirty || saving); }, [dirty, saving, onDirty]);

  // Save a moment after typing stops.
  useEffect(() => {
    if (!loaded || !dirty) return;
    const h = setTimeout(async () => {
      setSaving(true);
      try {
        const res = await fetch('/api/merchant/invoice-template', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, body }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setStored({ subject, body });
        setMsg({ ok: true, text: tt => tt.letterEd.saved });
        onSavedRef.current();
      } catch (err) {
        console.error('[letter] save failed', String(err));
        setMsg({ ok: false, text: tt => tt.letterEd.failed });
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => clearTimeout(h);
  }, [subject, body, dirty, loaded]);

  async function putTemplates(next: Tpl[]): Promise<boolean> {
    try {
      const res = await fetch('/api/merchant/letter-templates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setTemplates(next);
      return true;
    } catch (err) {
      console.error('[letter] templates save failed', String(err));
      setTplMsg({ ok: false, text: tt => tt.letterEd.templatesFailed });
      return false;
    }
  }

  function pick(id: string) {
    setSelected(id); setConfirmDelete(false); setTplMsg(null);
    const tpl = templates.find(x => x.id === id);
    if (tpl) { setSubject(tpl.subject); setBody(tpl.body); }
  }

  async function saveAsNew() {
    const name = newName.trim();
    if (!name) return;
    if (templates.some(x => x.name.toLowerCase() === name.toLowerCase())) {
      setTplMsg({ ok: false, text: tt => tt.letterEd.nameTaken }); return;
    }
    const tpl = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, subject: subject.trim(), body: body.trim() };
    if (await putTemplates([...templates, tpl])) { setSelected(tpl.id); setNaming(false); setNewName(''); }
  }

  async function updateSelected() {
    await putTemplates(templates.map(x => x.id === selected ? { ...x, subject: subject.trim(), body: body.trim() } : x));
  }

  async function removeSelected() {
    if (await putTemplates(templates.filter(x => x.id !== selected))) { setSelected(''); setConfirmDelete(false); }
  }

  function applyFormat(kind: 'bold' | 'bullet' | 'number') {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    let next: string, caret: number;
    if (kind === 'bold') {
      const inner = body.slice(start, end);
      next = body.slice(0, start) + '**' + inner + '**' + body.slice(end);
      caret = start + 2 + inner.length;
    } else {
      const ls = body.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const le = body.indexOf('\n', end) === -1 ? body.length : body.indexOf('\n', end);
      const marked = body.slice(ls, le).split('\n').map((ln, i) => (kind === 'bullet' ? `- ${ln}` : `${i + 1}. ${ln}`)).join('\n');
      next = body.slice(0, ls) + marked + body.slice(le);
      caret = ls + marked.length;
    }
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
  }

  if (!loaded) return null;
  const current = templates.find(x => x.id === selected);
  const differsFromTpl = current && (current.subject !== subject.trim() || current.body !== body.trim());

  return (
    <div className="hb-subsection">
      <p className="hb-subsection-label">{t.letterEd.title}</p>
      <p className="hb-card-sub">{t.letterEd.sub}</p>

      {templates.length > 0 && (
        <>
          <label className="hb-label" htmlFor="letter-tpl">{t.letterEd.template}</label>
          <select id="letter-tpl" className="hb-input" value={selected} onChange={e => pick(e.target.value)}>
            <option value="">{t.letterEd.pick}</option>
            {templates.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </>
      )}

      <label className="hb-label" htmlFor="letter-subject">{t.settings.letterSubject}</label>
      <input id="letter-subject" className="hb-input" value={subject} maxLength={300}
             placeholder={DEFAULT_TEMPLATE[lang].subject}
             onChange={e => setSubject(e.target.value)} />

      <label className="hb-label" htmlFor="letter-body">{t.settings.letterBody}</label>
      <div style={{ display: 'flex', gap: 6, margin: '0 0 6px' }}>
        <button type="button" className="hb-btn sm" onClick={() => applyFormat('bold')} title={t.settings.fmtBoldTitle} style={{ fontWeight: 800 }}>B</button>
        <button type="button" className="hb-btn sm" onClick={() => applyFormat('bullet')} title={t.settings.fmtBulletTitle}>• {t.settings.fmtBullet}</button>
        <button type="button" className="hb-btn sm" onClick={() => applyFormat('number')} title={t.settings.fmtNumberTitle}>1. {t.settings.fmtNumber}</button>
      </div>
      <textarea ref={bodyRef} id="letter-body" className="hb-input" rows={8} value={body} maxLength={20000}
                placeholder={DEFAULT_TEMPLATE[lang].body}
                onChange={e => setBody(e.target.value)}
                style={{ resize: 'vertical', fontFamily: 'inherit' }} />

      <p className={`hb-msg ${msg && !msg.ok ? 'err' : 'ok'}`} style={{ minHeight: '1.2em' }}>
        {saving || dirty ? t.letterEd.saving : msg ? msg.text(t) : ''}
      </p>

      <details style={{ margin: '4px 0 10px' }}>
        <summary className="hb-note" style={{ cursor: 'pointer' }}>{t.letterEd.tokens}</summary>
        <p className="hb-note">
          <code>{'{name}'}</code> {t.settings.letterTokenName}, <code>{'{invoice}'}</code> {t.settings.letterTokenInvoice},{' '}
          <code>{'{amount}'}</code> {t.settings.letterTokenAmount}, <code>{'{due}'}</code> {t.settings.letterTokenDue},{' '}
          <code>{'{breakdown}'}</code> {t.settings.letterTokenBreakdown}, <code>{'{prev_month}'}</code> {t.settings.letterTokenPrevMonth},{' '}
          <code>{'{month}'}</code> {t.settings.letterTokenMonth}, <code>{'{year}'}</code> {t.settings.letterTokenYear}.
        </p>
        <p className="hb-note">{t.settings.letterMonthHint}</p>
        <p className="hb-note">{t.settings.letterFormatHint}</p>
        <p className="hb-note">{t.settings.letterWeAdd}</p>
      </details>

      <div className="hb-actions" style={{ flexWrap: 'wrap' }}>
        {current && differsFromTpl && (
          <button type="button" className="hb-btn sm primary" onClick={() => void updateSelected()}>{t.letterEd.update(current.name)}</button>
        )}
        {!naming && (
          <button type="button" className="hb-btn sm" onClick={() => { setNaming(true); setTplMsg(null); }}>{t.letterEd.saveAs}</button>
        )}
        {current && !confirmDelete && (
          <button type="button" className="hb-btn sm" onClick={() => setConfirmDelete(true)}>{t.letterEd.remove}</button>
        )}
      </div>

      {naming && (
        <div style={{ marginTop: 8 }}>
          <label className="hb-label" htmlFor="letter-name">{t.letterEd.nameLabel}</label>
          <input id="letter-name" className="hb-input" value={newName} maxLength={80} autoFocus
                 onChange={e => setNewName(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') void saveAsNew(); }} />
          <div className="hb-actions">
            <button type="button" className="hb-btn sm primary" disabled={!newName.trim()} onClick={() => void saveAsNew()}>{t.letterEd.nameSave}</button>
            <button type="button" className="hb-btn sm" onClick={() => { setNaming(false); setNewName(''); }}>{t.letterEd.cancel}</button>
          </div>
        </div>
      )}

      {current && confirmDelete && (
        <div style={{ marginTop: 8 }}>
          <p className="hb-alert-text">{t.letterEd.removeConfirm(current.name)}</p>
          <div className="hb-actions">
            <button type="button" className="hb-btn sm" onClick={() => void removeSelected()}>{t.letterEd.removeYes}</button>
            <button type="button" className="hb-btn sm" onClick={() => setConfirmDelete(false)}>{t.letterEd.cancel}</button>
          </div>
        </div>
      )}
      {tplMsg && <p className={`hb-msg ${tplMsg.ok ? 'ok' : 'err'}`}>{tplMsg.text(t)}</p>}
    </div>
  );
}
