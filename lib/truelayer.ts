import { randomUUID } from 'crypto';
import { CompactSign, importPKCS8 } from 'jose';

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

  const clientId = requiredEnv('TRUELAYER_CLIENT_ID');
  const clientSecret = requiredEnv('TRUELAYER_CLIENT_SECRET');
  const tokenRequestBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'payments',
  });

  console.log('[TrueLayer] Token request URL:', TRUELAYER_TOKEN_URL);
  console.log('[TrueLayer] Requesting new access token');
  const response = await fetch(TRUELAYER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenRequestBody,
    cache: 'no-store',
  });

  console.log('[TrueLayer] Token response status:', response.status);
  const tokenResponseText = await response.text();
  console.log('[TrueLayer] Token response body:', tokenResponseText);

  if (!response.ok) {
    const tokenError = new Error('Failed to obtain TrueLayer access token') as Error & {
      status?: number;
      tlStatus?: number;
      tlBody?: unknown;
      response?: { status?: number; data?: unknown };
    };
    tokenError.status = 502;
    tokenError.tlStatus = response.status;
    tokenError.tlBody = tokenResponseText || null;
    tokenError.response = { status: response.status, data: tokenResponseText || null };
    throw tokenError;
  }

  const data = (tokenResponseText ? JSON.parse(tokenResponseText) : {}) as { access_token?: string; expires_in?: number };
  console.log('[TrueLayer] Access token exists:', !!data.access_token);
  console.log('[TrueLayer] Access token first 50 chars:', data.access_token ? data.access_token.slice(0, 50) : null);
  console.log('[TrueLayer] Access token response', data);
  if (!data.access_token || !data.expires_in) {
    throw new Error('TrueLayer token response missing access_token or expires_in');
  }
  cachedToken = {
    value: data.access_token,
    expiresAtMs: now + data.expires_in * 1000,
  };

  return data.access_token;
}

export async function getPrivateKey(): Promise<string> {
  if (cachedPrivateKey) {
    console.log('[TrueLayer] Using cached private key');
    return cachedPrivateKey;
  }

  const envPrivateKey = process.env.TRUELAYER_PRIVATE_KEY;
  if (envPrivateKey) {
    cachedPrivateKey = envPrivateKey.replace(/\\n/g, '\n');
    console.log('[TrueLayer] Using private key from TRUELAYER_PRIVATE_KEY');
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

    if (!envPrivateKey) {
      throw error;
    }

    cachedPrivateKey = envPrivateKey.replace(/\\n/g, '\n');
    return cachedPrivateKey;
  }
}

export async function signRequest(params: {
  method: string;
  path: string;
  body: string;
  idempotencyKey: string;
}): Promise<string> {
  const privateKeyPem = await getPrivateKey();
  const kid = requiredEnv('TRUELAYER_KID');
  const privateKey = await importPKCS8(privateKeyPem, 'ES512');
  const normalizedMethod = params.method.toUpperCase();
  const normalizedPath = params.path.replace(/\/+$/, '') || '/';
  const signingPayload = [
    `${normalizedMethod} ${normalizedPath}`,
    `Idempotency-Key: ${params.idempotencyKey}`,
    params.body,
  ].join('\n');

  const jws = await new CompactSign(new TextEncoder().encode(signingPayload))
    .setProtectedHeader({
      alg: 'ES512',
      kid,
      tl_version: '2',
      tl_headers: 'Idempotency-Key',
    })
    .sign(privateKey);

  const [protectedHeader, , signature] = jws.split('.');
  return `${protectedHeader}..${signature}`;
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
