import { createSign, randomUUID } from 'crypto';

const TRUELAYER_TOKEN_URL = 'https://auth.truelayer-sandbox.com/connect/token';
const SECRET_PROJECT_ID = '265469249894';
const PRIVATE_KEY_SECRET_NAME = 'TRUELAYER_PRIVATE_KEY';

let cachedToken: { value: string; expiresAtMs: number } | null = null;
let cachedPrivateKey: string | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 30_000) {
    console.log('[TrueLayer] Using cached access token');
    return cachedToken.value;
  }

  console.log('[TrueLayer] Requesting new access token');
  const response = await fetch(TRUELAYER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: requiredEnv('TRUELAYER_CLIENT_ID'),
      client_secret: requiredEnv('TRUELAYER_CLIENT_SECRET'),
      scope: 'payments',
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get TrueLayer access token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  console.log('[TrueLayer] Access token response', data);
  cachedToken = {
    value: data.access_token,
    expiresAtMs: now + data.expires_in * 1000,
  };

  return data.access_token;
}

export async function getPrivateKey(): Promise<string> {
  if (cachedPrivateKey) {
    console.log('[TrueLayer] Using cached private key from Secret Manager');
    return cachedPrivateKey;
  }

  try {
    console.log('[TrueLayer] Loading private key from Secret Manager');
    const accessToken = await getGoogleAccessToken();
    const secretResponse = await fetch(
      `https://secretmanager.googleapis.com/v1/projects/${SECRET_PROJECT_ID}/secrets/${PRIVATE_KEY_SECRET_NAME}/versions/latest:access`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      },
    );

    if (!secretResponse.ok) {
      const errorText = await secretResponse.text();
      throw new Error(`Failed to read secret from Secret Manager: ${secretResponse.status} ${errorText}`);
    }

    const payload = (await secretResponse.json()) as { payload?: { data?: string } };
    const encoded = payload.payload?.data;
    if (!encoded) {
      throw new Error('TrueLayer private key secret payload is empty');
    }

    const secretData = Buffer.from(encoded, 'base64').toString('utf-8');
    cachedPrivateKey = secretData.replace(/\\n/g, '\n');
    return cachedPrivateKey;
  } catch (error) {
    console.error('[TrueLayer] Secret Manager private key load failed, falling back to TRUELAYER_PRIVATE_KEY', error);

    const envPrivateKey = process.env.TRUELAYER_PRIVATE_KEY;
    if (!envPrivateKey) {
      throw error;
    }

    cachedPrivateKey = envPrivateKey.replace(/\\n/g, '\n');
    return cachedPrivateKey;
  }
}

export async function signRequest(payload: string): Promise<string> {
  const privateKey = await getPrivateKey();
  const signer = createSign('RSA-SHA256');
  signer.update(payload);
  signer.end();

  const signature = signer.sign(privateKey, 'base64');
  return signature;
}

export function createIdempotencyKey(): string {
  return randomUUID();
}

async function getGoogleAccessToken(): Promise<string> {
  const manualToken = process.env.GOOGLE_ACCESS_TOKEN;
  if (manualToken) {
    console.log('[TrueLayer] Using GOOGLE_ACCESS_TOKEN for Secret Manager request');
    return manualToken;
  }

  console.log('[TrueLayer] Requesting GCP metadata identity token');
  const metadataResponse = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: {
      'Metadata-Flavor': 'Google',
    },
    cache: 'no-store',
  });

  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    throw new Error(`Failed to fetch Google access token from metadata server: ${metadataResponse.status} ${errorText}`);
  }

  const data = (await metadataResponse.json()) as { access_token: string };
  if (!data.access_token) {
    throw new Error('Google metadata server returned an empty access token');
  }

  return data.access_token;
}
