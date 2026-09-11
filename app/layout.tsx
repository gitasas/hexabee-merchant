import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// globals.css asks for Inter first, but nothing ever loaded it, so every page
// rendered in whatever the OS had — San Francisco on a Mac, Segoe on Windows,
// Roboto on Android. Self-hosted through next/font so all three see the same
// face, with no request to Google at runtime.
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap' });

// The public checkout and the portal share this layout. Payer-facing routes
// set their own title in a nested layout; this is what the portal shows — and
// what a payer saw in their tab, and in a shared link's preview, until
// 2026-09-11: "Merchant admin panel prototype".
export const metadata: Metadata = {
  title: 'HexaBee',
  description: 'Get paid for invoices by card, wallet or bank.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
