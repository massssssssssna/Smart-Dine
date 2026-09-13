'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, UtensilsCrossed, ChefHat, Globe, LogOut, Plus, Search, Users, BookOpen, Package, Check, Clock, ArrowRight, History, Award, Receipt, TrendingUp, ShieldCheck, LineChart, Sparkles, UserRound, CookingPot, CreditCard } from 'lucide-react';
import { api, ApiError, Profile, MenuItem, Order, StaffLedgerItem, Page, money } from '@/lib/api';
import { Brand, Badge, Empty, Modal, Field } from './ui';
import { MenuForm, OrderForm, StaffForm, CredentialsForm, RecipeForm } from './workspace-forms';
import { StockPanel } from './simple-stock';
import { TablesPanel } from './tables-panel';
import { ExpensesPanel } from './expenses-panel';
import { AnalyticsPanel } from './analytics-panel';
import { DecisionsAuditPanel } from './decisions-audit-panel';
import { ForecastsPanel } from './forecasts-panel';
import { AssistantDrawer } from './assistant-drawer';
import { RoleInsights } from './role-insights';
import { useConfirmation } from './use-confirmation';

type Editor = { kind: 'order' | 'menu' | 'staff' | 'credentials' | 'recipe'; item?: Order | MenuItem | Profile };
const nextStatus: Record<string, string> = { pending: 'preparing', preparing: 'ready', ready: 'completed' };
const labels: Record<string, string> = { preparing: 'Start preparation', ready: 'Ready for pickup', completed: 'Served & paid' };

async function loadEveryOrder(firstPage:Page<Order>,query:string):Promise<Order[]>{
  const pageSize=100;
  if(firstPage.total<=firstPage.items.length)return firstPage.items;
  const offsets:Array<number>=[];
  for(let next=firstPage.items.length;next<firstPage.total;next+=pageSize)offsets.push(next);
  const pages=await Promise.all(offsets.map(next=>api<Page<Order>>(`orders?limit=${pageSize}&offset=${next}&q=${encodeURIComponent(query)}`)));
  return [firstPage.items,...pages.map(page=>page.items)].flat();
}

export default function Workspace({ portal: initialPortal }: { portal: string }) {
  const {confirm,confirmationDialog}=useConfirmation();
  const [portal, setPortal] = useState(initialPortal);
  const [me, setMe] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [staffLedger, setStaffLedger] = useState<StaffLedgerItem[]>([]);
  const [staffSubTab, setStaffSubTab] = useState<'accounts' | 'ledger'>('accounts');
  const [orderStaffFilter, setOrderStaffFilter] = useState<string>('');
  const [orderDateRange, setOrderDateRange] = useState<'all' | '7d' | '30d' | '180d'>('all');
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [cancel, setCancel] = useState<Order | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [updated, setUpdated] = useState('');
  const [ticketFilter, setTicketFilter] = useState('all');
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Global Ctrl+K / Cmd+K shortcut to toggle AI Assistant for manager
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (portal === 'manager') {
          e.preventDefault();
          setAssistantOpen(prev => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [portal]);

  // Handle browser back/forward buttons strictly within user's assigned portal
  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname.replace(/^\//, '');
      if (me) {
        const expected = me.role === 'manager' ? 'manager' : me.staff_type;
        if (p !== expected) {
          window.location.replace('/' + expected);
          return;
        }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [me]);

  const load = useCallback(async () => {
    try {
      const user = await api<Profile>('auth/me');
      if (!user.is_active) {
        await api('auth/logout', 'POST');
        window.location.replace('/sign-in');
        return;
      }
      const expectedPortal = user.role === 'manager' ? 'manager' : user.staff_type;
      if (portal !== expectedPortal) {
        window.location.replace('/' + expectedPortal);
        return;
      }
      setMe(user);
      const isManager = user.role === 'manager';
      const orderLimit = 100;
      const [o, m] = await Promise.all([
        api<Page<Order>>(`orders?limit=${orderLimit}&offset=0&q=${encodeURIComponent(search)}`),
        api<Page<MenuItem>>('menu?limit=100'),
      ]);
      setOrders(await loadEveryOrder(o,search));
      setTotal(o.total);
      setMenu(m.items);
      if (isManager) {
        const [s, ledgerRes] = await Promise.all([
          api<Page<Profile>>('users?limit=100'),
          api<{ items: StaffLedgerItem[]; total: number }>('users/ledger/history').catch(() => ({ items: [], total: 0 })),
        ]);
        setStaff(s.items);
        setStaffLedger(ledgerRes.items);
      }
      setUpdated(new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        window.location.replace('/sign-in');
      } else {
        setError((e as Error).message);
      }
    } finally {
      setIsReady(true);
    }
  }, [portal, search]);

  // Resilient live polling every 15s without interrupting user interactions
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function transition(o: Order, status: string, reason?: string) {
    return action(() =>
      api('orders/' + o.id + '/status', 'POST', { expected_version: o.version, status, ...(reason ? { reason } : {}) }, crypto.randomUUID())
    );
  }

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    const text = (
      (o.id || '') + ' ' +
      (o.order_number || '') + ' ' +
      (o.floor_name_snapshot || '') + ' ' +
      (o.table_name_snapshot || '') + ' ' +
      (o.notes || '') + ' ' +
      (o.created_by_name || '') + ' ' +
      (o.created_by_email || '') + ' ' +
      (o.prepared_by_name || '') + ' ' +
      (o.prepared_by_email || '') + ' ' +
      (o.paid_by_name || '') + ' ' +
      (o.paid_by_email || '') + ' ' +
      o.items.map(i => i.name_snapshot || i.name || '').join(' ')
    ).toLowerCase();
    if (q && !text.includes(q)) return false;

    if (orderStaffFilter) {
      const sf = orderStaffFilter.toLowerCase();
      const matchesStaff =
        (o.created_by_email && o.created_by_email.toLowerCase() === sf) ||
        (o.created_by_name && o.created_by_name.toLowerCase() === sf) ||
        (o.prepared_by_email && o.prepared_by_email.toLowerCase() === sf) ||
        (o.prepared_by_name && o.prepared_by_name.toLowerCase() === sf) ||
        (o.paid_by_email && o.paid_by_email.toLowerCase() === sf) ||
        (o.paid_by_name && o.paid_by_name.toLowerCase() === sf);
      if (!matchesStaff) return false;
    }

    if (orderDateRange !== 'all') {
      const orderTime = new Date(o.created_at).getTime();
      const diffDays = (Date.now() - orderTime) / (1000 * 60 * 60 * 24);
      if (orderDateRange === '7d' && diffDays > 7) return false;
      if (orderDateRange === '30d' && diffDays > 30) return false;
      if (orderDateRange === '180d' && diffDays > 180) return false;
    }

    return true;
  });
  // Partitioned datasets for stations:
  const waiterOrders = me ? filtered.filter(o => o.created_by === me.id) : [];
  const waiterActive = waiterOrders.filter(o => ['pending', 'preparing', 'ready'].includes(o.status));
  const kitchenActive = filtered.filter(o => ['pending', 'preparing', 'ready'].includes(o.status));
  const historyOrders = (portal === 'waiter' ? waiterOrders : filtered).filter(o => ['completed', 'cancelled'].includes(o.status));
  const active = filtered.filter(o => !['completed', 'cancelled'].includes(o.status));

  // Recent cancellations for kitchen notice (< 10 minutes)
  const recentlyCancelled = filtered.filter(o => o.status === 'cancelled' && (Date.now() - new Date(o.created_at).getTime()) < 10 * 60 * 1000);

  const managerStats = [
    {
      label: 'Total staff',
      value: staff.filter(s => s.is_active).length,
      note: 'Active restaurant accounts',
      icon: Users,
    },
    {
      label: 'Menu offerings',
      value: menu.filter(m => m.is_active).length,
      note: 'Available on the menu',
      icon: BookOpen,
    },
    {
      label: 'Ready for pickup',
      value: orders.filter(o => o.status === 'ready').length,
      note: 'Ready for the dining room',
      icon: ChefHat,
    },
    {
      label: 'Served & paid',
      value: orders.filter(o => o.status === 'completed').length,
      note: 'Completed orders in view',
      icon: Check,
    },
  ];

  const waiterStats = [
    {
      label: 'Active Floor Orders',
      value: waiterActive.length,
      note: 'Tables assigned to you',
      icon: UtensilsCrossed,
    },
    {
      label: 'In Kitchen',
      value: waiterOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length,
      note: 'Your tickets with kitchen',
      icon: ChefHat,
    },
    {
      label: 'Ready for Pickup',
      value: waiterOrders.filter(o => o.status === 'ready').length,
      note: 'Your orders ready to serve',
      icon: Check,
    },
    {
      label: 'Served & Paid Today',
      value: waiterOrders.filter(o => o.status === 'completed').length,
      note: 'Your settled orders in view',
      icon: BookOpen,
    },
  ];

  const stats = portal === 'manager' ? managerStats : waiterStats;

  // ONLY show full-screen branded loader during initial cold authentication
  if (!isReady) {
    return (
      <main className="loading">
        <Brand />
        <p>Opening your workspace…</p>
      </main>
    );
  }

  // Once initialized, the App Shell NEVER unmounts — transitions are instant 0ms
  return (
    <div className={`app-shell station-${portal}`}>
      {confirmationDialog}
      <aside className="sidebar">
        <Link href="/"><Brand /></Link>
        <span className="nav-caption">{portal === 'manager' ? 'MANAGEMENT' : 'SERVICE ROLES'}</span>
        <nav>
          {(portal === 'manager'
            ? [
                ['overview', 'Overview', LayoutDashboard],
                ['analytics', 'Sales & Profit', TrendingUp],
                ['forecasts', 'Demand Planning', LineChart],
                ['decisions', 'Recommended Actions', ShieldCheck],
                ['staff', 'Staff management', Users],
                ['menu', 'Dishes', BookOpen],
                ['stock', 'Inventory', Package],
                ['tables', 'Tables', LayoutDashboard],
                ['expenses', 'Operating Expenses', Receipt],
              ]
            : portal === 'kitchen'
            ? [
                ['overview', 'Dashboard', LayoutDashboard],
                ['history', 'Order History', Clock],
              ]
            : [
                ['overview', 'Dashboard', LayoutDashboard],
                ['history', 'Order History', Clock],
              ]
          ).map(([path, label, Icon]) => {
            const I = Icon as typeof Users;
            return (
              <button
                key={path as string}
                type="button"
                onClick={() => {
                  setTab(path as string);
                  setOffset(0);
                  setSearch('');
                }}
                className={`nav-link ${tab === path ? 'active' : ''}`}
                aria-current={tab === path ? 'page' : undefined}
              >
                <I size={18} />
                {label as string}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{me?.full_name?.slice(0, 1) || 'S'}</span>
          <div>
            <strong>{me?.full_name || 'Your account'}</strong>
            <small>{me?.role === 'manager' ? 'General Manager' : me?.staff_type}</small>
          </div>
          <button
            className="icon"
            aria-label="Sign out"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api('auth/logout', 'POST');
                window.location.href = '/sign-in';
              })
            }
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <div className="workspace">
        <main className="workspace-main">
          <div className={`page-heading ${portal !== 'manager' ? 'station-banner' : ''}`}>
            <div>
              <span className="eyebrow">
                {portal === 'manager'
                  ? 'EXECUTIVE SERVICE CONSOLE'
                  : portal === 'waiter'
                  ? 'DINING ROOM SERVICE'
                  : 'LIVE KITCHEN OPERATIONS'}
              </span>
              <h1>
                {portal === 'manager'
                  ? (tab === 'analytics' ? 'Sales, Costs & Profit' : tab === 'forecasts' ? 'Demand & Kitchen Planning' : tab === 'decisions' ? 'Recommended Actions & Change History' : tab === 'expenses' ? 'Operating Expenses' : tab === 'tables' ? 'Tables & Seating' : tab === 'stock' ? 'Inventory & Stock' : 'Dashboard')
                  : portal === 'waiter'
                  ? (tab === 'history' ? 'Dining Room History' : 'Waiter Station')
                  : (tab === 'history' ? 'Culinary Dispatch History' : 'Kitchen Live Board')}
              </h1>
              {portal !== 'manager' && (
                <span className="station-person">
                  {portal === 'waiter' ? me?.full_name : 'High-speed culinary dispatch'}{' '}
                  <span>{portal === 'waiter' ? 'ON DUTY' : 'LIVE STATION'}</span>
                </span>
              )}
              <p className="muted small">
                {updated ? `Last refreshed ${updated} · Live sync active` : 'Connecting to your restaurant'}
              </p>
            </div>
            {portal === 'waiter' && (
              <button className="gold" onClick={() => setEditor({ kind: 'order' })}>
                <Plus size={17} /> Take new order
              </button>
            )}
            {portal === 'manager' && (
              <div className="header-manager-actions">
                <button
                  type="button"
                  className="assistant-header-btn"
                  onClick={() => setAssistantOpen(true)}
                  title="Ask Smart Dine (Ctrl+K)"
                >
                  <Sparkles size={16} className="sparkle-icon" />
                  <span>Ask Smart Dine</span>
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="error" role="alert">
              {error} <button className="text-button" onClick={() => void load()}>Retry</button>
            </div>
          )}

          {tab === 'overview' && (
            <>
              {portal !== 'kitchen' && (
                <div className="stats">
                  {stats.map(({ label, value, note, icon: Icon }) => (
                    <article key={label}>
                      <div>
                        <span>{label}</span>
                        <Icon size={19} />
                      </div>
                      <strong>{value}</strong>
                      <small>{note}</small>
                    </article>
                  ))}
                </div>
              )}
              {portal === 'kitchen' && (
                <>
                  {recentlyCancelled.length > 0 && (
                    <div className="error" style={{ background: '#fff4f2', borderColor: '#f0b7b3', color: '#9c2621', marginBottom: '18px' }}>
                      <strong>Notice:</strong> {recentlyCancelled.length} order(s) recently cancelled — halt preparation for:{' '}
                      {recentlyCancelled.map(o => `${o.order_number || o.id.slice(0, 8)} (${[o.floor_name_snapshot, o.table_name_snapshot].filter(Boolean).join(' · ') || 'Dining room'})`).join(', ')}.
                    </div>
                  )}
                  <div className="ticket-filters">
                    {[
                      ['all', 'All active orders', kitchenActive.length],
                      ['pending', 'Pending dispatch', kitchenActive.filter(o => o.status === 'pending').length],
                      ['preparing', 'In preparation', kitchenActive.filter(o => o.status === 'preparing').length],
                      ['ready', 'Ready & plated', kitchenActive.filter(o => o.status === 'ready').length],
                    ].map(([status, label, count]) => (
                      <button
                        key={status as string}
                        type="button"
                        className={ticketFilter === status ? 'selected' : ''}
                        onClick={() => setTicketFilter(status as string)}
                      >
                        {label as string}
                        <span>{count as number}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {me && (portal === 'waiter' || portal === 'kitchen') && (
                <RoleInsights portal={portal} me={me} orders={orders} />
              )}

              <div className="toolbar" style={{ flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h2>{portal === 'manager' ? 'Operations & Historical Orders' : portal === 'waiter' ? 'Active Floor Orders' : 'Kitchen Tickets'}</h2>
                  {portal === 'manager' && (
                    <p className="muted" style={{ margin: 0, fontSize: '11px' }}>
                      Complete 6-month order history · Waiter, kitchen and cashier names are kept with every order
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {orderStaffFilter && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#e1fae7', padding: '5px 10px', borderRadius: '4px', fontSize: '11px', border: '1px solid #c4e8cf' }}>
                      <span>Staff: <strong>{orderStaffFilter}</strong></span>
                      <button style={{ padding: '0 4px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => setOrderStaffFilter('')}>✕</button>
                    </div>
                  )}
                  {portal === 'manager' && (
                    <div className="ticket-filters" style={{ margin: 0 }}>
                      {(['all', '180d', '30d', '7d'] as const).map(range => (
                        <button
                          key={range}
                          type="button"
                          className={orderDateRange === range ? 'selected' : ''}
                          onClick={() => setOrderDateRange(range)}
                          style={{ padding: '5px 9px', fontSize: '11px' }}
                        >
                          {range === 'all' ? 'All (6 Mo)' : range === '180d' ? 'Last 180d' : range === '30d' ? 'Last 30d' : 'Last 7d'}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="search" style={{ margin: 0 }}>
                    <Search size={16} />
                    <input
                      aria-label="Search orders"
                      placeholder="Search order, staff, table…"
                      value={search}
                      onChange={e => {setSearch(e.target.value);setOffset(0);}}
                    />
                  </label>
                </div>
              </div>

              {portal === 'manager' ? (
                <div className="dashboard-grid">
                  <section className="panel table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Floor / Table</th>
                          <th>Staff Attribution</th>
                          <th>Items Ordered</th>
                          <th>Date & Time</th>
                          <th>Status</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(o => (
                          <tr key={o.id}>
                            <td>
                              <button className="text-button" style={{ fontWeight: 600 }} onClick={() => setEditor({ kind: 'order', item: o })}>
                                {o.order_number||o.id.slice(0, 10)}
                              </button>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600 }}>
                                {[o.floor_name_snapshot ? `Floor ${o.floor_name_snapshot}` : '', o.table_name_snapshot].filter(Boolean).join(' · ') || 'Dining room'}
                                {o.seats_snapshot ? <span className="muted" style={{ fontSize: '10px' }}> ({o.seats_snapshot} seats)</span> : null}
                              </div>
                              {o.notes && <div className="muted" style={{ fontSize: '10px', marginTop: '2px' }}>“{o.notes}”</div>}
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px' }}>
                                <span title={`Waiter account: ${o.created_by_email || 'N/A'}`}>
                                  <UserRound size={12}/> <strong style={{ color: '#03241a' }}>{o.created_by_name || 'Waiter'}</strong>
                                </span>
                                {o.prepared_by_name && (
                                  <span className="muted" title={`Chef account: ${o.prepared_by_email || 'N/A'}`} style={{ fontSize: '10px' }}>
                                    <CookingPot size={11}/> Chef: {o.prepared_by_name}
                                  </span>
                                )}
                                {o.paid_by_name && (
                                  <span className="muted" title={`Cashier account: ${o.paid_by_email || 'N/A'}`} style={{ fontSize: '10px' }}>
                                    <CreditCard size={11}/> Cashier: {o.paid_by_name}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              {o.items.map((i, idx) => (
                                <div key={idx} style={{ fontSize: '11px' }}>
                                  {i.quantity} × {i.name_snapshot || i.name}
                                </div>
                              ))}
                            </td>
                            <td>
                              <div style={{ fontWeight: 500 }}>
                                {new Date(o.created_at).toLocaleDateString('en-PK', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                  timeZone: 'Asia/Karachi',
                                })}
                              </div>
                              <div className="muted" style={{ fontSize: '10px' }}>
                                {new Date(o.created_at).toLocaleTimeString('en-PK', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZone: 'Asia/Karachi',
                                })}
                              </div>
                            </td>
                            <td><Badge status={o.status} /></td>
                            <td style={{ fontWeight: 600 }}>{money(o.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && <Empty>No orders yet. Take your first order to begin service.</Empty>}
                  </section>
                  <aside className="right-column">
                    <section className="panel">
                      <div className="panel-head">
                        <h3>Active Brigade</h3>
                        <button className="text-button" onClick={() => setTab('staff')}>Manage all →</button>
                      </div>
                      {staff
                        .filter(s => s.is_active)
                        .slice(0, 5)
                        .map(s => (
                          <div className="person" key={s.id}>
                            <span className="avatar">{s.full_name[0]}</span>
                            <div>
                              <strong>{s.full_name}</strong>
                              <small>{s.role === 'manager' ? 'Manager' : s.staff_type}</small>
                            </div>
                            <span className="dot" />
                          </div>
                        ))}
                    </section>
                    <section className="panel">
                      <h3>Signature Items</h3>
                      {menu
                        .filter(m => m.is_active)
                        .slice(0, 5)
                        .map((m, i) => (
                          <div className="menu-preview" key={m.id}>
                            <span>0{i + 1}</span>
                            <div>
                              <strong>{m.name}</strong>
                              <small>{m.category}</small>
                            </div>
                            <b>{money(m.selling_price)}</b>
                          </div>
                        ))}
                      {!menu.length && <Empty>Add your menu to start taking orders.</Empty>}
                      <button className="soft full" onClick={() => setTab('menu')}>View full menu →</button>
                    </section>
                  </aside>
                </div>
              ) : portal === 'kitchen' ? (
                <div className="kanban">
                  {[
                    ['pending', 'Pending dispatch'],
                    ['preparing', 'In preparation'],
                    ['ready', 'Ready & plated'],
                  ].filter(([status]) => ticketFilter === 'all' || status === ticketFilter).map(([status, title]) => {
                    const stageTickets = kitchenActive.filter(o => o.status === status);
                    return (
                      <section key={status}>
                        <div className="kanban-title">
                          <h3>{title}</h3>
                          <Badge status={String(stageTickets.length) + ' tickets'} />
                        </div>
                        {stageTickets.map(o => (
                          <OrderCard
                            key={o.id}
                            order={o}
                            busy={busy}
                            onNext={['pending','preparing'].includes(o.status) ? () => void transition(o, nextStatus[o.status]) : undefined}
                            onCancel={() => setCancel(o)}
                          />
                        ))}
                        {!stageTickets.length && <Empty>No tickets in this station.</Empty>}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="order-grid">
                  {waiterActive.map(o => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      busy={busy}
                      onEdit={() => setEditor({ kind: 'order', item: o })}
                      onNext={!me?.cashier_billing_enabled && o.status==='ready' ? ()=>void transition(o,'completed') : undefined}
                      onCancel={() => setCancel(o)}
                    />
                  ))}
                  {!waiterActive.length && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <Empty>No open orders on the dining floor. Click &apos;Take new order&apos; to seat guests.</Empty>
                    </div>
                  )}
                </div>
              )}

              <div className="pagination">
                {portal === 'waiter' ? (
                  <>
                    <span>{waiterActive.length} active dining table(s)</span>
                    <button className="soft" type="button" onClick={() => { setTab('history'); setOffset(0); }}>
                      View completed shift history ({historyOrders.length}) →
                    </button>
                  </>
                ) : portal === 'kitchen' ? (
                  <>
                    <span>{kitchenActive.length} active kitchen ticket(s)</span>
                    <button className="soft" type="button" onClick={() => { setTab('history'); setOffset(0); }}>
                      View culinary history log ({historyOrders.length}) →
                    </button>
                  </>
                ) : (
                  <>
                    <span>{total} orders · Complete matching history loaded</span>
                  </>
                )}
              </div>
              <section className="service-flow panel"><div className="panel-head"><h3>Service Station Flow</h3><span className="muted small">{(portal === 'waiter' ? waiterActive : portal === 'kitchen' ? kitchenActive : active).length} active in view</span></div><div className="flow-track">{['pending','preparing','ready','completed','cancelled'].map(status => {const count=orders.filter(o=>o.status===status).length;return count>0?<span key={status} className={status} style={{flex:count}} title={`${status}: ${count}`}/>:null;})}</div><div className="flow-legend">{['pending','preparing','ready','completed','cancelled'].map(status=><span key={status}><i className={status}/>{status} ({orders.filter(o=>o.status===status).length})</span>)}</div></section>
            </>
          )}

          {tab === 'history' && (
            <section className="panel table-wrap">
              <div className="panel-head" style={{ padding: '22px 22px 14px' }}>
                <div>
                  <h2>{portal === 'kitchen' ? 'Kitchen Culinary History' : 'Dining Room Order History'}</h2>
                  <p className="muted">
                    {portal === 'kitchen'
                      ? 'Log of fulfilled tickets, prepared dishes, and completed culinary dispatches.'
                      : 'Record of served, completed, and settled floor orders.'}
                  </p>
                </div>
                <label className="search" style={{ margin: 0 }}>
                  <Search size={16} />
                  <input
                    aria-label="Search order history"
                    placeholder="Search ticket, dish, or table…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Table / Floor</th>
                    <th>Items Prepared / Served</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th>{portal === 'kitchen' ? 'Dispatch Station' : 'Total Bill'}</th>
                    {portal === 'waiter' && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {historyOrders.map(o => (
                    <tr key={o.id}>
                      <td>
                        <strong style={{ fontFamily: 'monospace', fontSize: '13px', color: '#03241a' }}>
                          {o.order_number || o.id.slice(0, 8)}
                        </strong>
                      </td>
                      <td>
                        <strong>{[o.floor_name_snapshot, o.table_name_snapshot].filter(Boolean).join(' · ') || 'Dining room'}</strong>
                        {o.seats_snapshot ? <small className="muted" style={{ display: 'block' }}>{o.seats_snapshot} seats</small> : null}
                        {o.notes && (
                          <div style={{ fontSize: '11px', color: '#735824', background: '#fdf6e6', padding: '3px 7px', borderRadius: '3px', marginTop: '4px', maxWidth: '280px' }}>
                            {o.notes}
                          </div>
                        )}
                      </td>
                      <td>
                        {o.items.map(i => (
                          <div key={i.menu_item_id} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '2px' }}>
                            <b style={{ background: 'var(--soft)', padding: '1px 5px', borderRadius: '3px', fontSize: '11px', minWidth: '22px', textAlign: 'center' }}>
                              {i.quantity}×
                            </b>
                            <span>{i.name_snapshot}</span>
                          </div>
                        ))}
                      </td>
                      <td>
                        <div>
                          {new Date(o.created_at).toLocaleTimeString('en-PK', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Karachi',
                          })}
                        </div>
                        <small className="muted">
                          {new Date(o.created_at).toLocaleDateString('en-PK', { timeZone: 'Asia/Karachi' })}
                        </small>
                      </td>
                      <td><Badge status={o.status} /></td>
                      <td>
                        {portal === 'kitchen' ? (
                          <span className="badge active">Fulfilled</span>
                        ) : (
                          <strong>{money(o.total)}</strong>
                        )}
                      </td>
                      {portal === 'waiter' && (
                        <td>
                          <button className="soft" type="button" onClick={() => setEditor({ kind: 'order', item: o })}>
                            View details
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!historyOrders.length && (
                <Empty>No completed orders in history yet.</Empty>
              )}
            </section>
          )}

          {tab === 'staff' && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Staff & Station Operations</h2>
                  <p className="muted">Manage staff accounts and review each person&apos;s recorded service history.</p>
                </div>
                {staffSubTab === 'accounts' && (
                  <button onClick={() => setEditor({ kind: 'staff' })}><Plus size={16} /> Add staff</button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #dce8df', paddingBottom: '12px' }}>
                <button
                  type="button"
                  className={staffSubTab === 'accounts' ? 'selected' : 'soft'}
                  onClick={() => setStaffSubTab('accounts')}
                  style={{ fontSize: '12px', padding: '8px 14px', borderRadius: '4px' }}
                >
                  <Users size={15} /> Active Staff & Accounts ({staff.filter(s => s.role === 'staff').length})
                </button>
                <button
                  type="button"
                  className={staffSubTab === 'ledger' ? 'selected' : 'soft'}
                  onClick={() => setStaffSubTab('ledger')}
                  style={{ fontSize: '12px', padding: '8px 14px', borderRadius: '4px' }}
                >
                  <History size={15} /> Staff Service History ({staffLedger.length})
                </button>
              </div>

              {staffSubTab === 'accounts' ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Station</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staff.filter(s => s.role === 'staff').map(s => (
                        <tr key={s.id}>
                          <td><strong>{s.full_name}</strong></td>
                          <td>{s.email}</td>
                          <td>
                            <Badge status={s.role === 'manager' ? 'manager' : s.staff_type === 'kitchen' ? 'preparing' : 'ready'} />{' '}
                            <span style={{ marginLeft: '0.4rem', fontSize: '0.85rem' }}>
                              {s.role === 'manager' ? 'General Manager' : s.staff_type === 'cashier' ? 'Cashier / Billing' : s.staff_type === 'kitchen' ? 'Kitchen (KDS)' : 'Waiter (Floor)'}
                            </span>
                          </td>
                          <td><Badge status={s.is_active ? 'active' : 'inactive'} /></td>
                          <td className="row-actions">
                            <button className="soft" onClick={() => setEditor({ kind: 'staff', item: s })}>Edit station</button>
                            <button className="soft" onClick={() => setEditor({ kind: 'credentials', item: s })}>Reset password</button>
                            {s.id !== me?.id &&
                              (s.is_active ? (
                                <button
                                  className="danger-ghost"
                                  disabled={busy}
                                  onClick={() => {
                                    confirm({title:'Deactivate staff?',description:`${s.full_name} will no longer be able to sign in. You can reactivate this account later.`,label:'Deactivate',onConfirm:async()=>{
                                        await api('users/' + s.id, 'PUT', {
                                          full_name: s.full_name,
                                          role: s.role,
                                          staff_type: s.staff_type,
                                          is_active: false,
                                          expected_version: s.version,
                                        }, crypto.randomUUID());
                                        await load();
                                    }});
                                  }}
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  className="soft"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(() =>
                                      api('users/' + s.id, 'PUT', {
                                        full_name: s.full_name,
                                        role: s.role,
                                        staff_type: s.staff_type,
                                        is_active: true,
                                        expected_version: s.version,
                                      }, crypto.randomUUID())
                                    )
                                  }
                                >
                                  Reactivate
                                </button>
                              ))}
                            <button className="danger-ghost" disabled={busy} onClick={() => {
                              confirm({title:'Delete staff account?',description:`${s.full_name}'s login will be permanently removed. Past orders will be kept.`,label:'Delete staff',onConfirm:async()=>{await api('users/' + s.id, 'DELETE', undefined, crypto.randomUUID());await load();}});
                            }}>Delete staff</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div>
                  <div style={{ background: '#f0f9f2', border: '1px solid #c9e8d1', borderRadius: '6px', padding: '12px 16px', marginBottom: '18px', color: '#164d2e', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Past work stays visible:</strong> Removing a staff login does not remove their guest orders, kitchen tickets, cash settlements, item names, or recorded prices.
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Staff Member</th>
                          <th>Station</th>
                          <th>Account Status</th>
                          <th>Service Tenure</th>
                          <th>Tickets Handled</th>
                          <th>Sales / Settled</th>
                          <th>Orders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffLedger.map(item => (
                          <tr key={item.email}>
                            <td>
                              <strong>{item.full_name}</strong>
                              <div className="muted" style={{ fontSize: '11px' }}>{item.email}</div>
                            </td>
                            <td>
                              <Badge status={item.staff_type === 'kitchen' ? 'preparing' : item.staff_type === 'cashier' ? 'ready' : 'manager'} />{' '}
                              <span style={{ marginLeft: '0.4rem', fontSize: '0.85rem' }}>
                                {item.staff_type === 'cashier' ? 'Cashier / Billing' : item.staff_type === 'kitchen' ? 'Kitchen (KDS)' : 'Waiter (Floor)'}
                              </span>
                            </td>
                            <td>
                              {item.is_active ? (
                                <span className="badge active">Active</span>
                              ) : (
                                <span className="badge" style={{ background: '#f0f0f0', color: '#555', border: '1px solid #ddd' }}>Former Staff</span>
                              )}
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, color: '#03241a' }}>{item.tenure_label}</div>
                              <div className="muted" style={{ fontSize: '10px' }}>
                                Tenure: {item.tenure_months} month{item.tenure_months > 1 ? 's' : ''}
                              </div>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{item.orders_count} Total Tickets</div>
                              <div className="muted" style={{ fontSize: '10px' }}>
                                {item.staff_type === 'waiter' && `${item.orders_created} Orders Placed`}
                                {item.staff_type === 'kitchen' && `${item.orders_prepared} Tickets Prepared`}
                                {item.staff_type === 'cashier' && `${item.orders_paid} Bills Settled`}
                              </div>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600 }}>
                                {Number(item.total_sales) > 0 ? money(item.total_sales) : '—'}
                              </div>
                              {Number(item.total_sales) > 0 && (
                                <div className="muted" style={{ fontSize: '10px' }}>Revenue Attributed</div>
                              )}
                            </td>
                            <td>
                              <button
                                className="soft"
                                type="button"
                                onClick={() => {
                                  setOrderStaffFilter(item.email);
                                  setOrderDateRange('all');
                                  setTab('overview');
                                }}
                                style={{ fontSize: '11px', padding: '6px 12px' }}
                              >
                                View Orders →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!staffLedger.length && (
                      <Empty>No staff activity records found in history.</Empty>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {tab === 'menu' && (() => {
            const kitchenDishes = menu.filter(m => !m.stock_ingredient_id && m.category !== 'Drinks');
            const drinksCount = menu.filter(m => m.stock_ingredient_id || m.category === 'Drinks').length;
            return (
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Kitchen Dishes</h2>
                    <p className="muted">
                      Restaurant-prepared dishes (unlimited availability). {drinksCount > 0 ? `(${drinksCount} drinks/bottles are managed separately under the Inventory tab).` : 'Manage purchased drinks and stock in the Inventory tab.'}
                    </p>
                  </div>
                  <button onClick={() => setEditor({ kind: 'menu' })}><Plus size={16} /> Add dish</button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Dish</th>
                        <th>Category</th>
                        <th>Price</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kitchenDishes.map(m => (
                        <tr key={m.id}>
                          <td><strong>{m.name}</strong></td>
                          <td><span className="badge active">{m.category}</span></td>
                          <td>{money(m.selling_price)}</td>
                          <td><Badge status={m.is_active ? 'active' : 'inactive'} /></td>
                          <td className="row-actions">
                            <button className="soft" onClick={() => setEditor({ kind: 'menu', item: m })}>Edit</button>
                            <button className="danger-ghost" disabled={busy} onClick={() => {
                              confirm({title:'Delete menu item?',description:`${m.name} will be removed from the menu. Past orders will be kept.`,label:'Delete item',onConfirm:async()=>{await api('menu/' + m.id, 'DELETE', { expected_version: m.version }, crypto.randomUUID());await load();}});
                            }}>Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!kitchenDishes.length && <Empty>Add your first kitchen dish (e.g. Chicken Karahi, Biryani, Pulao).</Empty>}
              </section>
            );
          })()}

          {tab === 'stock' && <StockPanel onChanged={() => void load()} />}
          {tab === 'tables' && <TablesPanel />}
          {portal === 'manager' && tab === 'expenses' && <ExpensesPanel onChanged={() => void load()} />}
          {portal === 'manager' && tab === 'analytics' && <AnalyticsPanel />}
          {portal === 'manager' && tab === 'forecasts' && <ForecastsPanel />}
          {portal === 'manager' && tab === 'decisions' && <DecisionsAuditPanel />}
        </main>

        <footer className="workspace-footer">
          <span>SMART DINE · SERVICE WITH INTENTION</span>
          <span>PKR · One restaurant</span>
        </footer>
      </div>

      {editor && (
        <Modal
          title={
            editor.kind === 'order'
              ? editor.item ? 'Order details' : 'Take new order'
              : editor.kind === 'menu'
              ? 'Menu item'
              : editor.kind === 'staff'
              ? 'Team account'
              : editor.kind === 'recipe'
              ? 'Recipe quantities'
              : 'Account credentials'
          }
          onClose={() => setEditor(null)}
        >
          {editor.kind === 'order' ? (
            <OrderForm item={editor.item as Order | undefined} menu={menu} onDone={() => { setEditor(null); void load(); }} />
          ) : editor.kind === 'menu' ? (
            <MenuForm item={editor.item as MenuItem | undefined} onDone={() => { setEditor(null); void load(); }} />
          ) : editor.kind === 'staff' ? (
            <StaffForm item={editor.item as Profile | undefined} cashierEnabled={me?.cashier_billing_enabled} onDone={() => { setEditor(null); void load(); }} />
          ) : editor.kind === 'recipe' ? (
            <RecipeForm item={editor.item as MenuItem} onDone={() => { setEditor(null); void load(); }} />
          ) : (
            <CredentialsForm item={editor.item as Profile} onDone={() => { setEditor(null); void load(); }} />
          )}
        </Modal>
      )}

      {cancel && (
        <Modal title="Cancel order" onClose={() => setCancel(null)}>
          <form
            className="modal-form"
            onSubmit={async e => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get('reason'));
              if (await transition(cancel, 'cancelled', reason)) setCancel(null);
            }}
          >
            <p>Prepared ingredients will be recorded as a loss. This action cannot be undone.</p>
            <Field label="Reason"><textarea name="reason" required minLength={3} /></Field>
            <button className="danger" disabled={busy}>Cancel this order</button>
          </form>
        </Modal>
      )}

      {portal === 'manager' && (
        <button
          type="button"
          className="assistant-fab-btn"
          onClick={() => setAssistantOpen(prev => !prev)}
          title="Ask Smart Dine (Ctrl+K)"
          aria-label="Open Smart Dine Assistant"
        >
          <Sparkles size={20} />
          <span className="fab-tooltip">Ask Smart Dine</span>
        </button>
      )}

      {portal === 'manager' && (
        <AssistantDrawer
          isOpen={assistantOpen}
          onClose={() => setAssistantOpen(false)}
        />
      )}
    </div>
  );
}

function OrderCard({ order: o, busy, onNext, onCancel, onEdit }: { order: Order; busy: boolean; onNext?: () => void; onCancel: () => void; onEdit?: () => void }) {
  return (
    <article className={`order-card ${o.status}`}>
      <div className="card-title">
        <h3>{[o.floor_name_snapshot,o.table_name_snapshot].filter(Boolean).join(' · ')||o.notes.split('\n')[0]||'Dining order'}{o.seats_snapshot?` · ${o.seats_snapshot} seats`:''}</h3>
        <Badge status={o.status} />
      </div>
      <div className="ticket-meta">
        <span>{o.order_number||o.id}</span>
        <span>
          <Clock size={12} />
          {new Date(o.created_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })}
        </span>
      </div>
      <ul>
        {o.items.map(i => (
          <li key={i.menu_item_id}>
            <b>{i.quantity}×</b>
            {i.name_snapshot}
          </li>
        ))}
      </ul>
      {o.notes && <p className="order-notes">{o.notes}</p>}
      <div className="order-total">
        <span>Total</span>
        <strong>{money(o.total)}</strong>
      </div>
      <div className="card-actions">
        {onNext && (
          <button disabled={busy} onClick={onNext}>
            <Check size={14} /> {labels[nextStatus[o.status]]}
          </button>
        )}
        {onEdit && o.status === 'pending' && (
          <button className="soft" onClick={onEdit}>Edit</button>
        )}
        {['pending', 'preparing'].includes(o.status) && (
          <button className="danger-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        )}
        {o.status === 'ready' && !onNext && <Badge status="awaiting_payment" />}
      </div>
    </article>
  );
}
