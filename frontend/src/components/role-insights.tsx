'use client';

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
  const today = karachiDay(new Date().toISOString());
  const owned = portal === 'waiter'
    ? orders.filter(order => order.created_by === me.id)
    : orders.filter(order => order.prepared_by === me.id);
  const todayOwned = owned.filter(order => karachiDay(order.created_at) === today);
  const completed = owned.filter(order => order.status === 'completed');
  const active = portal === 'waiter'
    ? owned.filter(order => ['pending', 'preparing', 'ready'].includes(order.status))
    : orders.filter(order => ['pending', 'preparing', 'ready'].includes(order.status));
  const tables = rank(owned.map(order => [order.floor_name_snapshot, order.table_name_snapshot].filter(Boolean).join(' · ') || 'Dining room'));
  const dishes = rankItems(owned);
  const seats = todayOwned.reduce((sum, order) => sum + Number(order.seats_snapshot || 0), 0);
  const sales = completed.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const preparedUnits = todayOwned.reduce((sum, order) => sum + order.items.reduce((qty, item) => qty + item.quantity, 0), 0);

  const metrics = portal === 'waiter'
    ? [
        { label: 'My orders today', value: todayOwned.length, note: 'Orders opened by you', icon: Receipt },
        { label: 'My active tables', value: active.length, note: 'Still in service', icon: TableProperties },
        { label: 'Guests seated today', value: seats, note: 'From table seat snapshots', icon: Users },
        { label: 'My settled sales', value: money(sales), note: `${completed.length} completed bills in view`, icon: TrendingUp },
      ]
    : [
        { label: 'Live kitchen queue', value: active.length, note: 'Pending, preparing and ready', icon: ChefHat },
        { label: 'My tickets today', value: todayOwned.length, note: 'Tickets started by you', icon: Receipt },
        { label: 'Units handled today', value: preparedUnits, note: 'Dish quantities on your tickets', icon: Award },
        { label: 'My completed tickets', value: completed.length, note: 'Completed orders in view', icon: TrendingUp },
      ];

  return (
    <section className="role-suite panel" aria-labelledby={`${portal}-performance-title`}>
      <div className="panel-head role-suite-head">
        <div>
          <span className="eyebrow">MY STATION PERFORMANCE</span>
          <h2 id={`${portal}-performance-title`}>{portal === 'waiter' ? 'Floor service snapshot' : 'Kitchen production snapshot'}</h2>
          <p className="muted">Live operational figures from the orders currently loaded from the backend.</p>
        </div>
        <span className="role-live-chip"><i /> Live · Asia/Karachi</span>
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
