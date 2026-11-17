/**
 * A payer came for an invoice we do not have yet - ask the merchant's Rivilė
 * now (2026-11-17).
 *
 * The case it exists for: SB „Žaluma"'s bookkeeper sends the month straight
 * from Rivilė, payers pay within minutes, and HexaBee's daily import has not
 * run - so the payer inbox would answer "nothing for this address" and a `?r=`
 * link would find no invoice, to a payer holding that invoice in their hand.
 *
 * - The backend decides everything: whether this merchant imports from Rivilė
 *   at all, and the per-merchant rate limit that keeps these PUBLIC routes
 *   from running up the merchant's Rivilė bill. This only asks.
 * - ⚠️ **Bounded wait, and silence on failure.** A payer is waiting on the
 *   reply, so it gives up after `TIMEOUT_MS`; and whatever goes wrong, the
 *   answer is 0, so the caller simply carries on as before - a payer must
 *   never lose the manual form because Rivilė was slow.
 *
 * Returns how many invoices were brought in; the caller looks again only
 * when it is more than zero.
 */
const TIMEOUT_MS = 9000;

export async function importOnDemand(slug: string, number?: string | null): Promise<number> {
  const baseUrl = process.env.ADMIN_API_BASE_URL?.trim().replace(/\/$/, '');
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !token || !slug) return 0;
  try {
    const res = await fetch(`${baseUrl}/api/plugin/merchant-rivile/import-on-demand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      body: JSON.stringify({ slug: slug.toLowerCase(), number: number ?? null }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return 0;
    const d = await res.json().catch(() => null);
    const n = Number(d?.created ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (err) {
    console.warn('[rivile-on-demand] skipped', String(err));
    return 0;
  }
}
