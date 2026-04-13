export type A2AProvider = 'none' | 'truelayer' | 'brite' | 'yapily' | 'prometeo';

export type A2ACreatePaymentRequest = {
  amount: string | number;
  currency?: string;
  email?: string;
  name?: string;
  iban?: string;
  reference?: string;
  selectedBank?: string;
};

export type A2ACreatePaymentStatus = 'not_configured' | 'provider_pending';

export type A2ACreatePaymentResponse = {
  ok: boolean;
  provider: A2AProvider;
  status: A2ACreatePaymentStatus;
  message: string;
  payment_link?: string;
};
