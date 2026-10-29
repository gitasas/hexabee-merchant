'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang, type Dict } from '../../../i18n';
import { isOnboardingComplete } from '@/lib/onboarding';
import { isSettledToNothing } from '@/lib/invoice-amount';
import { paidSourceKey, canReopen } from '@/lib/paid-source';
import { awaitingSend } from '@/lib/invoice-source';
import { SMS_PRICE_PER_SEGMENT } from '@/lib/sms-template';

/**
 * A message held in state is held as a FUNCTION of the dictionary, never as a
 * finished sentence.
 *
 * Storing the sentence froze it in whichever language was active when it
 * happened, so switching the toggle afterwards left Lithuanian text on an
 * English screen. Reported twice (2026-10-05, 2026-10-06) - the second time
 * about code written hours after the first fix, which is the sign that the
 * one-off repairs were the wrong shape. Resolved at render, so the toggle
 * retranslates whatever is on screen.
 */
type Msg = (t: Dict) => string;

type SendPreview = {
  attachPdf: boolean;
  alreadySent: number;
  ready: {
    id: string;
    payer_name: string | null;
    payer_email: string | null;
    payer_email_cc: string | null;
    invoice_number: string | null;
    amount: string | null;
    currency: string | null;
    nothing_to_pay: boolean;
  }[];
  blocked: { id: string; payer_name: string | null; invoice_number: string | null; reason: string }[];
  sample: { to: string; subject: string; body: string } | null;
};

type Invoice = {
  id: string;
  payer_email: string | null;
  // A second address for the same person, typically the other parent. Sent to
  // alongside the first and remembered against the name like the first, so it
  // is asked for once rather than every month.
  payer_email_cc: string | null;
  // Reachable by SMS when they have no email at all - which is the whole
  // reason a garden association still sends paper. Read off the invoice where
  // it prints one, typed by the merchant where it does not.
  payer_phone: string | null;
  // Who the invoice is addressed to, as printed on it. Read at upload and
  // matched against the remembered list, so an address is asked for once per
  // person rather than once per invoice.
  payer_name: string | null;
  // What the invoice tells the payer to write in the payment purpose
  // ("Už Rytį Černiauską"). Shown only to merchants whose payments actually
  // carry it - see usesInvoicePurpose.
  payment_purpose: string | null;
  // When HexaBee emailed this invoice. NULL for every BCC row forever - the
  // merchant sent those themselves - and for anything we have not sent yet.
  sent_at: string | null;
  // When HexaBee texted it. Independent of sent_at: a customer with no email
  // address gets this and never a letter, so one NULL must not be read as
  // "we have not contacted them".
  sms_sent_at: string | null;
  // How the invoice reached us: 'bcc' (the merchant emailed it from their own
  // mail client and copied us) or 'upload' (they handed us the file to send).
  // It is what separates "we have not sent this" from "we were never the one
  // sending it". NULL on a database too old to carry the column.
  source: string | null;
  invoice_number: string | null;
  amount: string | null;
  currency: string | null;
  due_date: string | null;
  status: string;
  email_subject: string | null;
  pdf_filename: string | null;
  // Whether the document itself is still stored. Only ever true for a merchant
  // who switched "keep a copy" on - for everyone else the bytes are dropped the
  // moment the invoice is sent, and the link below is not offered at all.
  has_pdf: boolean | null;
  paid_at: string | null;
  // 'hexabee' (a Stripe/Montonio webhook), 'manual' (ticked off by the merchant),
  // or null for rows paid before the column existed.
  paid_source: string | null;
  // The payer told us, from a reminder email, that they had already paid. It
  // stops the automatic reminders without asserting the invoice is settled.
  payer_claimed_at: string | null;
  created_at: string;
  reminders_sent: number | null;
  last_reminder_at: string | null;
};

type Outstanding = { currency: string; total: number };

// Whole days past the deadline, or null while it has not passed. Compared date
// to date in local time: an invoice due today is not late, whatever the hour.
function daysOverdue(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((midnight.getTime() - due.getTime()) / 86_400_000);
  return diff > 0 ? diff : null;
}

function formatAmount(amount: string | null, currency: string | null): string {
  if (amount === null || amount === '') return '-';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '-';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency ?? 'EUR' }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

export default function MerchantInvoicesPage() {
  const router = useRouter();
  const { t } = useLang();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [remindMsg, setRemindMsg] = useState<Record<string, { ok: boolean; text: Msg }>>({});
  const [settlingId, setSettlingId] = useState<string | null>(null);
  // What would go out if the merchant pressed send. Loaded separately from the
  // ledger because it answers a different question: not "what do I have" but
  // "what am I about to do".
  // Off for every merchant unless an operator switched it on, so the purpose
  // line stays hidden rather than describing a behaviour they do not have.
  const [usesInvoicePurpose, setUsesInvoicePurpose] = useState(false);
  // Paid invoices in total, from the server, because the page is served only a
  // slice of them. Every other figure here is derived from the rows on screen
  // so it cannot disagree with them - this one is the exception, and it exists
  // precisely so the page can admit when it is not showing everything.
  const [paidSummary, setPaidSummary] = useState<{ currency: string; count: number; total: number }[]>([]);
  const [paidPageSize, setPaidPageSize] = useState(0);
  // Which "nothing to do" groups the merchant has opened. Collapsed by default
  // and remembered only for the visit: the point is that a settled invoice
  // stops competing for attention, and a group that reopened itself on every
  // load would undo that.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ sent: number; failed: number; remaining: number } | null>(null);
  const [sendDone, setSendDone] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  // Which row is asking "are you sure". Deleting is the one action here that
  // cannot be undone, so it takes two presses and the second one names the
  // invoice.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<Record<string, Msg>>({});
  const [resendMsg, setResendMsg] = useState<Record<string, { ok: boolean; text: Msg }>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [ccOpen, setCcOpen] = useState<Record<string, boolean>>({});
  const [ccEmail, setCcEmail] = useState<Record<string, string>>({});
  const [ccSaving, setCcSaving] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState<Record<string, boolean>>({});
  const [phoneVal, setPhoneVal] = useState<Record<string, string>>({});
  const [phoneSaving, setPhoneSaving] = useState<string | null>(null);
  const [assignEmail, setAssignEmail] = useState<Record<string, string>>({});
  const [assignMsg, setAssignMsg] = useState<Record<string, { ok: boolean; text: Msg }>>({});
  const [resumingId, setResumingId] = useState<string | null>(null);
  // Batch upload. One file per request, so a slow or unreadable PDF costs that
  // row and not the whole batch - and the merchant watches it happen instead of
  // waiting on a spinner that says nothing.
  const [uploadBusy, setUploadBusy] = useState<{ done: number; total: number } | null>(null);
  const [uploadFailed, setUploadFailed] = useState<{ filename: string; reason: string }[]>([]);
  const [uploadStored, setUploadStored] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [settleMsg, setSettleMsg] = useState<Record<string, string>>({});

  // ── SMS, for the customers the email batch cannot reach ──────────────────
  //
  // `usage` is not decoration. Tele2 cap an account at 10 000 messages a month
  // and have **no endpoint to query the remaining allowance** - the only
  // signal is `limit_reached`, which refuses an entire request. So the figure
  // on screen comes from counting our own rows, and it is shown before the
  // button rather than after the failure.
  const [smsUsage, setSmsUsage] = useState<{
    configured: boolean;
    sender_name: string | null;
    waiting: number;
    usage: { used: number; limit: number; remaining: number };
    preview: string | null;
    cost: { segments: number; encoding: string; chars: number } | null;
    batch_segments: number | null;
    restricted: boolean;
  } | null>(null);
  const [sendingSms, setSendingSms] = useState(false);
  const [smsProgress, setSmsProgress] = useState<{ sent: number; failed: number; remaining: number } | null>(null);
  const [smsDone, setSmsDone] = useState<{ ok: boolean; text: Msg } | null>(null);
  const [confirmSms, setConfirmSms] = useState(false);
  const [smsSendingId, setSmsSendingId] = useState<string | null>(null);
  const [smsRowMsg, setSmsRowMsg] = useState<Record<string, { ok: boolean; text: Msg }>>({});

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(t.locale, { day: '2-digit', month: 'short', year: 'numeric' });

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
        loadInvoices();
        loadPreview();
        loadSmsUsage();
      });
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Send the batch a chunk at a time, until nothing is left or the server says
  // stop. The loop is here rather than on the server so that each request stays
  // small, the count on screen is real rather than a guess, and an interruption
  // - a closed laptop, a dropped connection - costs one chunk, with every
  // invoice already sent recorded as sent.
  // One invoice, again, because the merchant is pointing at it. Deliberately
  // not part of the batch: the batch's whole job is to refuse what it already
  // sent.
  async function handleDelete(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    setDeleteMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setInvoices(list => list.filter(inv => inv.id !== id));
        loadPreview();
        return;
      }
      // 409 is the backend refusing to delete a paid row. Say which it was:
      // "could not delete" leaves a merchant pressing the same button again.
      setDeleteMsg(m => ({
        ...m,
        [id]: res.status === 409 ? (tt: Dict) => tt.invoices.deletePaid : (tt: Dict) => tt.invoices.deleteFailed,
      }));
    } catch {
      setDeleteMsg(m => ({ ...m, [id]: (tt: Dict) => tt.invoices.deleteFailed }));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  async function handleResend(id: string) {
    if (resendingId) return;
    setResendingId(id);
    setResendMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/resend`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setInvoices(list => list.map(inv =>
          inv.id === id ? { ...inv, sent_at: data.sent_at ?? new Date().toISOString() } : inv
        ));
        setResendMsg(m => ({ ...m, [id]: { ok: true, text: (tt: Dict) => tt.invoices.resendDone } }));
      } else {
        setResendMsg(m => ({
          ...m,
          [id]: {
            ok: false,
            text: data.rate_limited
              ? (tt: Dict) => tt.invoices.resendRateLimited
              : (tt: Dict) => tt.invoices.resendFailed,
          },
        }));
      }
    } catch {
      setResendMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.resendFailed } }));
    } finally {
      setResendingId(null);
    }
  }

  async function loadSmsUsage() {
    try {
      const res = await fetch('/api/merchant/sms/usage');
      if (res.ok) setSmsUsage(await res.json());
    } catch { /* the rest of the page works without it */ }
  }

  async function handleSendAllSms() {
    if (sendingSms) return;
    setSendingSms(true);
    setSmsDone(null);
    let sent = 0;
    let failed = 0;
    try {
      // Bounded for the same reason the email loop is: if the server ever
      // stopped reducing the remaining count, this would text in circles -
      // and here each circle costs the merchant money.
      for (let round = 0; round < 80; round++) {
        const res = await fetch('/api/merchant/invoices/send-sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 10 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSmsDone({
            ok: false,
            text: res.status === 409
              ? (tt: Dict) => tt.invoices.smsNotConfigured
              : (tt: Dict) => tt.invoices.smsBatchFailed,
          });
          break;
        }
        sent += data.sent ?? 0;
        failed += data.failed ?? 0;
        setSmsProgress({ sent, failed, remaining: data.remaining ?? 0 });
        if (data.stopped === 'rate_limited') {
          // Tele2's `limit_reached` refuses a whole request, so the rest of
          // the batch really has not gone - and the merchant has to ask them
          // to raise the monthly allowance before it can.
          setSmsDone({ ok: false, text: (tt: Dict) => tt.invoices.smsLimitReached(sent, data.remaining ?? 0) });
          break;
        }
        if ((data.remaining ?? 0) === 0) {
          setSmsDone({ ok: true, text: (tt: Dict) => tt.invoices.smsDone(sent, failed) });
          break;
        }
        if ((data.sent ?? 0) === 0 && (data.failed ?? 0) === 0) {
          setSmsDone({ ok: false, text: (tt: Dict) => tt.invoices.sendStalled });
          break;
        }
      }
    } catch {
      setSmsDone({ ok: false, text: (tt: Dict) => tt.invoices.smsBatchFailed });
    } finally {
      setSendingSms(false);
      setConfirmSms(false);
      loadSmsUsage();
      loadInvoices();
    }
  }

  async function handleSendSms(id: string) {
    if (smsSendingId) return;
    setSmsSendingId(id);
    setSmsRowMsg(m => ({ ...m, [id]: { ok: true, text: (tt: Dict) => tt.invoices.smsSending } }));
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'reminder' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setInvoices(list => list.map(inv =>
          inv.id === id ? { ...inv, sms_sent_at: data.sms_sent_at ?? new Date().toISOString() } : inv
        ));
        setSmsRowMsg(m => ({ ...m, [id]: { ok: true, text: (tt: Dict) => tt.invoices.smsRowDone } }));
        loadSmsUsage();
      } else {
        setSmsRowMsg(m => ({
          ...m,
          [id]: {
            ok: false,
            text: data.rate_limited
              ? (tt: Dict) => tt.invoices.smsRowLimit
              : (tt: Dict) => tt.invoices.smsRowFailed,
          },
        }));
      }
    } catch {
      setSmsRowMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.smsRowFailed } }));
    } finally {
      setSmsSendingId(null);
    }
  }

  async function handleSendAll() {
    if (sending) return;
    setSending(true);
    setSendDone(null);
    let sent = 0;
    let failed = 0;
    try {
      // Bounded, not `while (true)`: if the server ever stopped reducing the
      // remaining count, this would otherwise email in circles.
      for (let round = 0; round < 60; round++) {
        const res = await fetch('/api/merchant/invoices/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 10 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSendDone({ ok: false, text: (tt: Dict) => tt.invoices.sendBatchFailed });
          break;
        }
        sent += data.sent ?? 0;
        failed += data.failed ?? 0;
        setSendProgress({ sent, failed, remaining: data.remaining ?? 0 });
        if (data.stopped === 'rate_limited') {
          setSendDone({ ok: false, text: (tt: Dict) => tt.invoices.sendRateLimited(sent, data.remaining ?? 0) });
          break;
        }
        if ((data.remaining ?? 0) === 0) {
          setSendDone({ ok: true, text: (tt: Dict) => tt.invoices.sendDone(sent, failed) });
          break;
        }
        if ((data.sent ?? 0) === 0 && (data.failed ?? 0) === 0) {
          // Nothing moved and nothing failed: there is nothing this loop can do
          // that another round would change.
          setSendDone({ ok: false, text: (tt: Dict) => tt.invoices.sendStalled });
          break;
        }
      }
    } catch {
      setSendDone({ ok: false, text: (tt: Dict) => tt.invoices.sendBatchFailed });
    } finally {
      setSending(false);
      setConfirmSend(false);
      loadPreview();
      loadInvoices();
    }
  }

  async function loadPreview() {
    try {
      const res = await fetch('/api/merchant/invoices/send-preview');
      if (res.ok) setPreview(await res.json());
    } catch { /* the ledger below is still usable without it */ }
  }

  function loadInvoices() {
    setLoading(true);
    fetch('/api/merchant/invoices')
      .then(r => r.ok ? r.json() : { invoices: [] })
      .then(data => {
        // The route also returns `outstanding`, but this page derives it from
        // the rows instead (see below), so that total never disagrees with the
        // table the merchant is looking at.
        setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
        setUsesInvoicePurpose(data.usesInvoicePurpose === true);
        setPaidSummary(Array.isArray(data.paidSummary) ? data.paidSummary : []);
        setPaidPageSize(Number(data.paidPageSize) || 0);
      })
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }

  async function handleSendReminder(id: string) {
    if (remindingId) return;
    setRemindingId(id);
    setRemindMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/remind`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const sent = typeof data.reminders_sent === 'number' ? data.reminders_sent : null;
        setInvoices(list => list.map(inv => inv.id === id
          ? { ...inv, reminders_sent: sent ?? (inv.reminders_sent ?? 0) + 1, last_reminder_at: new Date().toISOString() }
          : inv
        ));
        setRemindMsg(m => ({ ...m, [id]: { ok: true, text: (tt: Dict) => tt.invoices.sent } }));
        setTimeout(() => setRemindMsg(m => { const next = { ...m }; delete next[id]; return next; }), 3000);
      } else {
        // Not `data.detail`: that is the backend's own English sentence, and
        // putting it on screen answers a Lithuanian merchant in English - the
        // same bug the login page had. Why a reminder could not be sent is
        // already shown beside the button as missing fields.
        setRemindMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.sendFailed } }));
      }
    } catch {
      setRemindMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.sendFailed } }));
    } finally {
      setRemindingId(null);
    }
  }

  // Close an invoice that was settled outside HexaBee, or reopen one closed by
  // mistake. Nothing here creates a payment row: this is money we never handled,
  // and it must never reach the dashboard's takings or our monthly invoice.
  // Assign a recipient, and let the backend remember the name. The reply says
  // how many other invoices it filled in: that number is the whole point of the
  // feature, so it is shown rather than swallowed.
  // Adding the other parent. It reuses the payer endpoint and deliberately
  // resends the SAME primary address: a different one there is what tells the
  // backend two people share a name, and this is the opposite statement.
  // Same endpoint and the same trick as the second address: resend the SAME
  // primary email, because a different one there means two people share a
  // name, and a phone number says nothing about that either way.
  async function handleAssignPhone(id: string) {
    const inv = invoices.find(i => i.id === id);
    if (!inv?.payer_email || phoneSaving) return;
    const phone = (phoneVal[id] ?? '').trim();
    setPhoneSaving(id);
    setAssignMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/payer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inv.payer_email, phone }),
      });
      if (res.ok) {
        setInvoices(list => list.map(i => (i.id === id ? { ...i, payer_phone: phone || null } : i)));
        setPhoneOpen(m => ({ ...m, [id]: false }));
      } else {
        setAssignMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.phoneInvalid } }));
      }
    } catch {
      setAssignMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.ccFailed } }));
    } finally {
      setPhoneSaving(null);
    }
  }

  async function handleAssignCc(id: string) {
    const inv = invoices.find(i => i.id === id);
    if (!inv?.payer_email || ccSaving) return;
    const emailCc = (ccEmail[id] ?? '').trim();
    setCcSaving(id);
    setAssignMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/payer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inv.payer_email, emailCc }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const name = data.payer_name as string | null;
        const key = (x: string | null) => (x ?? '').trim().toLowerCase();
        setInvoices(list => list.map(i => {
          if (i.id === id) return { ...i, payer_email_cc: emailCc || null };
          // The backfill carries the second address too, so the table has to
          // agree with it rather than wait for a reload to disagree.
          if (name && key(i.payer_name) === key(name) && i.payer_email === inv.payer_email) {
            return { ...i, payer_email_cc: emailCc || null };
          }
          return i;
        }));
        setCcOpen(m => ({ ...m, [id]: false }));
        loadPreview();
      } else {
        const k = String(data?.error ?? '');
        setAssignMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) =>
          k === 'same_email' ? tt.invoices.ccSame : tt.invoices.ccInvalid } }));
      }
    } catch {
      setAssignMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.ccFailed } }));
    } finally {
      setCcSaving(null);
    }
  }

  async function handleAssignPayer(id: string) {
    const email = (assignEmail[id] ?? '').trim();
    if (!email || assigningId) return;
    setAssigningId(id);
    setAssignMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/payer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const name = data.payer_name as string | null;
        const key = (s: string | null) => (s ?? '').trim().toLowerCase();
        setInvoices(list => list.map(inv => {
          if (inv.id === id) return { ...inv, payer_email: email };
          // Mirror the backend's backfill locally so the table agrees with what
          // just happened, instead of waiting for a reload to tell the truth.
          if (!inv.payer_email && name && key(inv.payer_name) === key(name)) {
            return { ...inv, payer_email: email };
          }
          return inv;
        }));
        setAssignEmail(m => { const next = { ...m }; delete next[id]; return next; });
        // The send list just changed - someone moved from "no recipient" to
        // "would be sent", and the screen that says what is about to happen
        // must not be the stale one.
        loadPreview();
        if (data.ambiguous) {
          setAssignMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.payerAmbiguous } }));
        } else if (data.backfilled > 0) {
          setAssignMsg(m => ({ ...m, [id]: { ok: true, text: (tt: Dict) => tt.invoices.payerAlsoFilled(data.backfilled) } }));
        }
      } else {
        setAssignMsg(m => ({
          ...m,
          [id]: {
            ok: false,
            text: data.error === 'invalid_email'
              ? (tt: Dict) => tt.invoices.payerInvalidEmail
              : (tt: Dict) => tt.invoices.payerFailed,
          },
        }));
      }
    } catch {
      setAssignMsg(m => ({ ...m, [id]: { ok: false, text: (tt: Dict) => tt.invoices.payerFailed } }));
    } finally {
      setAssigningId(null);
    }
  }

  async function handleSettle(id: string, paid: boolean) {
    if (settlingId) return;
    setSettlingId(id);
    setSettleMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/paid`, { method: paid ? 'POST' : 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInvoices(list => list.map(inv => inv.id === id
          ? paid
            ? { ...inv, status: 'paid', paid_at: data.paid_at ?? new Date().toISOString(), paid_source: 'manual' }
            : { ...inv, status: 'issued', paid_at: null, paid_source: null }
          : inv
        ));
      } else {
        setSettleMsg(m => ({ ...m, [id]: String(data.error ?? t.invoices.markFailed) }));
      }
    } catch {
      setSettleMsg(m => ({ ...m, [id]: t.invoices.markFailed }));
    } finally {
      setSettlingId(null);
    }
  }

  // The payer said they had paid and the merchant found no money. Without this
  // one false click would silence an unpaid invoice for good, and a customer who
  // wanted to stall would only have to press a button.
  async function handleResumeReminders(id: string) {
    if (resumingId) return;
    setResumingId(id);
    setSettleMsg(m => { const next = { ...m }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/merchant/invoices/${id}/resume-reminders`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInvoices(list => list.map(inv => inv.id === id
          ? { ...inv, payer_claimed_at: null, reminders_sent: 0 }
          : inv
        ));
      } else {
        setSettleMsg(m => ({ ...m, [id]: String(data.error ?? t.invoices.resumeFailed) }));
      }
    } catch {
      setSettleMsg(m => ({ ...m, [id]: t.invoices.resumeFailed }));
    } finally {
      setResumingId(null);
    }
  }

  async function handleUpload(files: FileList | File[] | null) {
    if (!files || uploadBusy) return;
    // A folder drag, or a stray screenshot alongside the invoices, should not
    // become a row of failures the merchant has to read past.
    const list = Array.from(files).filter(
      f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (list.length === 0) return;
    setUploadFailed([]);
    setUploadStored(null);
    setUploadBusy({ done: 0, total: list.length });

    const failed: { filename: string; reason: string }[] = [];
    let stored = 0;

    // Sequential on purpose. Sixty PDFs in parallel would hit the scanner and
    // the model all at once, and the first thing to break would be the ones at
    // the end - silently, which is the failure this screen exists to end.
    for (let i = 0; i < list.length; i++) {
      const fd = new FormData();
      fd.append('file', list[i]);
      try {
        const res = await fetch('/api/merchant/invoices/upload', { method: 'POST', body: fd });
        const data = await res.json().catch(() => null);
        if (data?.ok) stored++;
        else failed.push({ filename: list[i].name, reason: String(data?.reason ?? 'error') });
      } catch {
        failed.push({ filename: list[i].name, reason: 'error' });
      }
      setUploadBusy({ done: i + 1, total: list.length });
    }

    setUploadBusy(null);
    setUploadFailed(failed);
    setUploadStored(stored);
    loadInvoices();
  }

  function uploadReason(reason: string): string {
    if (reason === 'unreadable') return t.invoices.uploadReasonUnreadable;
    if (reason === 'not_a_pdf') return t.invoices.uploadReasonNotPdf;
    if (reason === 'too_large') return t.invoices.uploadReasonTooLarge;
    return t.invoices.uploadReasonError;
  }

  if (loading) return <p className="hb-skeleton">{t.common.loading}</p>;

  // A row without a number, amount or payer could not be read from the emailed
  // PDF: it can never be matched to a payment or reminded, so it is surfaced as
  // "needs a look" rather than counted as money owed.
  const isActionable = (inv: Invoice) => missingFields(inv).length === 0;

  // Which fields are missing, by name. A button that is simply dead, with a
  // tooltip saying "some details could not be read", leaves the merchant with
  // nowhere to go - and tooltips on a disabled button do not open at all on a
  // touch screen, so the reason is also rendered as text under it.
  function missingFields(inv: Invoice): string[] {
    const missing: string[] = [];
    if (!inv.invoice_number) missing.push(t.invoices.missingInvoiceNo);
    if (inv.amount === null) missing.push(t.invoices.missingAmount);
    if (!inv.payer_email) missing.push(t.invoices.missingPayer);
    return missing;
  }

  // Read fine, owes nothing. The merchant's own invoice settles it: a school
  // that applies a parent's prepayment prints "Mokėti: 0,00" under a total of
  // 1043,40, or a negative when the parent overpaid. Such a row is not unpaid,
  // not unreadable and not waiting for a recipient - it is simply finished, and
  // every count below has to agree with that or the merchant is chasing a
  // number this page invented (2026-10-02).
  const nothingToPay = (inv: Invoice) => isSettledToNothing(inv.amount);

  const unpaidCount = invoices.filter(
    inv => inv.status === 'issued' && isActionable(inv) && !nothingToPay(inv)
  ).length;
  // "Could not be read" means we failed to extract something from the invoice:
  // its number or its amount. A missing payer is a different thing entirely -
  // every uploaded invoice has none until recipients are matched, and calling
  // that a reading failure told the merchant their own upload had gone wrong.
  // The reminder button still needs a payer; that is what missingFields says.
  const unreadableCount = invoices.filter(
    inv => inv.status === 'issued' && (!inv.invoice_number || inv.amount === null)
  ).length;
  const awaitingPayerCount = invoices.filter(
    inv => inv.status === 'issued' && !!inv.invoice_number && inv.amount !== null
      && !inv.payer_email && !nothingToPay(inv)
  ).length;
  // Still counted as unpaid: a claim is the payer's word, not a settled invoice.
  // It is surfaced because it is the one row on this page that needs the
  // merchant to go and look at their bank.
  const claimedCount = invoices.filter(inv => inv.status === 'issued' && !!inv.payer_claimed_at).length;

  // Derived from the rows on screen, not from the server's copy. Marking an
  // invoice paid updates `invoices` in place, and the total used to be state
  // loaded once - so the yellow box kept showing the amount of an invoice the
  // merchant had just settled, and called it unpaid.
  const outstanding: Outstanding[] = (() => {
    const totals = new Map<string, number>();
    for (const inv of invoices) {
      if (inv.status !== 'issued') continue;
      const amount = Number(inv.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const cur = (inv.currency ?? 'EUR').toUpperCase();
      totals.set(cur, (totals.get(cur) ?? 0) + amount);
    }
    // Settling the last unpaid invoice would otherwise make the whole box
    // vanish at the moment the merchant most wants to see it worked. Show a
    // zero in the newest invoice's currency instead (rows are newest first).
    if (totals.size === 0 && invoices.length > 0) {
      totals.set((invoices[0].currency ?? 'EUR').toUpperCase(), 0);
    }
    return Array.from(totals.entries()).map(([currency, total]) => ({
      currency,
      total: Math.round(total * 100) / 100,
    }));
  })();

  // "Unpaid" is wrong for an invoice that asks for nothing: the merchant reads
  // the column, not the note under the button, and a row saying "Neapmokėta"
  // beside a zero reads as a problem to chase. It is also not "paid" - nobody
  // paid anything - so it gets its own badge (2026-10-02).
  const statusBadge = (inv: Invoice) =>
    inv.status === 'paid'
      ? { cls: 'is-paid', label: t.invoices.statusPaid }
      : nothingToPay(inv)
        ? { cls: 'is-neutral', label: t.invoices.statusNothingToPay }
        : { cls: 'is-pending', label: t.invoices.statusUnpaid };

  /**
   * The ledger is grouped by what a row needs doing to it, and ordered by what
   * blocks what. Asked for by Baltijos licėjus (2026-10-16) as "colour the paid
   * ones light green so I can skip them" - which is the right problem and the
   * wrong half of it: at several hundred invoices a month the paid rows are the
   * majority, and a colour still leaves them on screen competing for attention.
   *
   * ⚠️ `claimed` must stay its own group, and must never be folded in with the
   * paid ones. The payer said they paid, so the reminders have stopped, but
   * nobody has seen the money and `status` is still `issued`. It is the one row
   * on this page that needs the merchant to go and look at their bank - green
   * would bury it, and leaving it among the overdue rows makes it look like an
   * ordinary debtor.
   *
   * Order within "needs attention" is deliberate: an unreadable row blocks
   * everything downstream (no number, no payment can ever match it), a claim
   * costs real money if ignored, overdue is the daily work, and "not sent" sits
   * last because it is one batch button rather than N decisions.
   */
  type Group =
    | 'unreadable' | 'claimed' | 'overdue' | 'noRecipient' | 'unsent'
    | 'scheduled' | 'paid' | 'nothingToPay';

  const ATTENTION: Group[] = ['unreadable', 'claimed', 'overdue', 'noRecipient', 'unsent'];
  const DONE: Group[] = ['scheduled', 'paid', 'nothingToPay'];

  const groupOf = (inv: Invoice): Group => {
    if (inv.status === 'paid') return 'paid';
    // Before anything else: a row we could not read cannot be chased, matched
    // or sent, whatever else is true of it.
    if (!inv.invoice_number || inv.amount === null) return 'unreadable';
    if (nothingToPay(inv)) return 'nothingToPay';
    if (inv.payer_claimed_at) return 'claimed';
    if (daysOverdue(inv.due_date) !== null) return 'overdue';
    // No way to reach them yet. An uploaded invoice carries no address until
    // the recipient is matched, and no reminder can go out until it is.
    if (!inv.payer_email && !inv.payer_phone) return 'noRecipient';
    if (awaitingSend(inv)) return 'unsent';
    return 'scheduled';
  };

  const grouped = (() => {
    const map = new Map<Group, Invoice[]>();
    for (const inv of invoices) {
      const g = groupOf(inv);
      const list = map.get(g);
      if (list) list.push(inv); else map.set(g, [inv]);
    }
    return map;
  })();

  const groupLabel: Record<Group, string> = {
    unreadable: t.invoices.groupUnreadable,
    claimed: t.invoices.groupClaimed,
    overdue: t.invoices.groupOverdue,
    noRecipient: t.invoices.groupNoRecipient,
    unsent: t.invoices.groupUnsent,
    scheduled: t.invoices.groupScheduled,
    paid: t.invoices.groupPaid,
    nothingToPay: t.invoices.groupNothingToPay,
  };

  const groupHint: Partial<Record<Group, string>> = {
    claimed: t.invoices.groupClaimedHint,
    overdue: t.invoices.groupOverdueHint,
  };

  // The paid group counts from the server, not from the rows: the page is
  // served only the newest slice of a merchant's paid history, so counting what
  // arrived would under-report it. Everything else counts its own rows, which
  // is what keeps those numbers in step when a row is settled in place.
  const paidTotalCount = paidSummary.reduce((n, p) => n + p.count, 0);
  const paidRowsShown = grouped.get('paid')?.length ?? 0;
  const paidSliced = paidTotalCount > paidRowsShown && paidPageSize > 0;

  const groupCount = (g: Group) =>
    g === 'paid' ? Math.max(paidTotalCount, paidRowsShown) : (grouped.get(g)?.length ?? 0);

  const attentionTotal = ATTENTION.reduce((n, g) => n + groupCount(g), 0);
  const doneTotal = DONE.reduce((n, g) => n + groupCount(g), 0);

  // One flat list of header and row items, so the existing row markup is
  // reused unchanged rather than duplicated per group. A header is rendered for
  // every non-empty group even when its rows are collapsed - the count is the
  // answer the merchant came for, and hiding the header would hide it too.
  type Item =
    | { kind: 'band'; key: string; label: string }
    | { kind: 'head'; key: string; group: Group }
    | { kind: 'inv'; key: string; inv: Invoice };

  const listItems: Item[] = (() => {
    const out: Item[] = [];
    const push = (groups: Group[], collapsedByDefault: boolean) => {
      for (const g of groups) {
        const rows = grouped.get(g) ?? [];
        if (rows.length === 0 && groupCount(g) === 0) continue;
        out.push({ kind: 'head', key: `h-${g}`, group: g });
        const open = openGroups[g] ?? !collapsedByDefault;
        if (open) for (const inv of rows) out.push({ kind: 'inv', key: inv.id, inv });
      }
    };
    if (attentionTotal > 0) {
      out.push({ kind: 'band', key: 'b-attention', label: t.invoices.groupAttention(attentionTotal) });
    }
    push(ATTENTION, false);
    if (doneTotal > 0) {
      out.push({ kind: 'band', key: 'b-done', label: t.invoices.groupNoAction(doneTotal) });
    }
    push(DONE, true);
    return out;
  })();

  return (
    <>
      <div className="hb-page-head">
        <div>
          <h1 className="hb-title">{t.invoices.title}</h1>
          <p className="hb-sub">{t.invoices.sub}</p>
        </div>
        <div className="hb-actions">
          <a className="hb-btn primary" href="/merchant/invoices/issue">{t.invoices.issueFromSheet}</a>
          <a className="hb-btn" href="/api/merchant/export?type=invoices">{t.invoices.exportCsv}</a>
          <a className="hb-btn" href="/merchant/settings">{t.invoices.inboxAddress}</a>
        </div>
      </div>

      {/* What is still owed, per currency - the reason to open this page */}
      {outstanding.length > 0 && (
        <div className={outstanding.length <= 2 ? 'hb-hero' : 'hb-stats'}>
          {outstanding.map((o, i) => (
            <div key={o.currency} className={`hb-stat${i === 0 ? ' accent' : ''}`}>
              <p className="hb-stat-label">{t.invoices.outstanding(o.currency)}</p>
              <p className="hb-stat-value">{formatAmount(String(o.total), o.currency)}</p>
              {i === 0 && (
                <p className="hb-stat-note">
                  {unpaidCount > 0 ? t.invoices.unpaidNote(unpaidCount) : t.invoices.nothingUnpaid}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* The upload box sits above the ledger because it is what fills it. The
          point of this screen is not the drop zone but the list of files that
          could not be read: on the BCC path that same failure is silent, and a
          lost invoice is a receivable nobody ever chases. */}
      <div className="hb-card" style={{ marginBottom: 16 }}>
        <p className="hb-subsection-label">{t.invoices.uploadTitle}</p>
        <p className="hb-card-sub">{t.invoices.uploadSub}</p>
        {/* Both ways in. The copy promises dragging, so dragging has to work -
            and a picker still matters, because a file manager is where some
            people live and a drop target is invisible to a keyboard. */}
        <div
          onDragOver={e => { e.preventDefault(); if (!uploadBusy) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            if (!uploadBusy) handleUpload(e.dataTransfer.files);
          }}
          style={{
            marginTop: 10,
            padding: '18px 16px',
            borderRadius: 12,
            border: `2px dashed ${dragOver ? 'var(--brand)' : 'var(--border)'}`,
            background: dragOver ? 'rgba(244,180,0,0.06)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap',
            transition: 'border-color .12s, background .12s',
          }}
        >
          <span className="hb-note" style={{ margin: 0 }}>{t.invoices.uploadDropHere}</span>
          <label className="hb-btn primary" style={{ cursor: uploadBusy ? 'default' : 'pointer', opacity: uploadBusy ? 0.6 : 1 }}>
            {t.invoices.uploadPick}
            <input
              type="file"
              accept="application/pdf"
              multiple
              disabled={!!uploadBusy}
              style={{ display: 'none' }}
              onChange={e => { handleUpload(e.target.files); e.target.value = ''; }}
            />
          </label>
          {uploadBusy && (
            <span className="hb-note" style={{ margin: 0 }}>{t.invoices.uploadBusy(uploadBusy.done, uploadBusy.total)}</span>
          )}
        </div>

        {uploadStored !== null && !uploadBusy && (
          <p className="hb-msg ok" style={{ marginTop: 10 }}>{t.invoices.uploadDoneAll(uploadStored)}</p>
        )}

        {uploadFailed.length > 0 && !uploadBusy && (
          <div style={{ marginTop: 10 }}>
            <p className="hb-msg err">{t.invoices.uploadFailedSome(uploadFailed.length)}</p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {uploadFailed.map(f => (
                <li key={f.filename} className="hb-note" style={{ listStyle: 'disc' }}>
                  {f.filename} - {uploadReason(f.reason)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {claimedCount > 0 && (
        <div className="hb-alert">
          <div>
            <p className="hb-alert-text">{t.invoices.claimedAlert(claimedCount)}</p>
            <p className="hb-alert-sub">{t.invoices.claimedAlertSub}</p>
          </div>
        </div>
      )}

      {/* What would go out if the button were pressed. The list comes first and
          the button last, because sixty emails cannot be recalled and from the
          moment HexaBee sends them the mistake is ours, not the merchant's. */}
      {preview && (preview.ready.length > 0 || preview.blocked.length > 0) && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.invoices.sendTitle}</h2>
          <p className="hb-card-sub">
            {t.invoices.sendReady(preview.ready.length)}
            {preview.blocked.length > 0 && ` ${t.invoices.sendBlocked(preview.blocked.length)}`}
            {preview.alreadySent > 0 && ` ${t.invoices.sendAlready(preview.alreadySent)}`}
          </p>

          <div className="hb-actions">
            <button type="button" className="hb-btn sm" onClick={() => setPreviewOpen(o => !o)}>
              {previewOpen ? t.invoices.sendHideList : t.invoices.sendShowList}
            </button>
          </div>

          {previewOpen && (
            <div style={{ marginTop: 12 }}>
              {preview.ready.map(r => (
                <p key={r.id} className="hb-note" style={{ margin: '2px 0' }}>
                  {r.payer_name ? `${r.payer_name} - ` : ''}{r.payer_email}
                  {r.payer_email_cc ? `, ${r.payer_email_cc}` : ''} · {r.invoice_number} ·{' '}
                  {r.amount !== null ? `${Number(r.amount).toFixed(2)} ${(r.currency ?? 'EUR').toUpperCase()}` : ''}
                  {r.nothing_to_pay ? ` · ${t.invoices.sendNoLink}` : ''}
                </p>
              ))}
              {preview.blocked.length > 0 && (
                <>
                  <p className="hb-subsection-label" style={{ marginTop: 12 }}>{t.invoices.sendNotGoing}</p>
                  {preview.blocked.map(b => (
                    <p key={b.id} className="hb-note" style={{ margin: '2px 0', color: '#b45309' }}>
                      {b.payer_name ? `${b.payer_name} - ` : ''}{b.invoice_number ?? '-'} ·{' '}
                      {b.reason === 'unreadable' ? t.invoices.sendReasonUnreadable : t.invoices.sendReasonNoRecipient}
                    </p>
                  ))}
                </>
              )}
              {preview.sample && (
                <div style={{ marginTop: 14 }}>
                  <p className="hb-subsection-label">{t.invoices.sendSample(preview.sample.to)}</p>
                  <p className="hb-note" style={{ fontWeight: 700 }}>{preview.sample.subject}</p>
                  <p className="hb-note" style={{ whiteSpace: 'pre-wrap' }}>{preview.sample.body}</p>
                  <p className="hb-note">
                    {preview.attachPdf ? t.invoices.sendSampleAddsPdf : t.invoices.sendSampleAddsNoPdf}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* The button is the last thing on the card, and it asks once more
              before it does anything. Sixty emails cannot be recalled, and the
              confirmation names the number so it cannot be pressed on a page
              the merchant has not actually read. */}
          {preview.ready.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {!confirmSend ? (
                <button
                  type="button"
                  className="hb-btn"
                  onClick={() => setConfirmSend(true)}
                  disabled={sending}
                >
                  {t.invoices.sendButton(preview.ready.length)}
                </button>
              ) : (
                <div>
                  <p className="hb-alert-text">{t.invoices.sendConfirm(preview.ready.length)}</p>
                  <div className="hb-actions">
                    <button type="button" className="hb-btn" onClick={handleSendAll} disabled={sending}>
                      {sending ? t.invoices.sending : t.invoices.sendConfirmYes}
                    </button>
                    <button
                      type="button"
                      className="hb-btn sm"
                      onClick={() => setConfirmSend(false)}
                      disabled={sending}
                    >
                      {t.invoices.sendCancel}
                    </button>
                  </div>
                </div>
              )}
              {sending && sendProgress && (
                <p className="hb-note">{t.invoices.sendProgress(sendProgress.sent, sendProgress.remaining)}</p>
              )}
              {sendDone && (
                <p className={`hb-msg ${sendDone.ok ? 'ok' : 'err'}`}>{sendDone.text(t)}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* The SMS batch, for the customers the email batch cannot reach.
          Shown only when there is actually somebody to text, so a merchant
          whose customers all have email never meets this card at all. */}
      {smsUsage && smsUsage.waiting > 0 && (
        <div className="hb-card">
          <h2 className="hb-card-title">{t.invoices.smsTitle}</h2>
          <p className="hb-card-sub">{t.invoices.smsReady(smsUsage.waiting)}</p>

          {/* ⚠️ A staging environment that looks exactly like production is how
              a test becomes 700 real messages, so it says so in red. */}
          {smsUsage.restricted && <p className="hb-msg err">{t.invoices.smsRestricted}</p>}

          {!smsUsage.configured ? (
            <p className="hb-msg err">{t.invoices.smsNotConfigured}</p>
          ) : (
            <>
              {smsUsage.preview && (
                <div className="hb-subsection">
                  <p className="hb-subsection-label">{t.invoices.smsSample}</p>
                  <p className="hb-card-sub" style={{ wordBreak: 'break-all' }}>{smsUsage.preview}</p>
                  {smsUsage.cost && (
                    <p className="hb-note">
                      {t.invoices.smsFrom(smsUsage.sender_name ?? '')}
                      {' · '}
                      {smsUsage.cost.encoding === 'unicode'
                        ? t.invoices.smsUnicode
                        : t.invoices.smsLatin}
                      {' · ~'}
                      {((smsUsage.batch_segments ?? 0) * SMS_PRICE_PER_SEGMENT).toFixed(2)} EUR
                      {' '}{t.invoices.smsForBatch}
                    </p>
                  )}
                  {smsUsage.cost?.encoding === 'unicode' && (
                    <p className="hb-msg err">{t.invoices.smsDiacriticCost}</p>
                  )}
                </div>
              )}

              {/* The allowance Tele2 will not report. Printed every time rather
                  than only when it is nearly spent: a number nobody looks at
                  until it runs out is the Resend cliff with extra steps. */}
              <p className="hb-note">
                {t.invoices.smsUsed(smsUsage.usage.used, smsUsage.usage.limit)}
              </p>
              {smsUsage.usage.remaining < smsUsage.waiting && (
                <p className="hb-msg err">
                  {t.invoices.smsNotEnoughLeft(smsUsage.usage.remaining, smsUsage.waiting)}
                </p>
              )}

              <div style={{ marginTop: 14 }}>
                {!confirmSms ? (
                  <button
                    type="button"
                    className="hb-btn"
                    onClick={() => setConfirmSms(true)}
                    disabled={sendingSms}
                  >
                    {t.invoices.smsButton(smsUsage.waiting)}
                  </button>
                ) : (
                  <div>
                    {/* The confirmation names the count AND the cost, because
                        this one spends the merchant's money directly rather
                        than ours. */}
                    <p className="hb-alert-text">
                      {t.invoices.smsConfirm(
                        smsUsage.waiting,
                        ((smsUsage.batch_segments ?? 0) * SMS_PRICE_PER_SEGMENT).toFixed(2)
                      )}
                    </p>
                    <div className="hb-actions">
                      <button type="button" className="hb-btn" onClick={handleSendAllSms} disabled={sendingSms}>
                        {sendingSms ? t.invoices.sending : t.invoices.sendConfirmYes}
                      </button>
                      <button
                        type="button"
                        className="hb-btn sm"
                        onClick={() => setConfirmSms(false)}
                        disabled={sendingSms}
                      >
                        {t.invoices.sendCancel}
                      </button>
                    </div>
                  </div>
                )}
                {sendingSms && smsProgress && (
                  <p className="hb-note">{t.invoices.sendProgress(smsProgress.sent, smsProgress.remaining)}</p>
                )}
                {smsDone && <p className={`hb-msg ${smsDone.ok ? 'ok' : 'err'}`}>{smsDone.text(t)}</p>}
              </div>
            </>
          )}
        </div>
      )}

      {awaitingPayerCount > 0 && (
        <div className="hb-alert">
          <div>
            <p className="hb-alert-text">{t.invoices.awaitingPayer(awaitingPayerCount)}</p>
            <p className="hb-alert-sub">{t.invoices.awaitingPayerSub}</p>
          </div>
        </div>
      )}

      {unreadableCount > 0 && (
        <div className="hb-alert">
          <div>
            <p className="hb-alert-text">{t.invoices.unreadable(unreadableCount)}</p>
            <p className="hb-alert-sub">{t.invoices.unreadableSub}</p>
          </div>
        </div>
      )}

      <div className="hb-card">
        {invoices.length === 0 ? (
          <div className="hb-empty">
            <p className="hb-empty-title">{t.invoices.emptyTitle}</p>
            <p>{t.invoices.emptySub}</p>
            <a className="hb-btn primary" href="/merchant/settings">{t.invoices.getBcc}</a>
          </div>
        ) : (
          <div className="hb-table-wrap">
            <table className="hb-table">
              <thead>
                <tr>
                  <th>{t.invoices.thDate}</th>
                  <th>{t.invoices.thPayer}</th>
                  <th>{t.invoices.thInvoiceNo}</th>
                  <th title={t.invoices.dueExplainer}>{t.invoices.thDue}</th>
                  <th>{t.invoices.thAmount}</th>
                  <th>{t.invoices.thStatus}</th>
                  <th>{t.invoices.thReminder}</th>
                  <th title={t.invoices.markPaidHint}>{t.invoices.thAction}</th>
                </tr>
              </thead>
              <tbody>
                {listItems.map(item => {
                  // A band ("Needs attention · 28") and a group header are both
                  // rows in the same table, so the column widths, the hairlines
                  // and the mobile card layout all keep working untouched.
                  if (item.kind === 'band') {
                    return (
                      <tr key={item.key} className="hb-band">
                        <td colSpan={8} data-label="">{item.label}</td>
                      </tr>
                    );
                  }
                  if (item.kind === 'head') {
                    const g = item.group;
                    const count = groupCount(g);
                    const collapsible = DONE.includes(g);
                    const open = openGroups[g] ?? !collapsible;
                    const paidTotals = g === 'paid'
                      ? paidSummary.map(p => formatAmount(String(p.total), p.currency)).join(' · ')
                      : '';
                    return (
                      <tr key={item.key} className={`hb-grouphead${g === 'paid' ? ' is-paid' : ''}${g === 'claimed' ? ' is-claimed' : ''}${g === 'unreadable' ? ' is-unreadable' : ''}`}>
                        <td colSpan={8} data-label="">
                          <div className="hb-grouphead-row">
                            {collapsible ? (
                              <button
                                type="button"
                                className="hb-grouphead-toggle"
                                onClick={() => setOpenGroups(m => ({ ...m, [g]: !open }))}
                                aria-expanded={open}
                              >
                                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                                {groupLabel[g]}
                              </button>
                            ) : (
                              <span className="hb-grouphead-label">{groupLabel[g]}</span>
                            )}
                            <span className="hb-grouphead-count">{count}</span>
                            {paidTotals && <span className="hb-grouphead-total">{paidTotals}</span>}
                            {groupHint[g] && <span className="hb-grouphead-hint">{groupHint[g]}</span>}
                            {g === 'paid' && paidSliced && (
                              <span className="hb-grouphead-hint">
                                {t.invoices.paidSliceNote(paidRowsShown, paidTotalCount)}
                              </span>
                            )}
                            {collapsible && (
                              <button
                                type="button"
                                className="hb-grouphead-more"
                                onClick={() => setOpenGroups(m => ({ ...m, [g]: !open }))}
                              >
                                {open ? t.invoices.groupHide : t.invoices.groupShow}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const inv = item.inv;
                  const badge = statusBadge(inv);
                  const msg = remindMsg[inv.id];
                  const overdue = daysOverdue(inv.due_date);
                  return (
                    <tr key={inv.id}>
                      <td data-label={t.invoices.thDate}>{formatDate(inv.created_at)}</td>
                      <td data-label={t.invoices.thPayer}>
                        {/* The name stays visible after the address is saved.
                            The merchant knows their customers by name - an
                            address alone ("j.buiviene@...") is a puzzle, and
                            the name is what the invoice itself prints. Rows
                            that arrived by BCC have an address and no name, so
                            they still show the address on its own. */}
                        {inv.payer_name ? (
                          <div>
                            <span>{inv.payer_name}</span>
                            {inv.payer_email ? (
                              <>
                                <p className="hb-note">{inv.payer_email}</p>
                                {/* The other parent. Separated parents who both
                                    want the invoice is the case this exists for
                                    (Baltijos licėjus, 2026-10-14). It is a
                                    second field rather than a second row,
                                    because a different address typed into the
                                    first box is how we learn two people share a
                                    name - the opposite statement. */}
                                {inv.payer_email_cc && !ccOpen[inv.id] && (
                                  <p className="hb-note">{inv.payer_email_cc}</p>
                                )}
                                {/* Asked for on 2026-10-15: several hundred
                                    plot owners have no email at all, and the
                                    association reaches them by SMS. The number
                                    is read off the invoice where it prints one
                                    and typed here where it does not. */}
                                {inv.payer_phone && !phoneOpen[inv.id] && (
                                  <p className="hb-note">{inv.payer_phone}</p>
                                )}
                                {phoneOpen[inv.id] ? (
                                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                    <input
                                      type="tel"
                                      className="hb-input sm"
                                      placeholder={t.invoices.phonePlaceholder}
                                      value={phoneVal[inv.id] ?? ''}
                                      onChange={e => setPhoneVal(m => ({ ...m, [inv.id]: e.target.value }))}
                                      onKeyDown={e => { if (e.key === 'Enter') handleAssignPhone(inv.id); }}
                                      style={{ minWidth: 0, flex: 1 }}
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      className="hb-btn sm"
                                      onClick={() => handleAssignPhone(inv.id)}
                                      disabled={phoneSaving !== null}
                                    >
                                      {phoneSaving === inv.id ? t.invoices.payerSaving : t.invoices.payerSave}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="hb-note"
                                    onClick={() => {
                                      setPhoneVal(m => ({ ...m, [inv.id]: inv.payer_phone ?? '' }));
                                      setPhoneOpen(m => ({ ...m, [inv.id]: true }));
                                    }}
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', display: 'block' }}
                                  >
                                    {inv.payer_phone ? t.invoices.phoneEdit : t.invoices.phoneAdd}
                                  </button>
                                )}
                                {ccOpen[inv.id] ? (
                                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                    <input
                                      type="email"
                                      className="hb-input sm"
                                      placeholder={t.invoices.ccPlaceholder}
                                      value={ccEmail[inv.id] ?? ''}
                                      onChange={e => setCcEmail(m => ({ ...m, [inv.id]: e.target.value }))}
                                      onKeyDown={e => { if (e.key === 'Enter') handleAssignCc(inv.id); }}
                                      style={{ minWidth: 0, flex: 1 }}
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      className="hb-btn sm"
                                      onClick={() => handleAssignCc(inv.id)}
                                      disabled={ccSaving !== null}
                                    >
                                      {ccSaving === inv.id ? t.invoices.payerSaving : t.invoices.payerSave}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="hb-note"
                                    onClick={() => {
                                      setCcEmail(m => ({ ...m, [inv.id]: inv.payer_email_cc ?? '' }));
                                      setCcOpen(m => ({ ...m, [inv.id]: true }));
                                    }}
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                                  >
                                    {inv.payer_email_cc ? t.invoices.ccEdit : t.invoices.ccAdd}
                                  </button>
                                )}
                              </>
                            ) : (
                            // Known who, not known where. Asking here - beside the
                            // name the invoice itself prints - is the only moment
                            // the merchant has the answer in front of them.
                            <>
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              <input
                                type="email"
                                className="hb-input sm"
                                placeholder={t.invoices.payerEmailPlaceholder}
                                value={assignEmail[inv.id] ?? ''}
                                onChange={e => setAssignEmail(m => ({ ...m, [inv.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') handleAssignPayer(inv.id); }}
                                style={{ minWidth: 0, flex: 1 }}
                              />
                              <button
                                type="button"
                                className="hb-btn sm"
                                onClick={() => handleAssignPayer(inv.id)}
                                disabled={assigningId !== null || !(assignEmail[inv.id] ?? '').trim()}
                              >
                                {assigningId === inv.id ? t.invoices.payerSaving : t.invoices.payerSave}
                              </button>
                            </div>
                            {/* The explanation lives in the banner above the
                                table, not here: with sixty invoices this line
                                would repeat sixty times and stop being read. */}
                            {assignMsg[inv.id] && (
                              <p className="hb-note" style={{ color: assignMsg[inv.id].ok ? '#15803d' : '#b45309' }}>
                                {assignMsg[inv.id].text(t)}
                              </p>
                            )}
                            </>
                            )}
                          </div>
                        ) : (inv.payer_email || '-')}
                      </td>
                      <td data-label={t.invoices.thInvoiceNo} className="hb-mono">
                        {inv.invoice_number || '-'}
                        {/* Asked for by an administrator who, when a parent
                            rings about an invoice, had to go and find that one
                            file in a separate folder. The row is already on her
                            screen; the document is now one click from it.
                            Rendered only when we actually hold it, so nobody is
                            offered a link that opens nothing. */}
                        {inv.has_pdf && (
                          <p style={{ margin: '2px 0 0' }}>
                            <a
                              href={`/api/merchant/invoices/${inv.id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hb-note"
                              style={{ fontFamily: 'inherit', textDecoration: 'underline' }}
                            >
                              {t.invoices.invoicePdfOpen}
                            </a>
                          </p>
                        )}
                        {/* Under the number, because it belongs to the same
                            invoice and the merchant reads the two together:
                            the number identifies the document, this names the
                            child the payment is for. It is what reaches the
                            parent's bank statement, so seeing it here is how
                            the merchant checks it before anything is sent. */}
                        {usesInvoicePurpose && inv.payment_purpose && (
                          <p className="hb-note" style={{ fontFamily: 'inherit' }}>{inv.payment_purpose}</p>
                        )}
                      </td>
                      <td data-label={t.invoices.thDue}>
                        {inv.due_date ? (
                          <div>
                            {formatDate(inv.due_date)}
                            {inv.status !== 'paid' && overdue !== null && (
                              <p className="hb-note" style={{ color: '#b45309' }}>
                                {t.invoices.overdueBy(overdue)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="hb-note">{t.invoices.noDueDate}</span>
                        )}
                      </td>
                      <td data-label={t.invoices.thAmount} className="hb-num">{formatAmount(inv.amount, inv.currency)}</td>
                      <td data-label={t.invoices.thStatus}>
                        <div>
                          <span
                            className={`hb-badge ${badge.cls}`}
                            title={inv.status === 'paid' && inv.paid_at ? t.invoices.paidOn(formatDate(inv.paid_at)) : undefined}
                          >
                            {badge.label}
                          </span>
                          {inv.status === 'paid' && inv.paid_at && (
                            <p className="hb-note">{formatDate(inv.paid_at)}</p>
                          )}
                          {/* Where the money came from matters to the merchant's
                              books: anything but a HexaBee payment has nothing
                              to reconcile against on our side.
                              ⚠️ Three values, not two - a `=== 'manual'` test
                              reported every row closed from accounting as
                              "paid via HexaBee". */}
                          {inv.status === 'paid' && (
                            <p className="hb-note">
                              {{
                                hexabee: t.invoices.paidViaHexabee,
                                manual: t.invoices.paidManually,
                                // Both accounting links say the same thing to
                                // the merchant: it closed because their own
                                // books say so. Naming which system would be
                                // detail they already know.
                                centas: t.invoices.paidFromAccounting,
                                rivile: t.invoices.paidFromAccounting,
                              }[paidSourceKey(inv.paid_source)]}
                            </p>
                          )}
                          {inv.status === 'issued' && inv.payer_claimed_at && (
                            <p className="hb-note" style={{ color: '#b45309' }}
                               title={t.invoices.claimedOn(formatDate(inv.payer_claimed_at))}>
                              {t.invoices.claimedBadge}
                            </p>
                          )}
                        </div>
                      </td>
                      <td data-label={t.invoices.thReminder}>
                        {/* What HexaBee itself emailed, and the way to do it
                            again. A BCC row never shows this: the merchant sent
                            those themselves, so there is nothing of ours to
                            repeat. The batch refuses anything already sent, so
                            without this button a letter with a typo, or one a
                            customer says never arrived, had no answer at all. */}
                        {inv.sent_at && (
                          <div style={{ marginBottom: 8 }}>
                            <p className="hb-note">{t.invoices.sentOn(formatDate(inv.sent_at))}</p>
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleResend(inv.id)}
                              disabled={resendingId !== null}
                              title={t.invoices.resendHint}
                            >
                              {resendingId === inv.id ? t.invoices.sending : t.invoices.resend}
                            </button>
                            {resendMsg[inv.id] && (
                              <p className="hb-note" style={{ color: resendMsg[inv.id].ok ? '#15803d' : '#b45309' }}>
                                {resendMsg[inv.id].text(t)}
                              </p>
                            )}
                          </div>
                        )}
                        {inv.status === 'issued' ? (
                          <div>
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleSendReminder(inv.id)}
                              disabled={remindingId !== null || !isActionable(inv) || nothingToPay(inv)}
                              title={
                                nothingToPay(inv)
                                  ? t.invoices.nothingToPayNote
                                  : isActionable(inv) ? undefined : t.invoices.missingDetails(missingFields(inv).join(', '))
                              }
                            >
                              {remindingId === inv.id ? t.invoices.sending : t.invoices.sendReminder}
                            </button>
                            {/* The backend refuses a reminder for an invoice
                                that owes nothing, so this says why rather than
                                leaving a dead button. Checked before
                                missingFields: such a row usually has no payer
                                either, and "missing: payer" would send the
                                merchant hunting for an address that would
                                change nothing. */}
                            {nothingToPay(inv) ? (
                              <p className="hb-note">{t.invoices.nothingToPayNote}</p>
                            ) : !isActionable(inv) && (
                              <p className="hb-note">{t.invoices.missingShort(missingFields(inv).join(', '))}</p>
                            )}
                            {/* Chase by text instead, for a customer who has a
                                number and no address - the reminder button
                                above cannot reach them at all. Offered only
                                where there is a number and the account is set
                                up, so it never appears as a dead control.

                                Costs the merchant money per press, so the
                                button says so rather than looking free. */}
                            {inv.payer_phone && smsUsage?.configured && !nothingToPay(inv) && (
                              <div style={{ marginTop: 6 }}>
                                <button
                                  type="button"
                                  className="hb-btn sm"
                                  onClick={() => handleSendSms(inv.id)}
                                  disabled={smsSendingId !== null || !inv.invoice_number}
                                  title={t.invoices.smsRowHint}
                                >
                                  {smsSendingId === inv.id ? t.invoices.smsSending : t.invoices.smsRowButton}
                                </button>
                                {smsRowMsg[inv.id] && (
                                  <p className="hb-note" style={{ color: smsRowMsg[inv.id].ok ? '#15803d' : '#b45309' }}>
                                    {smsRowMsg[inv.id].text(t)}
                                  </p>
                                )}
                                {inv.sms_sent_at && !smsRowMsg[inv.id] && (
                                  <p className="hb-note">{t.invoices.smsSentOn(formatDate(inv.sms_sent_at))}</p>
                                )}
                              </div>
                            )}
                            {/* The payer stopped the automatic loop by claiming
                                they had paid. If no money arrived, the merchant
                                has to be able to start it again. */}
                            {inv.payer_claimed_at && (
                              <button
                                type="button"
                                className="hb-btn sm"
                                onClick={() => handleResumeReminders(inv.id)}
                                disabled={resumingId !== null}
                                title={t.invoices.resumeHint}
                              >
                                {resumingId === inv.id ? t.invoices.resuming : t.invoices.resumeReminders}
                              </button>
                            )}
                            {msg && (
                              <p className={`hb-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text(t)}</p>
                            )}
                            {(inv.reminders_sent ?? 0) > 0 && (
                              <p className="hb-note">
                                {t.invoices.sentTimes(inv.reminders_sent ?? 0, inv.last_reminder_at ? formatDate(inv.last_reminder_at) : null)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="hb-note">-</span>
                        )}
                      </td>
                      <td data-label={t.invoices.thAction}>
                        <div>
                          {/* Nothing to settle against the bank when nothing was
                              owed. Marking such a row paid would assert a
                              payment that never happened and cannot have. */}
                          {inv.status === 'issued' && !nothingToPay(inv) ? (
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleSettle(inv.id, true)}
                              disabled={settlingId !== null}
                              title={t.invoices.markPaidHint}
                            >
                              {settlingId === inv.id ? t.invoices.marking : t.invoices.markPaid}
                            </button>
                          ) : inv.status === 'issued' ? (
                            <span className="hb-note">-</span>
                          ) : canReopen(inv.paid_source) ? (
                            // Only a manual tick can be undone. A webhook-settled
                            // row records money that really arrived, and a row
                            // closed from the merchant's accounting would simply
                            // be closed again by the next hourly pass.
                            <button
                              type="button"
                              className="hb-btn sm"
                              onClick={() => handleSettle(inv.id, false)}
                              disabled={settlingId !== null}
                            >
                              {settlingId === inv.id ? t.invoices.marking : t.invoices.undo}
                            </button>
                          ) : (
                            <span className="hb-note">-</span>
                          )}
                          {settleMsg[inv.id] && <p className="hb-msg err">{settleMsg[inv.id]}</p>}

                          {/* Only an unpaid row. A paid one records money that
                              arrived and is what a payment was reconciled
                              against - the backend refuses it, and offering a
                              button that will be refused is its own small
                              cruelty. Two presses, and the second one names the
                              invoice, because this is the one action on the
                              page that cannot be undone. */}
                          {inv.status === 'issued' && (
                            <div style={{ marginTop: 8 }}>
                              {confirmDeleteId === inv.id ? (
                                <>
                                  <p className="hb-note" style={{ color: '#b45309' }}>
                                    {t.invoices.deleteConfirm(inv.invoice_number || '-')}
                                  </p>
                                  <div className="hb-actions">
                                    <button
                                      type="button"
                                      className="hb-btn sm"
                                      onClick={() => handleDelete(inv.id)}
                                      disabled={deletingId !== null}
                                    >
                                      {deletingId === inv.id ? t.invoices.deleting : t.invoices.deleteYes}
                                    </button>
                                    <button
                                      type="button"
                                      className="hb-btn sm"
                                      onClick={() => setConfirmDeleteId(null)}
                                      disabled={deletingId !== null}
                                    >
                                      {t.invoices.sendCancel}
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="hb-btn sm"
                                  onClick={() => setConfirmDeleteId(inv.id)}
                                  title={t.invoices.deleteHint}
                                >
                                  {t.invoices.deleteRow}
                                </button>
                              )}
                              {deleteMsg[inv.id] && <p className="hb-msg err">{deleteMsg[inv.id](t)}</p>}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
