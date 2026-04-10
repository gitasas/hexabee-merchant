/**
 * @deprecated Active TrueLayer production flow no longer uses this local file store.
 * Kept temporarily for backward compatibility with legacy/non-production paths.
 */
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

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
  truelayerPaymentId: string;
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

type PaymentsDb = {
  payments: StoredPayment[];
};

const DATA_DIR = path.join(process.cwd(), '.data');
const PAYMENTS_DB_FILE = path.join(DATA_DIR, 'payments.json');

async function ensureDbFile() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(PAYMENTS_DB_FILE, 'utf-8');
  } catch {
    const initialDb: PaymentsDb = { payments: [] };
    await writeFile(PAYMENTS_DB_FILE, JSON.stringify(initialDb, null, 2), 'utf-8');
  }
}

async function readDb(): Promise<PaymentsDb> {
  await ensureDbFile();
  const raw = await readFile(PAYMENTS_DB_FILE, 'utf-8');

  try {
    const parsed = JSON.parse(raw) as PaymentsDb;
    if (!Array.isArray(parsed.payments)) {
      return { payments: [] };
    }

    return parsed;
  } catch {
    return { payments: [] };
  }
}

async function writeDb(db: PaymentsDb) {
  await writeFile(PAYMENTS_DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

export async function createStoredPayment(input: {
  truelayerPaymentId: string;
  reference: string;
  amountInMinor: number;
  currency: string;
  paymentLink?: string;
}) {
  const db = await readDb();
  const nowIso = new Date().toISOString();

  const payment: StoredPayment = {
    id: randomUUID(),
    truelayerPaymentId: input.truelayerPaymentId,
    reference: input.reference,
    amountInMinor: input.amountInMinor,
    currency: input.currency,
    status: 'created',
    paymentLink: input.paymentLink,
    createdAt: nowIso,
    updatedAt: nowIso,
    events: [],
  };

  db.payments.unshift(payment);
  await writeDb(db);

  return payment;
}

export async function listStoredPayments() {
  const db = await readDb();
  return db.payments;
}

export async function getStoredPaymentById(id: string) {
  const db = await readDb();
  return db.payments.find((payment) => payment.id === id) ?? null;
}

export async function updateStoredPaymentByTrueLayerPaymentId(
  truelayerPaymentId: string,
  event: Omit<StoredPaymentEvent, 'receivedAt'>,
) {
  const db = await readDb();
  const payment = db.payments.find((candidate) => candidate.truelayerPaymentId === truelayerPaymentId);

  if (!payment) {
    return null;
  }

  const nowIso = new Date().toISOString();
  payment.status = event.status;
  payment.failureReason = event.failureReason;
  payment.updatedAt = nowIso;
  payment.lastWebhookAt = nowIso;
  payment.events.unshift({
    ...event,
    receivedAt: nowIso,
  });

  await writeDb(db);

  return payment;
}

export function mapTrueLayerStatusToStoredStatus(rawStatus: string | undefined): StoredPaymentStatus {
  const normalized = rawStatus?.toLowerCase();

  switch (normalized) {
    case 'authorization_required':
      return 'authorization_required';
    case 'authorizing':
      return 'authorizing';
    case 'executed':
      return 'executed';
    case 'settled':
      return 'settled';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'created':
      return 'created';
    default:
      return 'unknown';
  }
}
