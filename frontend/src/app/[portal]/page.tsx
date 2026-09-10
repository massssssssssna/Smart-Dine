import { notFound } from 'next/navigation';
import Workspace from '@/components/workspace';
import CashierWorkspace from '@/components/cashier-workspace';
export default async function Portal({params}:{params:Promise<{portal:string}>}){const {portal}=await params;if(!['manager','waiter','kitchen','cashier'].includes(portal))notFound();return portal==='cashier'?<CashierWorkspace/>:<Workspace portal={portal}/>;}
