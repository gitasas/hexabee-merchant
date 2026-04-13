import { A2ACreatePaymentRequest, A2ACreatePaymentResponse, A2AProvider } from '@/lib/a2a/types';

const SUPPORTED_PROVIDERS: readonly A2AProvider[] = ['none', 'truelayer', 'brite', 'yapily', 'prometeo'];

function normalizeProvider(value: string | undefined): A2AProvider {
  if (!value) {
    return 'none';
  }

  const normalized = value.trim().toLowerCase() as A2AProvider;
  return SUPPORTED_PROVIDERS.includes(normalized) ? normalized : 'none';
}

export function getConfiguredA2AProvider(): A2AProvider {
  return normalizeProvider(process.env.NEXT_PUBLIC_A2A_PROVIDER);
}

export async function createA2APayment(
  _request: A2ACreatePaymentRequest,
): Promise<A2ACreatePaymentResponse> {
  const provider = getConfiguredA2AProvider();

  if (provider === 'none') {
    return {
      ok: false,
      provider: 'none',
      status: 'not_configured',
      message: 'Bank payment option is being configured.',
    };
  }

  return {
    ok: false,
    provider,
    status: 'provider_pending',
    message: 'Provider pending configuration',
  };
}
