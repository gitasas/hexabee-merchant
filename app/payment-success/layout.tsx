import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Payment — HexaBee',
  description: 'Your payment status and receipt.',
};

export default function PaymentSuccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
