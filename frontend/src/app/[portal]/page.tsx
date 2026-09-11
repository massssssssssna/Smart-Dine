import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Workspace from '@/components/workspace';
import CashierWorkspace from '@/components/cashier-workspace';

export default async function Portal({ params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  if (!['manager', 'waiter', 'kitchen', 'cashier'].includes(portal)) notFound();

  const cookieStore = await cookies();
  const hasAccess = cookieStore.get('sd_access')?.value;
  const hasRefresh = cookieStore.get('sd_refresh')?.value;
  if (!hasAccess && !hasRefresh) {
    redirect('/sign-in');
  }

  return portal === 'cashier' ? <CashierWorkspace /> : <Workspace portal={portal} />;
}
