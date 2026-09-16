import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My invoices — HexaBee',
  description: 'Find and pay the invoices sent to your email address.',
};

export default function ManoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
