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

export default function PaymentPreviewPage() {
  const banks = ['Revolut', 'SEB', 'Swedbank', 'Luminor'] as const;
  const params = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<PaymentProfile | null>(null);
  const [isLaunchingPlugin, setIsLaunchingPlugin] = useState(false);
  const [isCreatingPaymentLink, setIsCreatingPaymentLink] = useState(false);
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [paymentStep, setPaymentStep] = useState<'idle' | 'bank' | 'redirecting' | 'processing' | 'success'>('idle');

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

  useEffect(() => {
    if (paymentStep !== 'redirecting') {
      return;
    }

    const processingTimer = setTimeout(() => {
      setPaymentStep('processing');
    }, 2000);

    const successTimer = setTimeout(() => {
      setPaymentStep('success');
    }, 4000);

    return () => {
      clearTimeout(processingTimer);
      clearTimeout(successTimer);
    };
  }, [paymentStep]);

  const createPaymentLinkAndRedirect = async (bank: string) => {
    if (!scanResult || !profile || isCreatingPaymentLink) {
      return;
    }

    try {
      setIsCreatingPaymentLink(true);
      setSelectedBank(bank);
      setPaymentStep('redirecting');

      const requestBody = {
        amount: scanResult.detectedAmount,
        email: profile.email,
        name: profile.businessName,
        reference: scanResult.detectedReference,
      };

      console.log('[PaymentPage] Creating payment link', requestBody);

      const response = await fetch('/api/create-payment-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const result = (await response.json()) as { payment_link?: string; error?: string; details?: string };
      console.log('[PaymentPage] create-payment-link response', result);

      if (!response.ok || !result.payment_link) {
        console.error('[PaymentPage] Failed to create payment link', result);
        setPaymentStep('bank');
        return;
      }

      window.location.href = result.payment_link;
    } catch (error) {
      console.error('[PaymentPage] Error creating payment link', error);
      setPaymentStep('bank');
    } finally {
      setIsCreatingPaymentLink(false);
    }
  };

  const closeFlow = () => {
    setPaymentStep('idle');
    setSelectedBank(null);
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
                  onClick={() => setPaymentStep('bank')}
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
            <p style={{ margin: '0.55rem 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
              Opens HexaBee app with pre-filled payment details
            </p>

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
                  animation: 'fadeIn 220ms ease',
                }}
              >
                <section
                  className="card"
                  style={{
                    width: '100%',
                    maxWidth: '420px',
                    padding: '1.2rem',
                    display: 'grid',
                    gap: '0.85rem',
                    animation: 'slideUp 250ms ease',
                  }}
                >
                  {paymentStep === 'bank' && (
                    <>
                      <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Choose your bank</h2>
                      <p style={{ margin: 0, color: 'var(--muted)' }}>
                        Select your bank to continue the A2A payment flow.
                      </p>
                      <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.4rem' }}>
                        {banks.map((bank) => (
                          <button
                            key={bank}
                            type="button"
                            onClick={() => createPaymentLinkAndRedirect(bank)}
                            disabled={isCreatingPaymentLink}
                            style={{
                              border: '1px solid var(--border)',
                              borderRadius: '10px',
                              padding: '0.75rem 0.9rem',
                              background: '#fff',
                              color: 'var(--text)',
                              fontWeight: 700,
                              textAlign: 'left',
                              cursor: isCreatingPaymentLink ? 'wait' : 'pointer',
                              opacity: isCreatingPaymentLink ? 0.8 : 1,
                            }}
                          >
                            {bank}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={closeFlow}
                        disabled={isCreatingPaymentLink}
                        style={{
                          marginTop: '0.3rem',
                          border: '1px solid var(--border)',
                          borderRadius: '10px',
                          padding: '0.7rem 0.95rem',
                          background: 'transparent',
                          color: 'var(--text)',
                          fontWeight: 600,
                          cursor: isCreatingPaymentLink ? 'not-allowed' : 'pointer',
                          opacity: isCreatingPaymentLink ? 0.6 : 1,
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}

                  {(paymentStep === 'redirecting' || paymentStep === 'processing') && (
                    <div style={{ display: 'grid', gap: '0.85rem', justifyItems: 'center', textAlign: 'center' }}>
                      <span
                        aria-hidden
                        style={{
                          width: '34px',
                          height: '34px',
                          borderRadius: '999px',
                          border: '3px solid #e5e7eb',
                          borderTopColor: 'var(--brand)',
                          animation: 'spin 900ms linear infinite',
                        }}
                      />
                      <h2 style={{ margin: 0, fontSize: '1.2rem' }}>
                        {paymentStep === 'redirecting' ? 'Redirecting to your bank...' : 'Processing payment...'}
                      </h2>
                      <p style={{ margin: 0, color: 'var(--muted)' }}>
                        {selectedBank ? `${selectedBank} authorization in progress.` : 'Authorization in progress.'}
                      </p>
                    </div>
                  )}

                  {paymentStep === 'success' && (
                    <>
                      <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Payment successful ✅</h2>
                      <div
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: '10px',
                          padding: '0.9rem',
                          display: 'grid',
                          gap: '0.65rem',
                        }}
                      >
                        <div>
                          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Amount</p>
                          <p style={{ margin: '0.2rem 0 0', fontWeight: 700 }}>€120.50</p>
                        </div>
                        <div>
                          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Merchant name</p>
                          <p style={{ margin: '0.2rem 0 0', fontWeight: 700 }}>{profile.businessName}</p>
                        </div>
                        <div>
                          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Reference</p>
                          <p style={{ margin: '0.2rem 0 0', fontWeight: 700 }}>{scanResult?.detectedReference}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={closeFlow}
                        style={{
                          border: 'none',
                          borderRadius: '10px',
                          padding: '0.8rem 1rem',
                          background: 'var(--brand)',
                          color: '#111827',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Back to merchant
                      </button>
                    </>
                  )}
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
