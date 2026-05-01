import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '@/lib/merchant-auth';

const PUBLIC_PATHS = ['/merchant/login', '/merchant/register'];

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') ?? '';

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  if (!isPublic) {
    const session = await getSession();
    if (!session) redirect('/merchant/login');
  }

  return <>{children}</>;
}
