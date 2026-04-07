const DEFAULT_PLUGIN_LAUNCH_TIMEOUT_MS = 1000;

type PluginPaymentData = {
  amount: string;
  iban: string;
  ref: string;
  name: string;
};

function getPluginDeepLink(paymentData: PluginPaymentData) {
  const params = new URLSearchParams({
    amount: paymentData.amount,
    iban: paymentData.iban,
    ref: paymentData.ref,
    name: paymentData.name,
  });

  return `hexabee://pay?${params.toString()}`;
}

export async function attemptHexaBeePluginLaunch(
  paymentData: PluginPaymentData,
  fallbackUrl: string,
  timeoutMs = DEFAULT_PLUGIN_LAUNCH_TIMEOUT_MS,
): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  let hasNavigatedAway = false;

  const markNavigationAway = () => {
    hasNavigatedAway = true;
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      markNavigationAway();
    }
  };

  window.addEventListener('pagehide', markNavigationAway);
  window.addEventListener('blur', markNavigationAway);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  try {
    window.location.href = getPluginDeepLink(paymentData);
  } catch {
    window.removeEventListener('pagehide', markNavigationAway);
    window.removeEventListener('blur', markNavigationAway);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.location.href = fallbackUrl;
    return;
  }

  await new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });

  window.removeEventListener('pagehide', markNavigationAway);
  window.removeEventListener('blur', markNavigationAway);
  document.removeEventListener('visibilitychange', handleVisibilityChange);

  if (!hasNavigatedAway && document.visibilityState !== 'hidden') {
    window.location.href = fallbackUrl;
  }
}
