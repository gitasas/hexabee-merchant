import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pay invoice — HexaBee',
  description: 'Pay this invoice by bank, card or wallet.',
};

export default function PayPreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
