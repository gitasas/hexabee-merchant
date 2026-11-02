'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang, type Dict } from '../../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';

type Msg = (t: Dict) => string;

/** Mirrors `/api/plugin/merchant-invoice-settings`. Nothing here is a secret. */
type Letterhead = {
  invoice_address: string | null;
  invoice_bank_name: string | null;
  is_vat_payer: boolean | null;
  invoice_vat_code: string | null;
  invoice_vat_rate: number | null;
  invoice_amounts_include_vat: boolean | null;
  invoice_number_prefix: string | null;
  invoice_number_format: string | null;
  invoice_seq_period: string | null;
  invoice_next_seq: number | null;
  blockers: string[];
};

/** A three-state answer as a <select> value. ⚠️ '' is "not answered", which is
 *  a different fact from "no" and must survive a round trip. */
const triState = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');
const fromTri = (v: string): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);

const COUNTRIES = [
  // Only where HexaBee can actually take a payment today. The UK runs on Stripe;
  // the rest are Montonio's payment-initiation countries. Offering anywhere else
  // sells a merchant a setup that ends in a checkout with no working method.
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  { code: 'LT', name: 'Lithuania',      flag: '🇱🇹', currency: 'EUR' },
  { code: 'LV', name: 'Latvia',         flag: '🇱🇻', currency: 'EUR' },
  { code: 'EE', name: 'Estonia',        flag: '🇪🇪', currency: 'EUR' },
  { code: 'FI', name: 'Finland',        flag: '🇫🇮', currency: 'EUR' },
  { code: 'PL', name: 'Poland',         flag: '🇵🇱', currency: 'PLN' },
];

/**
 * The saved country may predate the list above. Keep it selectable rather than
 * letting the <select> fall back to the first option, which would silently move
 * the merchant to the UK the next time they pressed save.
 */
function countryOptions(current?: string | null) {
  if (current && !COUNTRIES.some(c => c.code === current)) {
    return [...COUNTRIES, { code: current, name: current, flag: '\u{1F3F3}', currency: 'EUR' }];
  }
  return COUNTRIES;
}

type Profile = {
  email: string;
  role?: 'owner' | 'staff';
  business_name: string | null;
  iban: string | null;
  sort_code: string | null;
  account_number: string | null;
  slug: string | null;
  business_country: string | null;
  business_currency: string | null;
};

export default function BusinessSettingsPage() {
  const router = useRouter();
  const { lang, t } = useLang();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [iban, setIban] = useState('');
  const [slug, setSlug] = useState('');
  const [country, setCountry] = useState('GB');
  const [currency, setCurrency] = useState('GBP');
  const [sortCode, setSortCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  /**
   * The letterhead for invoices HexaBee issues - a second card with its own
   * endpoint and its own save.
   *
   * It is not folded into the profile save above, although that page's rule is
   * "one page, one save": these fields live on different columns behind a
   * different permission check, and a single button would make a staff member's
   * refused letterhead change look like a refused business-name change.
   */
  const [lh, setLh] = useState<Letterhead | null>(null);
  const [lhSaving, setLhSaving] = useState(false);
  const [lhMsg, setLhMsg] = useState<{ ok: boolean; text: Msg } | null>(null);

  // Staff may do the daily work and nothing that redirects money. The API
  // refuses these fields from a staff session anyway; disabling them here is
  // so the form does not invite an edit it will then reject.
  const isStaff = profile?.role === 'staff';

  /**
   * Yellow means "something still needs doing" - the same rule the bank and
   * Tele2 cards follow. A merchant only reaches Settings with their business
   * details already filled in, so a permanently primary save button was
   * shouting an unfinished task at a finished form.
   *
   * It turns yellow again the moment a field differs from what is stored, so
   * the colour now answers the question this page could not answer at all:
   * "have I got unsaved changes?" The button stays enabled either way -
   * pressing it with nothing changed simply saves the same values.
   */
  const dirty = !!profile && (
    businessName !== (profile.business_name ?? '') ||
    iban !== (profile.iban ?? '') ||
    sortCode !== (profile.sort_code ?? '') ||
    accountNumber !== (profile.account_number ?? '') ||
    slug !== (profile.slug ?? '') ||
    country !== (profile.business_country ?? 'GB') ||
    currency !== (profile.business_currency ?? 'GBP')
  );

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (!isOnboardingComplete(data)) { router.push('/merchant/onboarding'); return; }
        setProfile(data);
        setBusinessName(data.business_name ?? '');
        setIban(data.iban ?? '');
        setSortCode(data.sort_code ?? '');
        setAccountNumber(data.account_number ?? '');
        setSlug(data.slug ?? '');
        setCountry(data.business_country ?? 'GB');
        setCurrency(data.business_currency ?? 'GBP');
      });
  }, [router]);

  useEffect(() => {
    fetch('/api/merchant/invoices/issue-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data) setLh(data as Letterhead); })
      // A letterhead that cannot be read leaves the card out rather than
      // showing empty fields that would save NULLs over real values.
      .catch(err => console.error('[settings/business] letterhead unreadable', String(err)));
  }, []);

  async function saveLetterhead(e: React.FormEvent) {
    e.preventDefault();
    if (!lh) return;
    setLhSaving(true);
    setLhMsg(null);
    try {
      const res = await fetch('/api/merchant/invoices/issue-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_address: lh.invoice_address,
          invoice_bank_name: lh.invoice_bank_name,
          is_vat_payer: lh.is_vat_payer,
          invoice_vat_code: lh.invoice_vat_code,
          invoice_vat_rate: lh.invoice_vat_rate,
          invoice_amounts_include_vat: lh.invoice_amounts_include_vat,
          invoice_number_prefix: lh.invoice_number_prefix,
          invoice_number_format: lh.invoice_number_format,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // ⚠️ The status maps to a key; the backend's own English never reaches
        // the screen. Putting `d.error` in here is also what throws
        // "text is not a function" and blanks the page.
        console.error('[settings/business] letterhead save failed', res.status, d);
        setLhMsg({
          ok: false,
          text: res.status === 403
            ? (tt: Dict) => tt.settings.ownerOnlyNote
            : (tt: Dict) => tt.common.saveFailed,
        });
        return;
      }
      // ⚠️ Re-read rather than patching local state: the backend clears the VAT
      // rate and the inclusive/exclusive answer when the merchant says they are
      // not a payer, so the screen would otherwise keep showing a rate the row
      // no longer holds. Same reason the Tele2 card re-fetches after a key.
      const fresh = await fetch('/api/merchant/invoices/issue-settings')
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
      setLh(fresh ?? (lh ? { ...lh, blockers: d.blockers ?? [] } : lh));
      setLhMsg({ ok: true, text: (tt: Dict) => tt.common.saved });
    } catch (err) {
      console.error('[settings/business] letterhead save threw', String(err));
      setLhMsg({ ok: false, text: (tt: Dict) => tt.common.networkError });
    } finally {
      setLhSaving(false);
    }
  }

  function formatSortCode(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    const isGB = country === 'GB';
    const res = await fetch('/api/merchant/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName,
        iban: isGB ? null : iban,
        sortCode: isGB ? sortCode.replace(/-/g, '') : null,
        accountNumber: isGB ? accountNumber : null,
        slug,
        businessCountry: country,
        businessCurrency: currency,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg({ ok: true, text: tt => tt.common.saved });
      const fresh = await fetch('/api/merchant/profile').then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (fresh) { setProfile(fresh); setIban(fresh.iban ?? ''); }
    } else {
      // The status decides the sentence, never the backend's own `error`
      // string - see the note in montonio-key-error.ts.
      const d = await res.json().catch(() => ({}));
      setSaveMsg({
        ok: false,
        text:
          res.status === 409
            ? (tt: Dict) => tt.settings.slugTaken
            : res.status === 403
              ? (tt: Dict) => tt.settings.ownerOnlyNote
              : (tt: Dict) => tt.common.saveFailed,
      });
      if (d?.error) console.error('[settings/business] save failed', res.status, d.error);
    }
  }

  if (!profile) return <p className="hb-skeleton">{t.common.loading}</p>;

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.settings.navBusiness}</h1>
          <p className="hb-sub">{t.settings.businessProfileSub}</p>
        </div>
      </div>

      <div className="hb-card">
        <form onSubmit={handleSave}>
          <label className="hb-field">{t.settings.businessName}
            <input className="hb-input" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder={t.settings.businessNamePlaceholder} disabled={isStaff} />
            <span className="hb-optional">{t.settings.businessNameNote}</span>
          </label>

          <div className="hb-grid-2">
            <label className="hb-field">{t.settings.businessCountry}
              <select
                className="hb-input"
                value={country}
                disabled={isStaff}
                onChange={e => {
                  const c = e.target.value;
                  setCountry(c);
                  setCurrency(COUNTRIES.find(x => x.code === c)?.currency ?? 'EUR');
                }}
              >
                {countryOptions(country).map(c => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {lang === 'lt' ? (t.countryNames[c.code] ?? c.name) : c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="hb-field">{t.settings.currency}
              <input className="hb-input" value={currency} disabled />
              <span className="hb-optional">{t.settings.currencyNote}</span>
            </label>
          </div>

          {country === 'GB' ? (
            <div className="hb-grid-2">
              <label className="hb-field">{t.settings.sortCode}
                <input className="hb-input" value={sortCode} onChange={e => setSortCode(formatSortCode(e.target.value))} placeholder="e.g. 20-00-00" disabled={isStaff} />
              </label>
              <label className="hb-field">{t.settings.accountNumber}
                <input className="hb-input" value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="e.g. 12345678" disabled={isStaff} />
              </label>
            </div>
          ) : (
            <label className="hb-field">{t.settings.iban}
              <input className="hb-input" value={iban} onChange={e => setIban(e.target.value)} placeholder="e.g. LT121000011101001000" required disabled={isStaff} />
            </label>
          )}

          <label className="hb-field">{t.settings.publicSlug}
            <input className="hb-input" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="e.g. mycompany" disabled={isStaff} />
            <span className="hb-optional">{t.settings.slugNote}</span>
          </label>

          <label className="hb-field">{t.settings.email}
            <input className="hb-input" value={profile.email} disabled />
          </label>

          <div className="hb-actions">
            {/* One page, one save - which is what removes the three buttons
                that all read "Save settings" on the old single page. */}
            <button className={`hb-btn${dirty ? ' primary' : ''}`} type="submit" disabled={saving || isStaff}>
              {saving ? t.settings.saving : t.settings.saveBusiness}
            </button>
          </div>
          {isStaff && <p className="hb-note">{t.settings.ownerOnlyNote}</p>}
          {saveMsg && <p className={`hb-msg ${saveMsg.ok ? 'ok' : 'err'}`}>{saveMsg.text(t)}</p>}
        </form>
      </div>

      {lh && (
        <div className="hb-card">
          <form onSubmit={saveLetterhead}>
            <h2 className="hb-card-title">{t.issue.letterhead.title}</h2>
            <p className="hb-card-sub">{t.issue.letterhead.sub}</p>

            <label className="hb-field">{t.issue.letterhead.address}
              <input className="hb-input" value={lh.invoice_address ?? ''} disabled={isStaff}
                     onChange={e => setLh({ ...lh, invoice_address: e.target.value })} />
            </label>

            <label className="hb-field">{t.issue.letterhead.bankName}
              <input className="hb-input" value={lh.invoice_bank_name ?? ''} disabled={isStaff}
                     onChange={e => setLh({ ...lh, invoice_bank_name: e.target.value })} />
              <span className="hb-optional">{t.issue.letterhead.bankNameNote}</span>
            </label>

            <label className="hb-field">{t.issue.letterhead.isVatPayer}
              <select className="hb-input" value={triState(lh.is_vat_payer)} disabled={isStaff}
                      onChange={e => setLh({ ...lh, is_vat_payer: fromTri(e.target.value) })}>
                <option value="">{t.issue.letterhead.unset}</option>
                <option value="yes">{t.issue.letterhead.yes}</option>
                <option value="no">{t.issue.letterhead.no}</option>
              </select>
              <span className="hb-optional">{t.issue.letterhead.isVatPayerNote}</span>
            </label>

            {lh.is_vat_payer === true && (
              <>
                <div className="hb-grid-2">
                  <label className="hb-field">{t.issue.letterhead.vatCode}
                    <input className="hb-input" value={lh.invoice_vat_code ?? ''} disabled={isStaff}
                           onChange={e => setLh({ ...lh, invoice_vat_code: e.target.value })} />
                  </label>
                  <label className="hb-field">{t.issue.letterhead.vatRate}
                    <input className="hb-input" type="number" min={0} max={100} step="0.01"
                           value={lh.invoice_vat_rate ?? ''} disabled={isStaff}
                           onChange={e => setLh({ ...lh, invoice_vat_rate: e.target.value === '' ? null : Number(e.target.value) })} />
                    <span className="hb-optional">{t.issue.letterhead.vatRateNote}</span>
                  </label>
                </div>

                {/* ⚠️ Asked only when the rate is not zero: at 0 % the question
                    does not arise, and a question with no consequence is one
                    more thing to answer wrongly. */}
                {(lh.invoice_vat_rate ?? 0) > 0 && (
                  <label className="hb-field">{t.issue.letterhead.amountsIncludeVat}
                    <select className="hb-input" value={triState(lh.invoice_amounts_include_vat)} disabled={isStaff}
                            onChange={e => setLh({ ...lh, invoice_amounts_include_vat: fromTri(e.target.value) })}>
                      <option value="">{t.issue.letterhead.unset}</option>
                      <option value="yes">{t.issue.letterhead.yes}</option>
                      <option value="no">{t.issue.letterhead.no}</option>
                    </select>
                    <span className="hb-optional">{t.issue.letterhead.amountsIncludeVatNote}</span>
                  </label>
                )}
              </>
            )}

            <div className="hb-grid-2">
              <label className="hb-field">{t.issue.letterhead.prefix}
                <input className="hb-input" value={lh.invoice_number_prefix ?? ''} disabled={isStaff}
                       onChange={e => setLh({ ...lh, invoice_number_prefix: e.target.value })} />
                <span className="hb-optional">{t.issue.letterhead.prefixNote}</span>
              </label>
              <label className="hb-field">{t.issue.letterhead.format}
                <input className="hb-input hb-mono" value={lh.invoice_number_format ?? ''} disabled={isStaff}
                       onChange={e => setLh({ ...lh, invoice_number_format: e.target.value })} />
                <span className="hb-optional">{t.issue.letterhead.formatNote}</span>
              </label>
            </div>

            <div className="hb-actions">
              <button className="hb-btn primary" type="submit" disabled={lhSaving || isStaff}>
                {lhSaving ? t.settings.saving : t.issue.letterhead.save}
              </button>
            </div>
            {isStaff && <p className="hb-note">{t.settings.ownerOnlyNote}</p>}
            {lhMsg && <p className={`hb-msg ${lhMsg.ok ? 'ok' : 'err'}`}>{lhMsg.text(t)}</p>}
          </form>
        </div>
      )}
    </>
  );
}
