import { redirect } from 'next/navigation';
import { getSession } from '@/lib/merchant-auth';
import { queryOne } from '@/lib/db';
import PortalShell from '../../PortalShell';

type MerchantRow = {
  stripe_account_id: string | null;
  business_country: string | null;
  business_name: string | null;
};

// Every page in the (portal) group gets the shell chrome unconditionally —
// chrome must never depend on the request pathname, because layouts are not
// re-rendered on client-side navigation (a pathname branch here once left the
// dashboard rendered inside the bare login layout after sign-in).
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/merchant/login');

  const merchant = await queryOne<MerchantRow>(
    'SELECT stripe_account_id, business_country, business_name FROM merchants WHERE id = $1',
    [session.id]
  );

  const onboardingComplete =
    !!merchant?.stripe_account_id &&
    !!merchant?.business_country &&
    !!merchant?.business_name;

  if (!onboardingComplete) redirect('/merchant/onboarding');

  return <PortalShell businessName={merchant?.business_name ?? null}>{children}</PortalShell>;
}
