export type StoredPaymentStatus =
  | 'created'
  | 'authorization_required'
  | 'authorizing'
  | 'executed'
  | 'settled'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type StoredPaymentEvent = {
  eventId?: string;
  receivedAt: string;
  type?: string;
  status: StoredPaymentStatus;
  failureReason?: string;
  payload: unknown;
};

export type StoredPayment = {
  id: string;
  providerPaymentId: string;
  reference: string;
  amountInMinor: number;
  currency: string;
  status: StoredPaymentStatus;
  failureReason?: string;
  paymentLink?: string;
  createdAt: string;
  updatedAt: string;
  lastWebhookAt?: string;
  events: StoredPaymentEvent[];
};

export type CreateStoredPaymentInput = {
  providerPaymentId: string;
  reference: string;
  amountInMinor: number;
  currency: string;
  paymentLink?: string;
};
