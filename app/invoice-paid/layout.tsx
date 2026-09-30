import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Already paid - HexaBee',
  description: 'Tell the sender this invoice has already been paid and stop the reminders.',
  // A reminder link is private to the payer who received it, and there is
  // nothing here worth indexing.
  robots: { index: false, follow: false },
};

export default function InvoicePaidLayout({ children }: { children: React.ReactNode }) {
  return children;
}
