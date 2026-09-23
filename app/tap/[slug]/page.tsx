'use client';

import { use } from 'react';
import { PayLangProvider } from '../../pay/i18n';
import TapScreen from './TapScreen';

/**
 * Where a static NFC sticker (or the QR on the till screen) points.
 *
 * The URL never changes, which is what makes a one-euro sticker enough: the
 * amount lives in `pos_requests`, entered at the counter seconds earlier, not
 * in the tag. Nothing here is personalised, so the same sticker works for every
 * customer, all day, forever.
 */
export default function TapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <PayLangProvider>
      <TapScreen slug={slug} />
    </PayLangProvider>
  );
}
