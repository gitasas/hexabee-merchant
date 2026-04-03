import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HexaBee Merchant Admin',
  description: 'Merchant admin panel prototype for HexaBee',
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
