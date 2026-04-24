'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  normalizePaymentProfile,
  PAYMENT_PROFILE_STORAGE_KEY,
  PaymentProfile,
  toSlug,
} from '@/lib/payment-profile';
import { attemptHexaBeePluginLaunch } from '@/lib/plugin-launch';

const PLUGIN_INSTALL_URL = 'https://hexabee.buzz/install';

type PaymentStep = 'idle' | 'method' | 'bank' | 'bank_auth' | 'redirecting' | 'processing' | 'success';

export default function PaymentPreviewPage() {
  const banks = ['Revolut', 'SEB', 'Swedbank', 'Luminor'] as const;
  const params = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<PaymentProfile | null>(null);
  const [isLaunchingPlugin, setIsLaunchingPlugin] = useState(false);
  const [isCreatingCardPayment, setIsCreatingCardPayment] = useState(false);
  const [isCreatingBankPayment, setIsCreatingBankPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('idle');
  const [bankAuthUrl, setBankAuthUrl] = useState<string | null>(null);
  const [isBankIframeLoaded, setIsBankIframeLoaded] = useState(false);

  const slug = useMemo(() => toSlug(params.slug ?? ''), [params.slug]);

  useEffect(() => {
    const rawProfile = localStorage.getItem(PAYMENT_PROFILE_STORAGE_KEY);

    if (!rawProfile) {
      setProfile(null);
      return;
    }

    try {
      const parsed = normalizePaymentProfile(JSON.parse(rawProfile));
      setProfile(parsed);
    } catch {
      setProfile(null);
    }
  }, []);

  const isMatch = useMemo(() => {
    if (!profile || !slug) {
      return false;
    }

    return toSlug(profile.publicSlug) === slug;
  }, [profile, slug]);

  const scanResult = useMemo(() => {
    if (!profile) {
      return null;
    }

    const detectedAmount = '€120.50';
    const detectedIban = profile.iban;
    const detectedReference = 'INV-2024-001';
    const mockRecognizedText = `Invoice ${detectedReference} from ${profile.businessName} amount ${detectedAmount} to ${detectedIban}`;

    let confidence = 20;

    if (detectedIban === profile.iban) {
      confidence += 50;
    }

    if (mockRecognizedText.toLowerCase().includes(profile.businessName.toLowerCase())) {
      confidence += 30;
    }

    confidence = Math.min(confidence, 100);

    let confidenceLabel = 'Low confidence';
    let confidenceColor = '#ef4444';

    if (confidence >= 80) {
      confidenceLabel = 'High confidence';
      confidenceColor = '#22c55e';
    } else if (confidence >= 50) {
      confidenceLabel = 'Medium confidence';
      confidenceColor = '#eab308';
    }

    return {
      detectedAmount,
      detectedIban,
      detectedReference,
      confidence,
      confidenceLabel,
      confidenceColor,
      canProceed: confidence >= 50,
    };
  }, [profile]);

  const handlePluginOpen = async () => {
    if (!scanResult || !profile || isLaunchingPlugin) {
      return;
    }

    setIsLaunchingPlugin(true);

    const pluginAmount = scanResult.detectedAmount.replace(/[^\d.,-]/g, '').replace(',', '.');

    await attemptHexaBeePluginLaunch(
      {
        amount: pluginAmount,
        iban: scanResult.detectedIban,
        ref: scanResult.detectedReference,
        name: profile.businessName,
      },
      PLUGIN_INSTALL_URL,
    );

    setIsLaunchingPlugin(false);
  };

  const requestBody = useMemo(
    () => ({
      amount: scanResult?.detectedAmount,
      currency: 'GBP',
      email: profile?.email,
      name: profile?.businessName,
      iban: profile?.iban,
      reference: scanResult?.detectedReference,
    }),
    [profile, scanResult],
  );

  const createCardPayment = async () => {
    if (!scanResult || !profile || isCreatingCardPayment) {
      return;
    }

    try {
      setIsCreatingCardPayment(true);
      setPaymentError(null);
      setPaymentMessage(null);
      setPaymentStep('processing');

      const apiResponse = await fetch('/api/payments/card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const response = (await apiResponse.json()) as { ok?: boolean; error?: string };
      if (!apiResponse.ok || !response.ok) {
        setPaymentError(response.error ?? 'Unable to complete card payment. Please try again.');
        setPaymentStep('method');
        return;
      }

      setPaymentStep('success');
      setPaymentMessage('Card payment completed.');
    } catch {
      setPaymentError('Unable to complete card payment. Please try again.');
      setPaymentStep('method');
    } finally {
      setIsCreatingCardPayment(false);
    }
  };

  const createBankPaymentAndAuthorize = async (bank: string) => {
    if (!scanResult || !profile || isCreatingBankPayment) {
      return;
    }

    try {
      setIsCreatingBankPayment(true);
      setPaymentError(null);
      setPaymentMessage(null);
      setPaymentStep('redirecting');
      setBankAuthUrl(null);
      setIsBankIframeLoaded(false);

      const apiResponse = await fetch('/api/payments/bank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...requestBody, selectedBank: bank }),
      });

      const response = (await apiResponse.json()) as {
        ok?: boolean;
        authUrl?: string;
        error?: string;
      };

      if (!apiResponse.ok || !response.ok || !response.authUrl) {
        setPaymentError(response.error ?? 'Unable to start bank payment. Please try again.');
        setPaymentStep('bank');
        return;
      }

      setBankAuthUrl(response.authUrl);
      setPaymentStep('bank_auth');
      setPaymentMessage('Authorize your payment in the embedded frame. If it fails, use popup fallback.');
    } catch {
      setPaymentError('Unable to start bank payment. Please try again.');
      setPaymentStep('bank');
    } finally {
      setIsCreatingBankPayment(false);
    }
  };

  const openBankAuthPopup = () => {
    if (!bankAuthUrl) {
      return;
    }

    const popup = window.open(bankAuthUrl, 'bank-auth', 'popup=yes,width=540,height=760');
    if (!popup) {
      setPaymentError('Popup was blocked. Please allow popups and try again.');
      return;
    }

    setPaymentMessage('Bank authorization opened in popup. Return here once complete.');
  };

  const closeFlow = () => {
    setPaymentStep('idle');
    setPaymentError(null);
    setPaymentMessage(null);
    setBankAuthUrl(null);
    setIsBankIframeLoaded(false);
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '1.5rem',
      }}
    >
      <section className="card" style={{ width: '100%', maxWidth: '520px', padding: '1.6rem' }}>
        {isMatch && profile ? (
          <>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem', letterSpacing: '0.04em' }}>
              HEXABEE MERCHANT PAYMENT
            </p>
            <h1 style={{ margin: '0.6rem 0 1.2rem', fontSize: '1.8rem' }}>{profile.businessName}</h1>

            <div style={{ display: 'grid', gap: '0.9rem' }}>
              <div>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>IBAN</p>
                <p style={{ margin: '0.2rem 0 0', fontWeight: 600, wordBreak: 'break-word' }}>{profile.iban}</p>
              </div>

              <div>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>Support Email</p>
                <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }}>{profile.email}</p>
              </div>
            </div>

            <p style={{ margin: '1.4rem 0 0', color: 'var(--muted)' }}>Pay this invoice securely with HexaBee</p>

            {scanResult && (
              <div
                style={{
                  marginTop: '1rem',
                  border: '1px solid var(--line)',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'grid',
                  gap: '0.75rem',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Scan Result</h2>

                <div>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Detected Amount</p>
                  <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }}>{scanResult.detectedAmount}</p>
                </div>

                <div>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Detected IBAN</p>
                  <p style={{ margin: '0.2rem 0 0', fontWeight: 600, wordBreak: 'break-word' }}>
                    {scanResult.detectedIban}
                  </p>
                </div>

                <div>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Detected Reference</p>
                  <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }}>{scanResult.detectedReference}</p>
                </div>

                <div>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Confidence Score</p>
                  <p style={{ margin: '0.2rem 0 0', fontWeight: 700 }}>{scanResult.confidence}%</p>
                </div>

                <span
                  style={{
                    justifySelf: 'start',
                    borderRadius: '999px',
                    padding: '0.25rem 0.65rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: '#111827',
                    background: scanResult.confidenceColor,
                  }}
                >
                  {scanResult.confidenceLabel}
                </span>

                <button
                  type="button"
                  onClick={() => setPaymentStep('method')}
                  disabled={!scanResult.canProceed}
                  style={{
                    marginTop: '0.25rem',
                    width: '100%',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.8rem 1rem',
                    background: 'var(--brand)',
                    color: '#111827',
                    fontWeight: 700,
                    cursor: scanResult.canProceed ? 'pointer' : 'not-allowed',
                    opacity: scanResult.canProceed ? 1 : 0.55,
                  }}
                >
                  Proceed to payment
                </button>

                {!scanResult.canProceed && (
                  <p style={{ margin: 0, color: '#ef4444', fontSize: '0.9rem' }}>
                    Please verify invoice details before paying.
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handlePluginOpen}
              disabled={isLaunchingPlugin}
              style={{
                marginTop: '1.1rem',
                width: '100%',
                border: 'none',
                borderRadius: '10px',
                padding: '0.8rem 1rem',
                background: 'var(--brand)',
                color: '#111827',
                fontWeight: 700,
                cursor: isLaunchingPlugin ? 'wait' : 'pointer',
                opacity: isLaunchingPlugin ? 0.8 : 1,
              }}
            >
              {isLaunchingPlugin ? 'Launching Plugin...' : 'Open in HexaBee Plugin'}
            </button>

            {paymentStep !== 'idle' && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(17, 24, 39, 0.45)',
                  display: 'grid',
                  placeItems: 'center',
                  padding: '1rem',
                  zIndex: 50,
                }}
              >
                <section
                  className="card"
                  style={{
                    width: '100%',
                    maxWidth: paymentStep === 'bank_auth' ? '760px' : '420px',
                    padding: '1.2rem',
                    display: 'grid',
                    gap: '0.85rem',
                  }}
                >
                  {paymentStep === 'method' && (
                    <>
                      <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Choose payment method</h2>
                      <button type="button" onClick={createCardPayment} disabled={isCreatingCardPayment}>
                        Pay by card
                      </button>
                      <button type="button" onClick={() => setPaymentStep('bank')} disabled={isCreatingCardPayment}>
                        Pay by bank
                      </button>
                      <button type="button" onClick={closeFlow}>Cancel</button>
                    </>
                  )}

                  {paymentStep === 'bank' && (
                    <>
                      <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Bank payment</h2>
                      <p style={{ margin: 0, color: 'var(--muted)' }}>Continue with bank authorization.</p>
                      <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.4rem' }}>
                        {banks.map((bank) => (
                          <button
                            key={bank}
                            type="button"
                            onClick={() => createBankPaymentAndAuthorize(bank)}
                            disabled={isCreatingBankPayment}
                          >
                            {bank}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {(paymentStep === 'redirecting' || paymentStep === 'processing') && (
                    <div style={{ display: 'grid', gap: '0.85rem', justifyItems: 'center', textAlign: 'center' }}>
                      <h2 style={{ margin: 0, fontSize: '1.2rem' }}>
                        {paymentStep === 'redirecting' ? 'Preparing bank authorization...' : 'Processing payment...'}
                      </h2>
                    </div>
                  )}

                  {paymentStep === 'bank_auth' && bankAuthUrl && (
                    <>
                      <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Authorize bank payment</h2>
                      <p style={{ margin: 0, color: 'var(--muted)' }}>
                        We first try embedded iframe auth. If blocked, use popup fallback.
                      </p>
                      <iframe
                        title="Bank authorization"
                        src={bankAuthUrl}
                        onLoad={() => setIsBankIframeLoaded(true)}
                        style={{ width: '100%', minHeight: '420px', border: '1px solid var(--line)', borderRadius: '8px' }}
                      />
                      {!isBankIframeLoaded && (
                        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
                          If this frame does not load, open the popup fallback.
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button type="button" onClick={openBankAuthPopup}>Open popup fallback</button>
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentStep('success');
                            setPaymentMessage('Bank authorization completed.');
                          }}
                        >
                          I completed bank auth
                        </button>
                      </div>
                    </>
                  )}

                  {paymentStep === 'success' && (
                    <>
                      <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Payment successful ✅</h2>
                      <button type="button" onClick={closeFlow}>Back to merchant</button>
                    </>
                  )}

                  {paymentMessage && <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>{paymentMessage}</p>}
                  {paymentError && <p style={{ margin: 0, color: '#ef4444', fontSize: '0.85rem' }}>{paymentError}</p>}
                </section>
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem', letterSpacing: '0.04em' }}>
              HEXABEE MERCHANT PAYMENT
            </p>
            <h1 style={{ margin: '0.7rem 0 0', fontSize: '1.7rem' }}>Merchant not found</h1>
          </>
        )}
      </section>
    </main>
  );
}
