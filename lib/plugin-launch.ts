const DEFAULT_PLUGIN_LAUNCH_TIMEOUT_MS = 1300;

function getPluginDeepLink(slug: string) {
  return `hexabee://pay?slug=${encodeURIComponent(slug)}`;
}

export async function attemptHexaBeePluginLaunch(
  slug: string,
  timeoutMs = DEFAULT_PLUGIN_LAUNCH_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof window === 'undefined' || !slug) {
    return false;
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
    window.location.href = getPluginDeepLink(slug);
  } catch {
    window.removeEventListener('pagehide', markNavigationAway);
    window.removeEventListener('blur', markNavigationAway);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    return false;
  }

  await new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });

  window.removeEventListener('pagehide', markNavigationAway);
  window.removeEventListener('blur', markNavigationAway);
  document.removeEventListener('visibilitychange', handleVisibilityChange);

  return hasNavigatedAway || document.visibilityState === 'hidden';
}
