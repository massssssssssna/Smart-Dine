import type { Metadata } from 'next';
import './globals.css';
import './stitch.css';
export const metadata: Metadata = {title:'Smart Dine | Restaurant Operations',description:'Your restaurant, working in harmony.'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
