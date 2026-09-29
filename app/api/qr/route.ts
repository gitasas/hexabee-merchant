import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

// qrcode renders through Buffer, which the edge runtime does not have.
export const runtime = 'nodejs';

/**
 * PNG QR code for a HexaBee payment link.
 *
 * The Gmail extension calls this and inlines the result as a data: URI, so the
 * QR survives in mail clients that block remote images — which most of them do
 * by default, and a QR that does not render is worse than no QR at all.
 *
 * Deliberately NOT a general-purpose QR generator. An open encoder on our own
 * domain would produce a QR for any URL at all, carrying our name to whatever
 * it pointed at, so only our own pay links are accepted.
 */
const ALLOWED_HOSTS = new Set(
  [
    'checkout.hexabee.buzz',
    'staging.checkout.hexabee.buzz',
    (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_CHECKOUT_URL || '').hostname;
      } catch {
        return '';
      }
    })(),
  ].filter(Boolean)
);

export async function GET(req: NextRequest) {
  const data = req.nextUrl.searchParams.get('d') || '';
  const sizeRaw = Number(req.nextUrl.searchParams.get('s') || '260');
  const size = Number.isFinite(sizeRaw) ? Math.min(Math.max(Math.round(sizeRaw), 120), 512) : 260;

  let target: URL;
  try {
    target = new URL(data);
  } catch {
    return NextResponse.json({ error: 'd must be an absolute URL' }, { status: 400 });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return NextResponse.json({ error: 'Only HexaBee payment links can be encoded' }, { status: 400 });
  }

  try {
    const png = await QRCode.toBuffer(target.toString(), {
      type: 'png',
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        // The same link always yields the same image, and the link contains the
        // amount, so this is safe to cache hard and cheap to serve again.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('[api/qr] render failed', String(err));
    return NextResponse.json({ error: 'Could not render QR' }, { status: 500 });
  }
}
