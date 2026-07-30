'use client';

// Payer-facing i18n for the public checkout pages (/pay/*, /payment-success,
// /pay-preview). Separate from the merchant portal dictionary in
// app/(merchant-portal)/i18n.tsx — these pages load no portal CSS and are seen
// by the merchant's customers, not the merchant. Shares the hb_lang storage
// key so one choice covers the whole domain in a given browser.

import { createContext, useContext, useEffect, useState } from 'react';

export type PayLang = 'en' | 'lt';

const en = {
  locale: 'en-GB',
  loading: 'Loading...',
  networkError: 'Network error',
  sessionError: 'Could not create payment session',
  redirecting: 'Redirecting...',
  // Method descriptions (names are brands and stay as-is)
  methodDescs: {
    pay_by_bank: 'Instant bank transfer',
    bacs: 'UK direct debit',
    card: 'Visa, Mastercard and more',
    google_pay: 'One-tap on Android & Chrome',
    apple_pay: 'One-tap on Apple devices',
    klarna: 'Pay in 3 interest-free instalments',
    afterpay: 'Pay in 4 instalments',
    bank_transfer: 'Manual bank transfer',
    sepa: 'EU direct debit',
    ideal: 'Netherlands instant bank payment',
    billie: 'B2B buy now pay later',
  } as Record<string, string>,
  pos: {
    title: 'In-person payment',
    invalidAmount: 'Please enter a valid amount',
    customerPays: (amount: string) => `Customer pays ${amount} (incl. processing fee)`,
    referencePlaceholder: 'Reference (optional)',
    payButton: '💳  Pay by Card / Apple Pay / Google Pay',
  },
  checkout: {
    payment: 'Payment',
    invoicePayment: 'Invoice payment',
    payTo: 'Pay to',
    payee: 'Payee',
    reference: 'Reference',
    optional: '(optional)',
    referencePlaceholder: 'e.g. INV-2024-001',
    linkReferencePlaceholder: 'e.g. Invoice #1234',
    howToPay: 'How would you like to pay?',
    pay: 'Pay',
    payAmount: (amount: string) => `Pay ${amount}`,
    soon: 'Soon',
    linkNotFound: 'Payment link not found.',
    linkUnavailable: 'Payment link unavailable',
    linkFetchError: 'Payment link not found',
    amountNotDetected: 'Amount not detected — enter manually',
    amount: 'Amount',
    sortCode: 'Sort Code',
    accountNumber: 'Account Number',
    iban: 'IBAN',
    ibanMismatch: (name: string) =>
      `⚠️ The IBAN on this invoice differs from ${name}'s registered account. Double-check before paying.`,
    feeIncluded: 'Totals include a small payment processing fee.',
    dropReading: 'Reading invoice…',
    dropDone: '✓ Invoice read — details filled in below',
    dropTitle: '📄 Got the invoice? Drop the PDF here',
    dropSub: 'or click to choose the file — amount and reference fill in automatically',
    dropReadError: 'Could not read the invoice — please enter details below.',
    dropNoAmount: 'Amount not found in the invoice — please enter it below.',
    invoiceFound: (n: string) => `✓ Invoice ${n} found — amount filled from the invoice`,
    invoicePaid: 'This invoice is already marked as paid — double-check before paying again.',
    extHintPrefix: '💡 Pay invoices often?',
    extHintLink: 'Get the HexaBee extension',
    extHintSuffix: '— invoices auto-fill right from Gmail.',
    loopPrefix: 'Run a business? Get paid like this too —',
    loopLink: 'try HexaBee',
  },
  successPage: {
    title: 'Payment successful',
    sub: 'Your payment has been processed. The merchant will receive confirmation shortly.',
    loadingReceipt: 'Loading receipt details...',
    amount: 'Amount',
    date: 'Date',
    reference: 'Reference',
    merchant: 'Merchant',
    status: 'Status',
    paid: 'Paid ✓',
    generating: 'Generating PDF...',
    download: '⬇ Download Receipt',
    unavailable: 'Receipt details unavailable.',
  },
  redirect: {
    label: 'PAYMENT UPDATE',
    successTitle: 'Payment initiated successfully',
    successSub: 'Your bank authorization has been completed. We are now waiting for final settlement confirmation.',
    failedTitle: 'Payment failed or was cancelled',
    failedSub: 'We could not complete this payment. Please return to the payment link and try again, or use another bank.',
    close: 'Close window',
  },
  preview: {
    noData: 'No invoice data found.',
    payThisInvoice: 'Pay this invoice',
    invoiceNo: 'Invoice #',
    purpose: 'Purpose',
    fillReference: 'Fill in your payment reference:',
    template: 'Template:',
    copyDetails: '⎘  Copy payment details',
    copiedDetails: '✅ Copied!',
    notOnHexabee: 'Your merchant isn\'t on HexaBee yet. Ask them to register:',
    registerLink: 'Register on HexaBee →',
    copyPayTo: 'Pay to',
    copyAmount: 'Amount',
    copyReference: 'Reference',
  },
};

export type PayDict = typeof en;

const lt: PayDict = {
  locale: 'lt-LT',
  loading: 'Kraunasi...',
  networkError: 'Tinklo klaida',
  sessionError: 'Nepavyko sukurti mokėjimo sesijos',
  redirecting: 'Nukreipiama...',
  methodDescs: {
    pay_by_bank: 'Momentinis banko pavedimas',
    bacs: 'JK tiesioginis debetas',
    card: 'Visa, Mastercard ir kt.',
    google_pay: 'Vienu palietimu Android ir Chrome',
    apple_pay: 'Vienu palietimu Apple įrenginiuose',
    klarna: 'Mokėkite 3 dalimis be palūkanų',
    afterpay: 'Mokėkite 4 dalimis',
    bank_transfer: 'Rankinis banko pavedimas',
    sepa: 'ES tiesioginis debetas',
    ideal: 'Momentinis banko mokėjimas (Nyderlandai)',
    billie: '„Pirk dabar, mokėk vėliau" verslui',
  } as Record<string, string>,
  pos: {
    title: 'Mokėjimas vietoje',
    invalidAmount: 'Įveskite teisingą sumą',
    customerPays: (amount: string) => `Klientas moka ${amount} (su apdorojimo mokesčiu)`,
    referencePlaceholder: 'Paskirtis (nebūtina)',
    payButton: '💳  Mokėti kortele / Apple Pay / Google Pay',
  },
  checkout: {
    payment: 'Mokėjimas',
    invoicePayment: 'Sąskaitos apmokėjimas',
    payTo: 'Gavėjas',
    payee: 'Gavėjas',
    reference: 'Paskirtis',
    optional: '(nebūtina)',
    referencePlaceholder: 'pvz., SF-2024-001',
    linkReferencePlaceholder: 'pvz., Sąskaita #1234',
    howToPay: 'Kaip norėtumėte mokėti?',
    pay: 'Mokėti',
    payAmount: (amount: string) => `Mokėti ${amount}`,
    soon: 'Netrukus',
    linkNotFound: 'Mokėjimo nuoroda nerasta.',
    linkUnavailable: 'Mokėjimo nuoroda nepasiekiama',
    linkFetchError: 'Mokėjimo nuoroda nerasta',
    amountNotDetected: 'Suma neaptikta — įveskite ranka',
    amount: 'Suma',
    sortCode: 'Sort code',
    accountNumber: 'Sąskaitos numeris',
    iban: 'IBAN',
    ibanMismatch: (name: string) =>
      `⚠️ Sąskaitoje nurodytas IBAN skiriasi nuo registruotos „${name}" sąskaitos. Prieš mokėdami patikrinkite.`,
    feeIncluded: 'Į sumas įskaičiuotas nedidelis mokėjimo apdorojimo mokestis.',
    dropReading: 'Skaitoma sąskaita…',
    dropDone: '✓ Sąskaita perskaityta — duomenys užpildyti žemiau',
    dropTitle: '📄 Turite sąskaitą? Įtempkite PDF čia',
    dropSub: 'arba spustelėkite ir pasirinkite failą — suma ir paskirtis užsipildys automatiškai',
    dropReadError: 'Nepavyko perskaityti sąskaitos — įveskite duomenis žemiau.',
    dropNoAmount: 'Sąskaitoje sumos rasti nepavyko — įveskite ją žemiau.',
    invoiceFound: (n: string) => `✓ Sąskaita ${n} rasta — suma užpildyta iš sąskaitos`,
    invoicePaid: 'Ši sąskaita jau pažymėta kaip apmokėta — patikrinkite prieš mokėdami dar kartą.',
    extHintPrefix: '💡 Dažnai mokate sąskaitas?',
    extHintLink: 'Įsidiekite HexaBee plėtinį',
    extHintSuffix: '— sąskaitos užsipildo tiesiai iš Gmail.',
    loopPrefix: 'Turite verslą? Gaukite mokėjimus taip pat —',
    loopLink: 'išbandykite HexaBee',
  },
  successPage: {
    title: 'Mokėjimas sėkmingas',
    sub: 'Jūsų mokėjimas apdorotas. Pardavėjas netrukus gaus patvirtinimą.',
    loadingReceipt: 'Kraunami kvito duomenys...',
    amount: 'Suma',
    date: 'Data',
    reference: 'Paskirtis',
    merchant: 'Pardavėjas',
    status: 'Būsena',
    paid: 'Apmokėta ✓',
    generating: 'Generuojamas PDF...',
    download: '⬇ Atsisiųsti kvitą',
    unavailable: 'Kvito duomenys nepasiekiami.',
  },
  redirect: {
    label: 'MOKĖJIMO BŪSENA',
    successTitle: 'Mokėjimas sėkmingai inicijuotas',
    successSub: 'Banko autorizacija baigta. Laukiame galutinio atsiskaitymo patvirtinimo.',
    failedTitle: 'Mokėjimas nepavyko arba buvo atšauktas',
    failedSub: 'Nepavyko užbaigti šio mokėjimo. Grįžkite į mokėjimo nuorodą ir bandykite dar kartą arba pasirinkite kitą banką.',
    close: 'Uždaryti langą',
  },
  preview: {
    noData: 'Sąskaitos duomenų nerasta.',
    payThisInvoice: 'Apmokėkite šią sąskaitą',
    invoiceNo: 'Sąskaitos nr.',
    purpose: 'Paskirtis',
    fillReference: 'Įveskite mokėjimo paskirtį:',
    template: 'Šablonas:',
    copyDetails: '⎘  Kopijuoti mokėjimo duomenis',
    copiedDetails: '✅ Nukopijuota!',
    notOnHexabee: 'Jūsų pardavėjas dar nenaudoja HexaBee. Pakvieskite jį registruotis:',
    registerLink: 'Registruotis HexaBee →',
    copyPayTo: 'Gavėjas',
    copyAmount: 'Suma',
    copyReference: 'Paskirtis',
  },
};

const translations: Record<PayLang, PayDict> = { en, lt };

const STORAGE_KEY = 'hb_lang';

const PayLangContext = createContext<{ lang: PayLang; setLang: (l: PayLang) => void }>({
  lang: 'en',
  setLang: () => {},
});

export function PayLangProvider({ children }: { children: React.ReactNode }) {
  // Render 'en' on server and first client paint (hydration-safe), then apply
  // the stored/browser preference. Lithuanian browsers default to LT.
  const [lang, setLangState] = useState<PayLang>('en');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'lt' || stored === 'en') setLangState(stored);
      else if (navigator.language?.toLowerCase().startsWith('lt')) setLangState('lt');
    } catch { /* localStorage unavailable — stay on default */ }
  }, []);

  function setLang(l: PayLang) {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }

  return <PayLangContext.Provider value={{ lang, setLang }}>{children}</PayLangContext.Provider>;
}

export function usePayLang(): { lang: PayLang; setLang: (l: PayLang) => void; t: PayDict } {
  const { lang, setLang } = useContext(PayLangContext);
  return { lang, setLang, t: translations[lang] };
}

/** Small EN | LT switcher — self-styled, the public pages load no portal CSS. */
export function PayLangToggle({ style }: { style?: React.CSSProperties }) {
  const { lang, setLang } = usePayLang();
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, ...style }}>
      {(['en', 'lt'] as const).map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          style={{
            padding: '3px 9px',
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: lang === l ? 'var(--brand)' : 'transparent',
            color: lang === l ? '#111' : 'var(--muted)',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
