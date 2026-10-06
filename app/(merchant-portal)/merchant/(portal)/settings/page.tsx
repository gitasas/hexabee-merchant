'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { CHECKOUT_URL } from '@/lib/checkout-url';
import { useLang, type Dict } from '../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';
import { DEFAULT_TEMPLATE } from '@/lib/invoice-email-template';

/**
 * A message held in state is held as a FUNCTION of the dictionary, never as a
 * finished sentence - see the same note on the Invoices page. Storing the
 * sentence froze it in the language that was active when it happened, so the
 * toggle left Lithuanian text on an English screen (reported 2026-10-05 and
 * again 2026-10-06).
 */
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


const isLiveMode = process.env.NEXT_PUBLIC_STRIPE_ENV === 'live';

// Inbound (BCC) domain — Resend-managed *.resend.app address on the free
// plan; switch to in.hexabee.buzz via env once a custom receiving domain
// is configured. Must match INBOUND_DOMAIN on the Python backend.
const INBOUND_DOMAIN = process.env.NEXT_PUBLIC_INBOUND_DOMAIN || 'in.hexabee.buzz';

type Profile = {
  id: string;
  email: string;
  role?: 'owner' | 'staff';
  business_name: string | null;
  iban: string | null;
  sort_code: string | null;
  account_number: string | null;
  slug: string | null;
  stripe_account_id: string | null;
  stripe_account_id_live: string | null;
  business_country: string | null;
  business_currency: string | null;
  fee_mode: string | null;
  reminders_enabled: boolean | null;
  payment_rail: string | null;
  montonio_configured: boolean;
  montonio_sandbox?: boolean;
  template: { filename: string; created_at: string } | null;
};

type ConnectStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export default function MerchantSettingsPage() {
  const router = useRouter();
  const { lang, t } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);

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
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedTap, setCopiedTap] = useState(false);
  const [copiedPos, setCopiedPos] = useState(false);
  const [mmCopied, setMmCopied] = useState(false);
  const [bccCopied, setBccCopied] = useState(false);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [keysSaving, setKeysSaving] = useState(false);
  const [keysMsg, setKeysMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectMsg, setConnectMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  // QR of the plain pay link, for the invoice template or the email body. It
  // opens the same page the link does, so a scan lands the payer on the inbox
  // (or the form) exactly as a click would — nothing else to configure.
  const [invoiceQr, setInvoiceQr] = useState<string | null>(null);
  const [invoiceQrMsg, setInvoiceQrMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [feeMode, setFeeMode] = useState<'merchant' | 'payer'>('merchant');
  const [feeModeSaving, setFeeModeSaving] = useState(false);
  // Counter payments only: above this amount the merchant absorbs the fee.
  // Empty means no threshold, which is what every merchant had before this.
  const [posFeeMax, setPosFeeMax] = useState('');
  const [posFeeMaxSaving, setPosFeeMaxSaving] = useState(false);
  const [posFeeMaxMsg, setPosFeeMaxMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [feeModeMsg, setFeeModeMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [remindersSaving, setRemindersSaving] = useState(false);
  const [remindersMsg, setRemindersMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  // The covering letter sent with an invoice. Empty means the merchant has not
  // written one, and the built-in default is used - so the boxes show that
  // default as placeholder text rather than pre-filling it, which would make a
  // merchant think they had written something they had not.
  const [tplSubject, setTplSubject] = useState('');
  const [tplBody, setTplBody] = useState('');
  const [tplSaving, setTplSaving] = useState(false);
  const [tplMsg, setTplMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  // Whether the invoice PDF travels with the email. Off until the merchant
  // ticks it: without the document every payment comes through the link and
  // lands in the ledger, with nothing settled by an untracked transfer.
  const [attachPdf, setAttachPdf] = useState(false);
  // Staff may do the daily work and nothing that redirects money. The API
  // refuses these fields from a staff session anyway; disabling them here is
  // so the form does not invite an edit it will then reject.
  const isStaff = profile?.role === 'staff';
  // Who can sign in to this account. Loaded only for an owner; the route
  // refuses a staff request anyway, so asking would just log a 403.
  const [users, setUsers] = useState<{ id: string; email: string; role: string; accepted: boolean }[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'staff'>('staff');
  const [usersBusy, setUsersBusy] = useState(false);
  const [usersMsg, setUsersMsg] = useState<{ ok: boolean; text: Msg } | null>(null);
  // Where a payer's reply lands. Empty means the account email - which the
  // merchant cannot change and which, for a school, is usually the director
  // rather than the office that handles invoices.
  const [replyTo, setReplyTo] = useState('');
  const [accountEmail, setAccountEmail] = useState('');

  useEffect(() => {
    fetch('/api/merchant/invoice-template')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setTplSubject(d.subject ?? '');
        setTplBody(d.body ?? '');
        setAttachPdf(d.attachPdf === true);
        setReplyTo(d.replyTo ?? '');
        setAccountEmail(d.accountEmail ?? '');
      })
      .catch(() => { /* the default template still works without this */ });
  }, []);

  async function loadUsers() {
    try {
      const res = await fetch('/api/merchant/users');
      if (!res.ok) return;
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch { /* the rest of Settings works without it */ }
  }

  async function inviteUser() {
    const email = inviteEmail.trim();
    if (!email || usersBusy) return;
    setUsersBusy(true);
    setUsersMsg(null);
    try {
      const res = await fetch('/api/merchant/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInviteEmail('');
        // The row exists even if the mail failed, so say which happened rather
        // than leaving the owner unsure whether the person was added at all.
        setUsersMsg({
          ok: true,
          text: data.sent
            ? (tt: Dict) => tt.settings.usersInvited(email)
            : (tt: Dict) => tt.settings.usersAddedNoMail(email),
        });
        loadUsers();
      } else {
        const map: Record<string, Msg> = {
          already_member: tt => tt.settings.usersAlreadyMember,
          email_taken: tt => tt.settings.usersEmailTaken,
          invalid_email: tt => tt.settings.usersInvalidEmail,
        };
        setUsersMsg({ ok: false, text: map[String(data.detail ?? data.error)] ?? ((tt: Dict) => tt.settings.usersFailed) });
      }
    } catch {
      setUsersMsg({ ok: false, text: (tt: Dict) => tt.settings.usersFailed });
    } finally {
      setUsersBusy(false);
    }
  }

  async function changeUserRole(id: string, role: 'owner' | 'staff') {
    if (usersBusy) return;
    setUsersBusy(true);
    setUsersMsg(null);
    try {
      const res = await fetch(`/api/merchant/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) loadUsers();
      else setUsersMsg({ ok: false, text: userError(String(data.detail ?? data.error)) });
    } catch {
      setUsersMsg({ ok: false, text: (tt: Dict) => tt.settings.usersFailed });
    } finally {
      setUsersBusy(false);
    }
  }

  async function removeUser(id: string) {
    if (usersBusy) return;
    setUsersBusy(true);
    setUsersMsg(null);
    try {
      const res = await fetch(`/api/merchant/users/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) loadUsers();
      else setUsersMsg({ ok: false, text: userError(String(data.detail ?? data.error)) });
    } catch {
      setUsersMsg({ ok: false, text: (tt: Dict) => tt.settings.usersFailed });
    } finally {
      setUsersBusy(false);
    }
  }

  function userError(code: string): Msg {
    if (code === 'last_owner') return tt => tt.settings.usersLastOwner;
    if (code === 'cannot_demote_self') return tt => tt.settings.usersNotSelfRole;
    if (code === 'cannot_remove_self') return tt => tt.settings.usersNotSelfRemove;
    return tt => tt.settings.usersFailed;
  }

  async function saveTemplate() {
    if (tplSaving) return;
    setTplSaving(true);
    setTplMsg(null);
    try {
      const res = await fetch('/api/merchant/invoice-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: tplSubject, body: tplBody, attachPdf, replyTo }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTplSubject(data.subject ?? '');
        setTplBody(data.body ?? '');
        setReplyTo(data.replyTo ?? '');
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

  useEffect(() => {
    fetch('/api/merchant/profile')
      .then(r => {
        if (r.status === 401) { router.push('/merchant/login'); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (!isOnboardingComplete(data)) {
          router.push('/merchant/onboarding');
          return;
        }
        setProfile(data);
        // Only an owner may read the list, and the route refuses the rest -
        // asking anyway would just log a 403 on every Settings visit.
        if (data.role !== 'staff') loadUsers();
        setBusinessName(data.business_name ?? '');
        setIban(data.iban ?? '');
        setSortCode(data.sort_code ?? '');
        setAccountNumber(data.account_number ?? '');
        setSlug(data.slug ?? '');
        setCountry(data.business_country ?? 'GB');
        setCurrency(data.business_currency ?? 'GBP');
        setFeeMode(data.fee_mode === 'payer' ? 'payer' : 'merchant');
        setPosFeeMax(data.pos_fee_payer_max != null ? String(data.pos_fee_payer_max) : '');
        setRemindersEnabled(data.reminders_enabled === true);

        const activeAccountId = isLiveMode ? data.stripe_account_id_live : data.stripe_account_id;
        if (activeAccountId) {
          fetch(`/api/connect/status?accountId=${encodeURIComponent(activeAccountId)}`)
            .then(r => r.json())
            .then(s => { if (s.ok) setConnectStatus({ chargesEnabled: s.chargesEnabled, payoutsEnabled: s.payoutsEnabled }); })
            .catch(() => null);
        }
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
      // The server decides the rail from the country — with one exception it
      // alone can see (a Baltic merchant still taking payments on Stripe). Read
      // the result back rather than guess it, so the Stripe/Montonio sections
      // below show what is actually true.
      const fresh = await fetch('/api/merchant/profile').then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (fresh) {
        setProfile(fresh);
        setIban(fresh.iban ?? '');
      } else {
        setProfile(p => p ? { ...p, business_name: businessName, iban: isGB ? null : iban, sort_code: isGB ? sortCode : null, account_number: isGB ? accountNumber : null, slug, business_country: country, business_currency: currency } : p);
      }
    } else {
      const d = await res.json();
      setSaveMsg(d.error ?? t.common.saveFailed);
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
        setProfile(p => p ? { ...p, template: { filename: file.name, created_at: new Date().toISOString() } } : p);
      } else {
        const d = await res.json();
        setUploadMsg({ ok: false, text: d.error ?? t.settings.templateFailed });
      }
    } catch (err) {
      // Not err.message: that is an internal English string, and putting it on
      // screen answers a Lithuanian merchant in English.
      setUploadMsg({ ok: false, text: (tt: Dict) => tt.settings.uploadFailed });
    } finally {
      setUploading(false);
    }
  }

  /**
   * Replacing store keys, validated exactly as at onboarding. Montonio can
   * reissue a key, and without this the merchant's only route back to working
   * payments would be asking us to edit their row.
   */
  async function handleSaveKeys(e: React.FormEvent) {
    e.preventDefault();
    setKeysSaving(true);
    setKeysMsg(null);
    try {
      const res = await fetch('/api/merchant/montonio-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: accessKey.trim(), secretKey: secretKey.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setKeysMsg(data?.error ?? t.common.saveFailed);
        return;
      }
      setKeysMsg({ ok: true, text: tt => tt.onboarding.keysStored });
      setProfile(p => (p ? { ...p, montonio_configured: true } : p));
      setAccessKey('');
      setSecretKey('');
      setShowKeyForm(false);
    } catch {
      setKeysMsg({ ok: false, text: tt => tt.common.saveFailed });
    } finally {
      setKeysSaving(false);
    }
  }

  async function handleConnect() {
    setConnectLoading(true);
    setConnectMsg(null);
    try {
      const res = await fetch('/api/connect/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.ok) { setConnectMsg(data.error ?? t.settings.onboardFailed); return; }
      window.location.href = data.url;
    } catch {
      setConnectMsg({ ok: false, text: tt => tt.common.genericError });
    } finally {
      setConnectLoading(false);
    }
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
      setPosFeeMaxMsg(res.ok ? { ok: true, text: tt => tt.common.saved } : { ok: false, text: tt => tt.common.saveFailed });
    } catch {
      setPosFeeMaxMsg({ ok: false, text: tt => tt.common.saveFailed });
    } finally {
      setPosFeeMaxSaving(false);
    }
  }

  async function handleFeeModeChange(mode: 'merchant' | 'payer') {
    if (mode === feeMode || feeModeSaving) return;
    const prev = feeMode;
    setFeeMode(mode);
    setFeeModeSaving(true);
    setFeeModeMsg(null);
    try {
      const res = await fetch('/api/merchant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeMode: mode }),
      });
      if (!res.ok) {
        setFeeMode(prev);
        setFeeModeMsg({ ok: false, text: tt => tt.common.saveRetry });
      } else {
        setFeeModeMsg({ ok: true, text: tt => tt.common.saved });
        setTimeout(() => setFeeModeMsg(null), 2000);
      }
    } catch {
      setFeeMode(prev);
      setFeeModeMsg({ ok: false, text: tt => tt.common.saveRetry });
    } finally {
      setFeeModeSaving(false);
    }
  }

  async function handleRemindersChange(enabled: boolean) {
    if (enabled === remindersEnabled || remindersSaving) return;
    const prev = remindersEnabled;
    setRemindersEnabled(enabled);
    setRemindersSaving(true);
    setRemindersMsg(null);
    try {
      const res = await fetch('/api/merchant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindersEnabled: enabled }),
      });
      if (!res.ok) {
        setRemindersEnabled(prev);
        setRemindersMsg({ ok: false, text: tt => tt.common.saveRetry });
      } else {
        setRemindersMsg({ ok: true, text: tt => tt.common.saved });
        setTimeout(() => setRemindersMsg(null), 2000);
      }
    } catch {
      setRemindersEnabled(prev);
      setRemindersMsg({ ok: false, text: tt => tt.common.saveRetry });
    } finally {
      setRemindersSaving(false);
    }
  }

  const paymentLink = slug ? `${CHECKOUT_URL}/pay/${slug}` : null;
  const posLink = slug ? `${CHECKOUT_URL}/pay/${slug}?mode=pos` : null;
  // Where a printed NFC sticker or a counter QR points. Static on purpose: the
  // amount lives in the till's request, not in the tag, so one sticker lasts
  // forever and never has to be re-programmed.
  const tapLink = slug ? `${CHECKOUT_URL}/tap/${slug}` : null;
  const mailMergeLink = paymentLink ? `${paymentLink}?a={AMOUNT}&r={INVOICE_NO}` : null;

  useEffect(() => {
    if (!paymentLink) { setInvoiceQr(null); return; }
    let cancelled = false;
    QRCode.toDataURL(paymentLink, { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then(url => { if (!cancelled) setInvoiceQr(url); })
      .catch(err => console.error('invoice QR failed', err));
    return () => { cancelled = true; };
  }, [paymentLink]);

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

  function downloadInvoiceQr() {
    if (!invoiceQr || !slug) return;
    const a = document.createElement('a');
    a.href = invoiceQr;
    a.download = `hexabee-qr-${slug}.png`;
    a.click();
  }
  const bccAddress = `${slug}@${INBOUND_DOMAIN}`;

  async function handleCopyPosLink() {
    if (!posLink) return;
    try {
      await navigator.clipboard.writeText(posLink);
      setCopiedPos(true);
      setTimeout(() => setCopiedPos(false), 2000);
    } catch {
      // Clipboard refused (insecure context, or the browser said no) — the URL
      // is on screen and can be copied by hand.
    }
  }

  async function handleCopyTapLink() {
    if (!tapLink) return;
    try {
      await navigator.clipboard.writeText(tapLink);
      setCopiedTap(true);
      setTimeout(() => setCopiedTap(false), 2000);
    } catch {
      // Clipboard refused (insecure context, or the browser said no) — the URL
      // is on screen and can be copied by hand.
    }
  }

  async function handleGenerateQr() {
    if (!posLink || !businessName) return;
    setQrLoading(true);
    try {
      // 1. Generate raw QR as data URL (400×400, transparent-friendly bg)
      const qrDataUrl = await QRCode.toDataURL(posLink, {
        width: 400,
        margin: 2,
        color: { dark: '#111111', light: '#ffffff' },
      });

      // 2. Load QR image
      const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = qrDataUrl;
      });

      // 3. Load HexaBee logo SVG
      const logoImg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null); // fallback to text if SVG fails
        img.src = '/hexabee-logo.svg';
      });

      // 4. Compose on canvas
      const W = 500;
      const LOGO_H = 72;
      const QR_SIZE = 380;
      const PADDING = 28;
      const NAME_H = 40;
      const URL_H = 28;
      const H = PADDING + LOGO_H + 16 + QR_SIZE + 16 + NAME_H + 8 + URL_H + PADDING;

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      // Background
      ctx.fillStyle = '#fffdf8';
      ctx.fillRect(0, 0, W, H);

      // Border
      ctx.strokeStyle = '#f1e3b6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(4, 4, W - 8, H - 8, 20);
      ctx.stroke();

      let y = PADDING;

      // Logo
      if (logoImg) {
        const logoW = (logoImg.width / logoImg.height) * LOGO_H;
        ctx.drawImage(logoImg, (W - logoW) / 2, y, logoW, LOGO_H);
      } else {
        // Text fallback
        ctx.font = 'bold 28px Arial';
        ctx.fillStyle = '#111111';
        ctx.textAlign = 'center';
        ctx.fillText('⬢ HexaBee', W / 2, y + LOGO_H / 2 + 10);
      }
      y += LOGO_H + 16;

      // QR code (white tile behind it)
      const qrX = (W - QR_SIZE) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(qrX - 6, y - 6, QR_SIZE + 12, QR_SIZE + 12, 12);
      ctx.fill();
      ctx.drawImage(qrImg, qrX, y, QR_SIZE, QR_SIZE);
      y += QR_SIZE + 16;

      // Business name
      ctx.font = 'bold 22px Arial';
      ctx.fillStyle = '#111111';
      ctx.textAlign = 'center';
      ctx.fillText(businessName, W / 2, y + 26);
      y += NAME_H + 8;

      // Line 1: call to action (printed for customers — follows the portal language)
      ctx.font = 'bold 13px Arial';
      ctx.fillStyle = '#7a5b00';
      ctx.textAlign = 'center';
      ctx.fillText(t.settings.qrScanToPay, W / 2, y + 16);

      // Line 2: branding
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

  function handleDownloadQr() {
    if (!qrDataUrl || !slug) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `hexabee-pos-qr-${slug}.png`;
    a.click();
  }

  if (!profile) return <p className="hb-skeleton">{t.common.loading}</p>;

  const activeAccountId = isLiveMode ? profile.stripe_account_id_live : profile.stripe_account_id;
  const isMontonio = profile.payment_rail === 'montonio';

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.settings.title}</h1>
          <p className="hb-sub">{t.settings.sub}</p>
        </div>
      </div>

      {/* 1 ── Business profile */}
      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.businessProfile}</h2>
        <p className="hb-card-sub">{t.settings.businessProfileSub}</p>
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
              {/* Required off the UK: it is where the money lands and how the
                  Gmail extension recognises this merchant on an invoice. */}
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
            <button className="hb-btn primary" type="submit" disabled={saving}>
              {saving ? t.settings.saving : t.settings.saveSettings}
            </button>
          </div>
          {isStaff && <p className="hb-note">{t.settings.ownerOnlyNote}</p>}
          {saveMsg && <p className={`hb-msg ${saveMsg.ok ? 'ok' : 'err'}`}>{saveMsg.text(t)}</p>}
        </form>
      </div>

      {/* 2 ── Getting paid */}
      {paymentLink && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.gettingPaid}</h2>
          <p className="hb-card-sub">{t.settings.gettingPaidSub}</p>

          <div>
            <p className="hb-subsection-label">{t.settings.yourPaymentLink}</p>
            <p className="hb-card-sub">{t.settings.yourPaymentLinkSub}</p>
            <p className="hb-urlbox">{paymentLink}</p>
            <div className="hb-actions">
              <button
                type="button"
                className={`hb-btn sm${copied ? ' ok' : ''}`}
                onClick={() => { navigator.clipboard.writeText(paymentLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              >
                {copied ? t.common.copied : t.settings.copyLink}
              </button>
              <button type="button" className="hb-btn sm" onClick={() => window.open(paymentLink, '_blank')}>{t.settings.preview}</button>
            </div>
          </div>

          {/* The same link as a QR, for invoices and emails — "clients are wary of clicking links" (Apskaitų grupė, 2026-09-17) */}
          <div className="hb-subsection">
            <p className="hb-subsection-label">{t.settings.invoiceQr}</p>
            <p className="hb-card-sub">{t.settings.invoiceQrSub}</p>
            {invoiceQr && (
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={invoiceQr} alt="QR" width={160} height={160} style={{ borderRadius: 12, border: '1px solid var(--border)', background: '#fff' }} />
                <div className="hb-actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <button type="button" className={`hb-btn sm${invoiceQrMsg?.ok ? ' ok' : ''}`} onClick={copyInvoiceQr}>{t.settings.copyQrImage}</button>
                  <button type="button" className="hb-btn sm" onClick={downloadInvoiceQr}>{t.settings.downloadQrImage}</button>
                  {invoiceQrMsg && <p className="hb-note" style={{ margin: 0 }}>{invoiceQrMsg.text(t)}</p>}
                </div>
              </div>
            )}
          </div>

          {/* Mail-merge template link for bulk invoicing from accounting software */}
          <div className="hb-subsection">
            <p className="hb-subsection-label">{t.settings.bulkInvoicing}</p>
            <p className="hb-card-sub">{t.settings.bulkInvoicingSub}</p>
            <p className="hb-urlbox">{mailMergeLink}</p>
            <div className="hb-actions">
              <button
                type="button"
                className={`hb-btn sm${mmCopied ? ' ok' : ''}`}
                onClick={() => { navigator.clipboard.writeText(mailMergeLink!); setMmCopied(true); setTimeout(() => setMmCopied(false), 2000); }}
              >
                {mmCopied ? t.common.copied : t.settings.copyTemplateLink}
              </button>
            </div>
            <p className="hb-note">
              {t.settings.mailMergeNotePrefix}{' '}
              <code>{'{AMOUNT}'}</code> {t.settings.mailMergeNoteMiddle} <code>{'{INVOICE_NO}'}</code>{' '}
              {t.settings.mailMergeNoteSuffix}
            </p>
          </div>

          {/* Invoice inbox (BCC) — auto-registers every invoice sent via accounting software */}
          <div className="hb-subsection">
            <p className="hb-subsection-label">{t.settings.invoiceInbox}</p>
            <p className="hb-card-sub">{t.settings.invoiceInboxSub}</p>
            <p className="hb-urlbox">{bccAddress}</p>
            <div className="hb-actions">
              <button
                type="button"
                className={`hb-btn sm${bccCopied ? ' ok' : ''}`}
                onClick={() => { navigator.clipboard.writeText(bccAddress); setBccCopied(true); setTimeout(() => setBccCopied(false), 2000); }}
              >
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

      {/* The covering letter sent with an invoice. Saved once; the send screen
          will let it be edited for a particular month without changing this. */}
      {/* Who can sign in. Hidden from staff entirely: the API refuses them,
          and a card that only ever answers "forbidden" is worse than no card.
          The director does not send the invoices - that was the whole reason
          for this (2026-10-05). */}
      {profile.role !== 'staff' && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.users}</h2>
          <p className="hb-card-sub">{t.settings.usersSub}</p>

          {users.map(u => (
            <div key={u.id} className="hb-subsection">
              <p className="hb-subsection-label">
                {u.email}
                {!u.accepted && <span className="hb-note"> {t.settings.usersPending}</span>}
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="hb-input"
                  style={{ maxWidth: 180 }}
                  value={u.role}
                  disabled={usersBusy}
                  onChange={e => changeUserRole(u.id, e.target.value === 'owner' ? 'owner' : 'staff')}
                >
                  <option value="owner">{t.settings.roleOwner}</option>
                  <option value="staff">{t.settings.roleStaff}</option>
                </select>
                <button
                  type="button"
                  className="hb-btn sm"
                  onClick={() => removeUser(u.id)}
                  disabled={usersBusy}
                >
                  {t.settings.usersRemove}
                </button>
              </div>
            </div>
          ))}

          <div className="hb-subsection">
            <p className="hb-subsection-label">{t.settings.usersInvite}</p>
            <p className="hb-card-sub">{t.settings.usersInviteSub}</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="hb-input"
                type="email"
                style={{ flex: 1, minWidth: 220 }}
                placeholder={t.settings.usersEmailPlaceholder}
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setUsersMsg(null); }}
              />
              <select
                className="hb-input"
                style={{ maxWidth: 180 }}
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value === 'owner' ? 'owner' : 'staff')}
              >
                <option value="staff">{t.settings.roleStaff}</option>
                <option value="owner">{t.settings.roleOwner}</option>
              </select>
              <button type="button" className="hb-btn sm" onClick={inviteUser} disabled={usersBusy}>
                {usersBusy ? t.settings.saving : t.settings.usersInviteBtn}
              </button>
            </div>
          </div>

          <p className="hb-note">{t.settings.usersRoleNote}</p>
          {usersMsg && <p className={`hb-msg ${usersMsg.ok ? 'ok' : 'err'}`}>{usersMsg.text(t)}</p>}
        </div>
      )}

      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.letter}</h2>
        <p className="hb-card-sub">{t.settings.letterSub}</p>

        <label className="hb-label" htmlFor="tpl-subject">{t.settings.letterSubject}</label>
        <input
          id="tpl-subject"
          className="hb-input"
          value={tplSubject}
          maxLength={300}
          placeholder={DEFAULT_TEMPLATE[t.locale.startsWith('lt') ? 'lt' : 'en'].subject}
          onChange={e => { setTplSubject(e.target.value); setTplMsg(null); }}
        />

        <label className="hb-label" htmlFor="tpl-body" style={{ marginTop: 12 }}>{t.settings.letterBody}</label>
        <textarea
          id="tpl-body"
          className="hb-input"
          rows={8}
          value={tplBody}
          maxLength={20000}
          placeholder={DEFAULT_TEMPLATE[t.locale.startsWith('lt') ? 'lt' : 'en'].body}
          onChange={e => { setTplBody(e.target.value); setTplMsg(null); }}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />

        <p className="hb-note">
          {t.settings.letterTokens}{' '}
          <code>{'{name}'}</code> {t.settings.letterTokenName},{' '}
          <code>{'{invoice}'}</code> {t.settings.letterTokenInvoice},{' '}
          <code>{'{amount}'}</code> {t.settings.letterTokenAmount},{' '}
          <code>{'{due}'}</code> {t.settings.letterTokenDue},{' '}
          <code>{'{breakdown}'}</code> {t.settings.letterTokenBreakdown}.
        </p>
        <p className="hb-note">{t.settings.letterBreakdownHint}</p>
        <p className="hb-note">{t.settings.letterWeAdd}</p>

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
            <input
              type="checkbox"
              checked={attachPdf}
              onChange={e => { setAttachPdf(e.target.checked); setTplMsg(null); }}
              style={{ marginTop: 3 }}
            />
            <span>
              <span className="hb-subsection-label">{t.settings.attachPdf}</span>
              <span className="hb-card-sub" style={{ display: 'block' }}>{t.settings.attachPdfSub}</span>
            </span>
          </label>
        </div>

        <div className="hb-actions">
          <button type="button" className="hb-btn" onClick={saveTemplate} disabled={tplSaving}>
            {tplSaving ? t.settings.saving : t.settings.saveSettings}
          </button>
        </div>
        {tplMsg && <p className={`hb-msg ${tplMsg.ok ? 'ok' : 'err'}`}>{tplMsg.text(t)}</p>}
      </div>

      {/* 3 ── Preferences */}
      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.preferences}</h2>
        <p className="hb-card-sub">{t.settings.preferencesSub}</p>

        {paymentLink && (
          <div>
            <p className="hb-subsection-label">{t.settings.whoPaysFee}</p>
            <p className="hb-card-sub">{t.settings.whoPaysFeeSub}</p>
            <div className="hb-segment">
              {([
                { mode: 'merchant' as const, label: t.settings.iCoverIt },
                { mode: 'payer' as const, label: t.settings.payerCoversIt },
              ]).map(opt => (
                <button
                  key={opt.mode}
                  type="button"
                  className={`hb-btn${feeMode === opt.mode ? ' selected' : ''}`}
                  onClick={() => handleFeeModeChange(opt.mode)}
                  disabled={feeModeSaving || isStaff}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {feeMode === 'payer' && (
              <p className="hb-note">{t.settings.payerFeeNote}</p>
            )}
            {feeModeMsg && (
              <p className={`hb-msg ${feeModeMsg.ok ? 'ok' : 'err'}`}>{feeModeMsg.text(t)}</p>
            )}

          </div>
        )}

        <div className="hb-subsection">
          <p className="hb-subsection-label">{t.settings.reminders}</p>
          <p className="hb-card-sub">{t.settings.remindersSub}</p>
          <div className="hb-segment">
            {([
              { enabled: false, label: t.common.off },
              { enabled: true, label: t.common.on },
            ]).map(opt => (
              <button
                key={opt.label}
                type="button"
                className={`hb-btn${remindersEnabled === opt.enabled ? ' selected' : ''}`}
                onClick={() => handleRemindersChange(opt.enabled)}
                disabled={remindersSaving}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {remindersMsg && (
            <p className={`hb-msg ${remindersMsg.ok ? 'ok' : 'err'}`}>{remindersMsg.text(t)}</p>
          )}
        </div>
      </div>

      {/* 4 ── In-person payments. Gated on being able to take a payment at all,
              not on Stripe: the POS flow follows the merchant's rail, so a
              Montonio merchant can take one — they just never get charges
              enabled on a Stripe account they do not have. */}
      {posLink && (isMontonio ? profile.montonio_configured : connectStatus?.chargesEnabled) && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.inPerson}</h2>
          <p className="hb-card-sub">{t.settings.inPersonSub}</p>

          {/* The threshold lives here, with the counter, and not beside the fee
              toggle where it started. It applies to QR and tap payments only -
              an invoice sent by email follows the toggle whatever it is worth -
              so next to that toggle it read as a qualification of it. Shown
              only when the payer covers the fee: with the merchant covering it
              there is nothing for a threshold to switch over. */}
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
                  onChange={e => setPosFeeMax(e.target.value)}
                />
                <button
                  type="button"
                  className="hb-btn sm"
                  onClick={handlePosFeeMaxSave}
                  disabled={posFeeMaxSaving}
                >
                  {posFeeMaxSaving ? t.settings.saving : t.settings.saveSettings}
                </button>
              </div>
              {posFeeMax.trim() !== '' && (
                <p className="hb-note">{t.settings.posFeeMaxNote(posFeeMax.trim().replace(',', '.'))}</p>
              )}
              {posFeeMaxMsg && (
                <p className={`hb-msg ${posFeeMaxMsg.ok ? 'ok' : 'err'}`}>{posFeeMaxMsg.text(t)}</p>
              )}
            </div>
          )}

          <p className="hb-urlbox">{posLink}</p>
          <div className="hb-actions">
            <button type="button" className="hb-btn" onClick={handleCopyPosLink}>
              {copiedPos ? t.common.copied : t.settings.copyLink}
            </button>
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '20px 0 4px' }}>{t.settings.tapLink}</h3>
          <p className="hb-card-sub">{t.settings.tapLinkSub}</p>
          <p className="hb-urlbox">{tapLink}</p>
          <div className="hb-actions">
            <button type="button" className="hb-btn" onClick={handleCopyTapLink}>
              {copiedTap ? t.common.copied : t.settings.copyLink}
            </button>
          </div>

          <div className="hb-actions" style={{ marginTop: 16 }}>
            <button type="button" className="hb-btn" onClick={handleGenerateQr} disabled={qrLoading}>
              {qrLoading ? t.settings.generating : t.settings.generateQr}
            </button>
            {qrDataUrl && (
              <button type="button" className="hb-btn" onClick={handleDownloadQr}>
                {t.settings.downloadQr}
              </button>
            )}
          </div>

          {qrDataUrl && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              {/* Canvas-composed PNG preview — no class fits a fixed-size image */}
              <img
                src={qrDataUrl}
                alt="POS QR code"
                style={{ width: 200, height: 200, borderRadius: 12, border: '1px solid var(--border)' }}
              />
            </div>
          )}

          <p className="hb-note">{t.settings.qrNote}</p>
        </div>
      )}

      {/* 5 ── How this merchant gets paid. Montonio merchants have no Stripe
              account and never will, so showing them a Stripe Connect card is
              showing them a product they cannot use and did not ask for. */}
      {isMontonio ? (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.settings.bankPayments}</h2>
          <p className="hb-card-sub">{t.settings.bankPaymentsSub}</p>
          <div className="hb-actions">
            <span className={`hb-badge ${profile.montonio_configured ? 'is-paid' : 'is-pending'}`}>
              {profile.montonio_sandbox
                ? t.onboarding.sandboxReady
                : profile.montonio_configured ? t.settings.bankConnected : t.onboarding.bankPending}
            </span>
          </div>
          {showKeyForm ? (
            <form onSubmit={handleSaveKeys} style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="hb-input"
                placeholder={t.onboarding.accessKeyPlaceholder}
                value={accessKey}
                autoComplete="off"
                onChange={e => setAccessKey(e.target.value)}
                required
              />
              <input
                className="hb-input"
                type="password"
                placeholder={t.onboarding.secretKeyPlaceholder}
                value={secretKey}
                autoComplete="new-password"
                onChange={e => setSecretKey(e.target.value)}
                required
              />
              <div className="hb-actions">
                <button type="submit" className="hb-btn primary" disabled={keysSaving}>
                  {keysSaving ? t.onboarding.checkingKeys : t.onboarding.connectStore}
                </button>
              </div>
              {keysMsg && <p className={`hb-msg ${keysMsg.ok ? 'ok' : 'err'}`}>{keysMsg.text(t)}</p>}
            </form>
          ) : (
            <div className="hb-actions" style={{ marginTop: 12 }}>
              <button type="button" className="hb-btn" onClick={() => setShowKeyForm(true)}>
                {t.settings.replaceKeys}
              </button>
            </div>
          )}
        </div>
      ) : (
      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.stripeConnect} {isLiveMode ? t.settings.liveMode : t.settings.testMode}</h2>
        <p className="hb-card-sub">{t.settings.stripeSub}</p>
        {activeAccountId ? (
          <>
            <div className="hb-actions">
              <span className={`hb-badge ${connectStatus?.chargesEnabled ? 'is-paid' : 'is-pending'}`}>
                {connectStatus?.chargesEnabled ? t.settings.chargesEnabled : t.settings.chargesPending}
              </span>
              <span className={`hb-badge ${connectStatus?.payoutsEnabled ? 'is-paid' : 'is-pending'}`}>
                {connectStatus?.payoutsEnabled ? t.settings.payoutsEnabled : t.settings.payoutsPending}
              </span>
            </div>
            <p className="hb-note hb-mono">{activeAccountId}</p>
            {connectStatus && !connectStatus.chargesEnabled && (
              <div className="hb-actions" style={{ marginTop: 12 }}>
                <button type="button" className="hb-btn" onClick={handleConnect} disabled={connectLoading}>
                  {connectLoading ? t.settings.redirecting : t.settings.completeStripe}
                </button>
              </div>
            )}
          </>
        ) : (
          <button type="button" className="hb-btn primary" onClick={handleConnect} disabled={connectLoading}>
            {connectLoading ? t.settings.redirecting : t.settings.connectStripe}
          </button>
        )}
        {connectMsg && <p className="hb-msg err">{connectMsg.text(t)}</p>}
      </div>
      )}

      {/* 6 ── Invoice template */}
      <div className="hb-card">
        <h2 className="hb-card-title">{t.settings.invoiceTemplate}</h2>
        <p className="hb-card-sub">{t.settings.invoiceTemplateSub}</p>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleTemplateUpload} />
        <div className="hb-actions">
          <button type="button" className="hb-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? t.settings.uploading : t.settings.uploadSample}
          </button>
        </div>
        {profile.template && (
          <p className="hb-note">
            {t.settings.currentTemplate} <strong>{profile.template.filename}</strong>
          </p>
        )}
        {uploadMsg && (
          <p className={`hb-msg ${uploadMsg.ok ? 'ok' : 'err'}`}>{uploadMsg.text(t)}</p>
        )}
      </div>
    </>
  );
}
