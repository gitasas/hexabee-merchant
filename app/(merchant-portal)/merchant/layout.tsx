import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '@/lib/merchant-auth';
import { queryOne } from '@/lib/db';

const PUBLIC_PATHS = ['/merchant/login', '/merchant/register'];

type MerchantRow = {
  stripe_account_id: string | null;
  business_country: string | null;
  business_name: string | null;
};

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') ?? '';

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  if (isPublic) return <>{children}</>;

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

  return <>{children}</>;
}
