import { redirect } from 'next/navigation';
import { getSession } from '@/lib/merchant-auth';
import { queryOne } from '@/lib/db';
import PortalShell from '../../PortalShell';
import { isOnboardingComplete } from '@/lib/onboarding';

type MerchantRow = {
  stripe_account_id: string | null;
  business_country: string | null;
  business_name: string | null;
  payment_rail: string | null;
  montonio_configured: boolean;
};

// Every page in the (portal) group gets the shell chrome unconditionally —
// chrome must never depend on the request pathname, because layouts are not
// re-rendered on client-side navigation (a pathname branch here once left the
// dashboard rendered inside the bare login layout after sign-in).
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/merchant/login');

  const merchant = await queryOne<MerchantRow>(
    `SELECT stripe_account_id, business_country, business_name, payment_rail,
            (montonio_access_key IS NOT NULL AND montonio_secret_key IS NOT NULL) AS montonio_configured
     FROM merchants WHERE id = $1`,
    [session.id]
  );

  if (!isOnboardingComplete(merchant)) redirect('/merchant/onboarding');

  return <PortalShell businessName={merchant?.business_name ?? null}>{children}</PortalShell>;
}
