import type { Metadata } from 'next';

// What a payer sees in the tab, and what a messaging app shows when the link
// is shared. Never the portal's title.
export const metadata: Metadata = {
  title: 'Pay invoice — HexaBee',
  description: 'Pay this invoice by bank, card or wallet.',
};

export default function PayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
