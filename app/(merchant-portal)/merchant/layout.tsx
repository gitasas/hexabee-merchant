import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '@/lib/merchant-auth';
import { queryOne } from '@/lib/db';
import PortalShell from '../PortalShell';
import { LangProvider } from '../i18n';
import '../portal.css';

const PUBLIC_PATHS = ['/merchant/login', '/merchant/register'];
// Onboarding is a focused setup flow — no portal chrome around it.
const BARE_PATHS = ['/merchant/onboarding'];

type MerchantRow = {
  stripe_account_id: string | null;
  business_country: string | null;
  business_name: string | null;
};

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') ?? '';

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  if (isPublic) return <LangProvider>{children}</LangProvider>;

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

  if (!onboardingComplete && !pathname.startsWith('/merchant/onboarding')) {
    redirect('/merchant/onboarding');
  }

  if (BARE_PATHS.some(p => pathname.startsWith(p))) return <LangProvider>{children}</LangProvider>;

  return (
    <LangProvider>
      <PortalShell businessName={merchant?.business_name ?? null}>{children}</PortalShell>
    </LangProvider>
  );
}
