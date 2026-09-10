'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, LockKeyhole, Eye, EyeOff, Sparkles, ChefHat, ClipboardList, Users } from 'lucide-react';
import { api, Profile } from '@/lib/api';
import { Brand, Field } from '@/components/ui';

export default function SignIn() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api('auth/login', 'POST', {
        email: f.get('email'),
        password: f.get('password'),
      });
      const user = await api<Profile>('auth/me');
      if (!user.is_active) {
        await api('auth/logout', 'POST');
        throw new Error('This account has been deactivated. Please contact your restaurant manager.');
      }
      const portal = user.role === 'manager' ? 'manager' : (user.staff_type || 'waiter');
      const portalLabel = portal === 'manager' ? 'Manager Console' : portal === 'cashier' ? 'Cashier / Billing' : portal === 'kitchen' ? 'Kitchen Display' : 'Waiter Station';
      setDestination(portalLabel);
      window.location.href = '/' + portal;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <Link href="/" className="login-brand"><Brand /></Link>
        <p className="muted center">Sign in to your restaurant workspace</p>
        <div className="login-stations-hint" style={{ display: 'flex', justifyContent: 'center', gap: '1rem', padding: '0.5rem 0 1rem', color: 'var(--muted, #94a3b8)', fontSize: '0.78rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><Users size={13} /> Manager</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><ClipboardList size={13} /> Waiter</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><ChefHat size={13} /> Kitchen</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><ClipboardList size={13} /> Cashier</span>
        </div>
