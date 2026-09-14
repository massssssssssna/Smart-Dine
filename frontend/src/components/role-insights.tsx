'use client';

import { useMemo, useState } from 'react';
import { Award, ChefHat, Receipt, TableProperties, TrendingUp, Users } from 'lucide-react';
import { money, Order, Profile } from '@/lib/api';

type StationPortal = 'waiter' | 'kitchen';

type RankedValue = { label: string; value: number };

function karachiDay(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function rank(values: string[]): RankedValue[] {
  const totals = new Map<string, number>();
  values.filter(Boolean).forEach(value => totals.set(value, (totals.get(value) || 0) + 1));
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 4);
}

function rankItems(orders: Order[]): RankedValue[] {
  const totals = new Map<string, number>();
  orders.forEach(order => order.items.forEach(item => {
    const name = item.name_snapshot || item.name || 'Menu item';
    totals.set(name, (totals.get(name) || 0) + item.quantity);
  }));
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 4);
}

function Leaderboard({ title, items, suffix }: { title: string; items: RankedValue[]; suffix: string }) {
  const max = Math.max(...items.map(item => item.value), 1);
  return (
    <div className="role-leaderboard">
      <h4>{title}</h4>
      {items.length ? items.map((item, index) => (
        <div className="role-rank" key={item.label}>
          <span className="role-rank-number">{index + 1}</span>
          <div>
            <div className="role-rank-label"><strong>{item.label}</strong><span>{item.value} {suffix}</span></div>
            <span className="role-rank-track"><i style={{ width: `${Math.max(12, (item.value / max) * 100)}%` }} /></span>
          </div>
        </div>
      )) : <p className="muted small">Activity will appear here after this station completes its first order.</p>}
    </div>
  );
}

export function RoleInsights({ portal, me, orders }: { portal: StationPortal; me: Profile; orders: Order[] }) {
  const [range, setRange] = useState<'today' | '7d' | '30d' | '90d' | '180d'>('30d');
  const today = karachiDay(new Date().toISOString());
  const owned = portal === 'waiter'
    ? orders.filter(order => order.created_by === me.id)
    : orders.filter(order => order.prepared_by === me.id);
  const days = range === 'today' ? 1 : Number.parseInt(range, 10);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - (days - 1)); cutoff.setHours(0, 0, 0, 0);
  const periodOwned = owned.filter(order => range === 'today' ? karachiDay(order.created_at) === today : new Date(order.created_at) >= cutoff);
  const completed = periodOwned.filter(order => order.status === 'completed');
  const active = portal === 'waiter'
    ? owned.filter(order => ['pending', 'preparing', 'ready'].includes(order.status))
    : orders.filter(order => ['pending', 'preparing', 'ready'].includes(order.status));
  const tables = rank(periodOwned.map(order => [order.floor_name_snapshot, order.table_name_snapshot].filter(Boolean).join(' · ') || 'Dining room'));
  const dishes = rankItems(periodOwned);
  const seats = periodOwned.reduce((sum, order) => sum + Number(order.seats_snapshot || 0), 0);
  const sales = completed.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const preparedUnits = periodOwned.reduce((sum, order) => sum + order.items.reduce((qty, item) => qty + item.quantity, 0), 0);
  const rangeLabel = range === 'today' ? 'today' : `last ${days} days`;
  const trend = useMemo(() => {
    const points = new Map<string, number>();
    for (let i = Math.min(days, 30) - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); points.set(karachiDay(d.toISOString()), 0); }
    completed.forEach(order => { const key = karachiDay(order.completed_at || order.created_at); if (points.has(key)) points.set(key, (points.get(key) || 0) + (portal === 'waiter' ? Number(order.total || 0) : 1)); });
    return [...points.entries()];
  }, [completed, days, portal]);
  const maxTrend = Math.max(1, ...trend.map(([, value]) => value));

  const metrics = portal === 'waiter'
    ? [
        { label: `My orders · ${rangeLabel}`, value: periodOwned.length, note: 'Orders opened by you', icon: Receipt },
        { label: 'My active tables', value: active.length, note: 'Still in service', icon: TableProperties },
        { label: `Guests · ${rangeLabel}`, value: seats, note: 'From table seat snapshots', icon: Users },
        { label: 'My settled sales', value: money(sales), note: `${completed.length} paid orders · ${rangeLabel}`, icon: TrendingUp },
      ]
    : [
        { label: 'Live kitchen queue', value: active.length, note: 'Pending, preparing and ready', icon: ChefHat },
        { label: `My tickets · ${rangeLabel}`, value: periodOwned.length, note: 'Tickets handled by you', icon: Receipt },
        { label: `Units · ${rangeLabel}`, value: preparedUnits, note: 'Dish quantities on your tickets', icon: Award },
        { label: 'My completed tickets', value: completed.length, note: `Completed · ${rangeLabel}`, icon: TrendingUp },
      ];

  return (
    <section className="role-suite panel" aria-labelledby={`${portal}-performance-title`}>
      <div className="panel-head role-suite-head">
        <div>
          <span className="eyebrow">MY STATION PERFORMANCE</span>
          <h2 id={`${portal}-performance-title`}>{portal === 'waiter' ? 'Floor service snapshot' : 'Kitchen production snapshot'}</h2>
          <p className="muted">Live operational figures from the orders currently loaded from the backend.</p>
        </div>
        <div className="period-switch" aria-label="Performance period">
          {([['today','Today'],['7d','7 days'],['30d','30 days'],['90d','3 months'],['180d','6 months']] as const).map(([value,label])=><button key={value} className={range===value?'selected':''} onClick={()=>setRange(value)}>{label}</button>)}
        </div>
      </div>
      <div className="role-trend">
        <div><strong>{portal === 'waiter' ? 'Daily settled sales' : 'Daily completed tickets'}</strong><span>{rangeLabel} · hover a bar for the exact figure</span></div>
        <div className="role-trend-bars">{trend.map(([day,value])=><span key={day} title={`${day}: ${portal === 'waiter' ? money(value) : `${value} tickets`}`}><i style={{height:`${Math.max(value ? 10 : 2,(value/maxTrend)*100)}%`}}/></span>)}</div>
      </div>
      <div className="role-metric-grid">
        {metrics.map(({ label, value, note, icon: Icon }) => (
          <article className="role-metric" key={label}>
            <span className="role-metric-icon"><Icon size={17} /></span>
            <div><small>{label}</small><strong>{value}</strong><span>{note}</span></div>
          </article>
        ))}
      </div>
      <div className="role-ranking-grid">
        <Leaderboard
          title={portal === 'waiter' ? 'Tables you serve most' : 'Stations handled most'}
          items={tables}
          suffix="orders"
        />
        <Leaderboard
          title={portal === 'waiter' ? 'Items sold most' : 'Dishes prepared most'}
          items={dishes}
          suffix="units"
        />
      </div>
    </section>
  );
}
