export async function postAdminJson(path: string, payload: unknown): Promise<boolean> {
  const baseUrl = process.env.ADMIN_API_BASE_URL?.trim();

  if (!baseUrl) {
    console.warn(`[Admin API] Skipping sync because ADMIN_API_BASE_URL is missing. Path: ${path}`);
    return false;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${baseUrl}${normalizedPath}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      const rawBody = await response.text();
      let parsedBody: unknown = null;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsedBody = rawBody || null;
      }

      console.error('[Admin API] Backend sync failed', {
        path: normalizedPath,
        status: response.status,
        body: parsedBody,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Admin API] Backend sync request failed', {
      path: normalizedPath,
      error,
    });
    return false;
  }
}
