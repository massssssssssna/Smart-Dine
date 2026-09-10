'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, UtensilsCrossed, ChefHat, Globe, LogOut, Plus, Search, Users, BookOpen, Package, Check, Clock, ArrowRight } from 'lucide-react';
import { api, ApiError, Profile, MenuItem, Order, Page, money } from '@/lib/api';
import { Brand, Badge, Empty, Modal, Field } from './ui';
import { MenuForm, OrderForm, StaffForm, CredentialsForm, RecipeForm } from './workspace-forms';
import { StockPanel } from './simple-stock';
import { useConfirmation } from './use-confirmation';

type Editor = { kind: 'order' | 'menu' | 'staff' | 'credentials' | 'recipe'; item?: Order | MenuItem | Profile };
const nextStatus: Record<string, string> = { pending: 'preparing', preparing: 'ready', ready: 'completed' };
const labels: Record<string, string> = { preparing: 'Start preparation', ready: 'Ready for pickup', completed: 'Served & paid' };

export default function Workspace({ portal: initialPortal }: { portal: string }) {
  const {confirm,confirmationDialog}=useConfirmation();
  const [portal, setPortal] = useState(initialPortal);
  const [me, setMe] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
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

  // Handle browser back/forward buttons seamlessly without page reloads
  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname.replace(/^\//, '');
      if (['manager', 'waiter', 'kitchen'].includes(p)) {
        setPortal(p);
        setTab('overview');
        setTicketFilter('all');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Instant in-app station switching without unmounting shell or showing full-screen green loaders
  const switchPortal = (target: string) => {
    if (portal === target) return;
    setPortal(target);
    window.history.pushState(null, '', '/' + target);
    setTab('overview');
    setTicketFilter('all');
  };

  const load = useCallback(async () => {
    try {
      const user = await api<Profile>('auth/me');
      if(user.role==='staff' && user.staff_type==='cashier') {window.location.replace('/cashier');return;}
      if (!user.is_active) {
        await api('auth/logout', 'POST');
        window.location.replace('/sign-in');
        return;
      }
      if (user.role !== 'manager' && (portal === 'manager' || portal !== user.staff_type)) {
        setPortal(user.staff_type);
        window.history.replaceState(null, '', '/' + user.staff_type);
        return;
      }
      setMe(user);
      const [o, m] = await Promise.all([
        api<Page<Order>>(`orders?limit=100&offset=${offset}`),
        api<Page<MenuItem>>('menu?limit=100'),
      ]);
      setOrders(o.items);
      setTotal(o.total);
      setMenu(m.items);
      if (user.role === 'manager') {
        const s = await api<Page<Profile>>('users?limit=100');
        setStaff(s.items);
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
  }, [portal, offset]);

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

  const filtered = orders.filter(o =>
    (o.id + ' ' + o.notes + ' ' + o.items.map(i => i.name_snapshot).join(' ')).toLowerCase().includes(search.toLowerCase())
  );
  const active = filtered.filter(o => !['completed', 'cancelled'].includes(o.status));

  const stats = [
    {
      label: portal === 'manager' ? 'Total staff' : 'Orders in view',
      value: portal === 'manager' ? staff.filter(s => s.is_active).length : orders.length,
      note: portal === 'manager' ? 'Active restaurant accounts' : 'Current page',
      icon: Users,
    },
    {
      label: portal === 'manager' ? 'Menu offerings' : 'In kitchen',
      value: portal === 'manager' ? menu.filter(m => m.is_active).length : orders.filter(o => ['pending', 'preparing'].includes(o.status)).length,
      note: portal === 'manager' ? 'Available on the menu' : 'Awaiting preparation',
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
                ['staff', 'Staff management', Users],
                ['menu', 'Menu', BookOpen],
                ['stock', 'Inventory', Package],
              ]
            : [
                [portal, portal === 'kitchen' ? 'Kitchen Display' : 'Waiter Station', portal === 'kitchen' ? ChefHat : UtensilsCrossed],
              ]
          ).map(([path, label, Icon]) => {
            const I = Icon as typeof Users;
            return (
              <button
                key={path as string}
                type="button"
                onClick={() => portal === 'manager' ? setTab(path as string) : switchPortal(path as string)}
                className={`nav-link ${(portal === 'manager' ? tab === path : portal === path) ? 'active' : ''}`}
                aria-current={(portal === 'manager' ? tab === path : portal === path) ? 'page' : undefined}
              >
                <I size={18} />
                {label as string}
              </button>
            );
          })}
          {portal !== 'manager' && <Link href="/"><Globe size={18} />Brand Portal</Link>}
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
                  ? 'Dashboard'
                  : portal === 'waiter'
                  ? 'Waiter Station'
                  : 'Kitchen Live Board'}
              </h1>
              {portal !== 'manager' && <span className="station-person">{portal === 'waiter' ? me?.full_name : 'High-speed culinary dispatch'} <span>{portal === 'waiter' ? 'ON DUTY' : 'LIVE STATION'}</span></span>}
              <p className="muted small">
                {updated ? `Last refreshed ${updated} · Live sync active` : 'Connecting to your restaurant'}
              </p>
            </div>
            {portal === 'waiter' && (
              <button className="gold" onClick={() => setEditor({ kind: 'order' })}>
                <Plus size={17} /> Take new order
              </button>
            )}
          </div>

          {error && (
            <div className="error" role="alert">
              {error} <button className="text-button" onClick={() => void load()}>Retry</button>
            </div>
          )}

          {tab === 'overview' && (
            <>
              {portal !== 'kitchen' && <div className="stats">
                {(portal === 'waiter' ? stats.filter((_, i) => i !== 2) : stats).map(({ label, value, note, icon: Icon }) => (
                  <article key={label}>
                    <div>
                      <span>{label}</span>
                      <Icon size={19} />
                    </div>
                    <strong>{value}</strong>
                    <small>{note}</small>
                  </article>
                ))}
              </div>}
              {portal === 'kitchen' && <div className="ticket-filters">{['all','pending','preparing','ready','cancelled'].map(status => <button key={status} className={ticketFilter === status ? 'selected' : ''} onClick={() => setTicketFilter(status)}>{status === 'all' ? 'All orders' : status}<span>{filtered.filter(o => status === 'all' || o.status === status).length}</span></button>)}</div>}

              <div className="toolbar">
                <h2>{portal === 'manager' ? 'Recent Orders' : portal === 'waiter' ? 'Active Floor Orders' : 'Kitchen Tickets'}</h2>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search orders"
                    placeholder="Search order or table…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </label>
              </div>

              {portal === 'manager' ? (
                <div className="dashboard-grid">
                  <section className="panel table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Table / notes</th>
                          <th>Items</th>
                          <th>Time</th>
                          <th>Status</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(o => (
                          <tr key={o.id}>
                            <td>
                              <button className="text-button" onClick={() => setEditor({ kind: 'order', item: o })}>
                                #{o.id.slice(0, 6)}
                              </button>
                            </td>
                            <td>{o.notes || '—'}</td>
                            <td>
                              {o.items.map(i => (
                                <div key={i.menu_item_id}>
                                  {i.quantity} × {i.name_snapshot}
                                </div>
                              ))}
                            </td>
                            <td>
                              {new Date(o.created_at).toLocaleTimeString('en-PK', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Karachi',
                              })}
                            </td>
                            <td><Badge status={o.status} /></td>
                            <td>{money(o.total)}</td>
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
                    ...(ticketFilter === 'cancelled' ? [['cancelled', 'Cancelled tickets']] : []),
                  ].filter(([status]) => ticketFilter === 'all' || status === ticketFilter).map(([status, title]) => (
                    <section key={status}>
                      <div className="kanban-title">
                        <h3>{title}</h3>
                        <Badge status={String(filtered.filter(o => o.status === status).length) + ' tickets'} />
                      </div>
                      {filtered
                        .filter(o => o.status === status)
                        .map(o => (
                          <OrderCard
                            key={o.id}
                            order={o}
                            busy={busy}
                            onNext={['pending','preparing'].includes(o.status) ? () => void transition(o, nextStatus[o.status]) : undefined}
                            onCancel={() => setCancel(o)}
                          />
                        ))}
                      {!filtered.some(o => o.status === status) && <Empty>No tickets in this station.</Empty>}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="order-grid">
                  {active.map(o => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      busy={busy}
                      onEdit={() => setEditor({ kind: 'order', item: o })}
                      onNext={!me?.cashier_billing_enabled && o.status==='ready' ? ()=>void transition(o,'completed') : undefined}
                      onCancel={() => setCancel(o)}
                    />
                  ))}
                  {!active.length && <Empty>No open orders on this page.</Empty>}
                </div>
              )}

              <div className="pagination">
                <span>{total} orders · Showing {offset + Math.min(1, orders.length)}–{offset + orders.length}</span>
                <button className="soft" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button>
                <button className="soft" disabled={offset + 100 >= total} onClick={() => setOffset(offset + 100)}>Next</button>
              </div>
              <section className="service-flow panel"><div className="panel-head"><h3>Service Station Flow</h3><span className="muted small">{active.length} open orders in view</span></div><div className="flow-track">{['pending','preparing','ready','completed','cancelled'].map(status => {const count=orders.filter(o=>o.status===status).length;return count>0?<span key={status} className={status} style={{flex:count}} title={`${status}: ${count}`}/>:null;})}</div><div className="flow-legend">{['pending','preparing','ready','completed','cancelled'].map(status=><span key={status}><i className={status}/>{status} ({orders.filter(o=>o.status===status).length})</span>)}</div></section>
            </>
          )}

          {tab === 'staff' && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Your team</h2>
                  <p className="muted">Manage accounts and station assignments.</p>
                </div>
                <button onClick={() => setEditor({ kind: 'staff' })}><Plus size={16} /> Add staff</button>
              </div>
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
            </section>
          )}

          {tab === 'menu' && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Menu</h2>
                  <p className="muted">Kitchen dishes stay available. Manage bottle quantities in Inventory.</p>
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
                    {menu.map(m => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{m.category}</td>
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
              {!menu.length && <Empty>Add your first dish.</Empty>}
            </section>
          )}

          {tab === 'stock' && <StockPanel onChanged={() => void load()} />}
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
    </div>
  );
}

function OrderCard({ order: o, busy, onNext, onCancel, onEdit }: { order: Order; busy: boolean; onNext?: () => void; onCancel: () => void; onEdit?: () => void }) {
  return (
    <article className={`order-card ${o.status}`}>
      <div className="card-title">
        <h3>{o.notes.split('\n')[0] || 'Dining order'}</h3>
        <Badge status={o.status} />
      </div>
      <div className="ticket-meta">
        <span>#{o.id.slice(0, 6)}</span>
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
      {o.notes.includes('\n') && <p className="order-notes">{o.notes.split('\n').slice(1).join('\n')}</p>}
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
