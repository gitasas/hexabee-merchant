'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang, type Dict } from '../../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';

type Msg = (t: Dict) => string;

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
              {saving ? t.settings.saving : t.settings.saveSettings}
            </button>
          </div>
          {isStaff && <p className="hb-note">{t.settings.ownerOnlyNote}</p>}
          {saveMsg && <p className={`hb-msg ${saveMsg.ok ? 'ok' : 'err'}`}>{saveMsg.text(t)}</p>}
        </form>
      </div>
    </>
  );
}
