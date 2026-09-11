import type { Metadata } from 'next';
import './globals.css';

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
      <body>{children}</body>
    </html>
  );
}
