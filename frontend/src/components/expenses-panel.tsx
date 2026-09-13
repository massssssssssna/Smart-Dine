'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Receipt, Search, AlertCircle, Ban, TrendingUp, Calendar, FileText, CheckCircle2 } from 'lucide-react';
import { api, Expense, ExpenseCategory, Page, money } from '@/lib/api';
import { Empty, Field, Modal } from './ui';

const CATEGORIES: { key: ExpenseCategory; label: string; description: string }[] = [
  { key: 'rent', label: 'Rent', description: 'Premises lease, shop rent, storage charges' },
  { key: 'salaries', label: 'Salaries', description: 'Staff payroll, daily wages, overtime stipends' },
  { key: 'utilities', label: 'Utilities', description: 'Electricity (WAPDA/K-Electric), Gas (SSGC/SNGPL), Water' },
  { key: 'marketing', label: 'Marketing', description: 'Social media ads, billboard campaigns, flyers' },
  { key: 'maintenance', label: 'Maintenance', description: 'HVAC repair, kitchen appliance servicing, plumbing' },
  { key: 'supplies', label: 'Supplies', description: 'Cleaning chemicals, napkins, guest amenities' },
  { key: 'other', label: 'Other', description: 'Government permits, courier, incidental expenses' },
];

const QUICK_VOID_REASONS = [
  'Duplicate Entry',
  'Wrong Amount Recorded',
  'Incorrect Category',
  'Vendor Order Cancelled',
];

function getKarachiDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getKarachiMonthName(date = new Date()): string {
  return new Intl.DateTimeFormat('en-PK', {
    timeZone: 'Asia/Karachi',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatDisplayDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

type DatePreset = 'this_month' | 'last_30_days' | 'custom';

export function ExpensesPanel({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filtering states
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const today = useMemo(() => getKarachiDate(), []);
  const currentMonthLabel = useMemo(() => getKarachiMonthName(), []);

  const firstOfMonth = useMemo(() => {
    const parts = today.split('-');
    return `${parts[0]}-${parts[1]}-01`;
  }, [today]);

  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return getKarachiDate(d);
  }, []);

  const [customStart, setCustomStart] = useState(firstOfMonth);
  const [customEnd, setCustomEnd] = useState(today);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'active' | 'voided'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);

  // Active Date Bounds for query
  const startDate = preset === 'this_month' ? firstOfMonth : preset === 'last_30_days' ? thirtyDaysAgo : customStart;
  const endDate = preset === 'this_month' || preset === 'last_30_days' ? today : customEnd;

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        limit: '50',
        offset: String(offset),
        start_date: startDate,
        end_date: endDate,
      });
      const res = await api<Page<Expense>>(`expenses?${query.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [offset, startDate, endDate]);

  useEffect(() => {
    void loadExpenses();
    const interval = setInterval(() => void loadExpenses(), 15000);
    return () => clearInterval(interval);
  }, [loadExpenses]);

  // Client-side filtering for category, status & search query
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      const isVoided = Boolean(item.voided_at);
      if (selectedStatus === 'active' && isVoided) return false;
      if (selectedStatus === 'voided' && !isVoided) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesDesc = item.description.toLowerCase().includes(q);
        const matchesCategory = item.category.toLowerCase().includes(q);
        const matchesAmount = item.amount.includes(q);
        if (!matchesDesc && !matchesCategory && !matchesAmount) return false;
      }
      return true;
    });
  }, [items, selectedCategory, selectedStatus, searchQuery]);

  // Step 1.5 — 3 Quick Monthly Expense Summary Cards calculations:
  // 1. Total Expenses This Month
  // 2. Top Expense Category
  // 3. Active Expense Count
  const { thisMonthTotal, topCategoryLabel, topCategoryShare, thisMonthActiveCount } = useMemo(() => {
    let monthSum = 0;
    let actCount = 0;
    const catMap: Record<string, number> = {};

    items.forEach(item => {
      // Incurred within current month and not voided
      const isThisMonth = item.incurred_on >= firstOfMonth && item.incurred_on <= today;
      const isNotVoided = !item.voided_at;

      if (isThisMonth && isNotVoided) {
        const amt = Number(item.amount) || 0;
        monthSum += amt;
        actCount += 1;
        catMap[item.category] = (catMap[item.category] || 0) + amt;
      }
    });

    let topCatName = 'None yet';
    let topCatAmt = 0;
    Object.entries(catMap).forEach(([cat, val]) => {
      if (val > topCatAmt) {
        topCatAmt = val;
        topCatName = cat;
      }
    });

    const share = monthSum > 0 && topCatAmt > 0 ? `${Math.round((topCatAmt / monthSum) * 100)}% of monthly operating spend` : 'No spend recorded';

    return {
      thisMonthTotal: monthSum,
      topCategoryLabel: topCatAmt > 0 ? `${topCatName.charAt(0).toUpperCase() + topCatName.slice(1)} · ${money(topCatAmt)}` : 'None yet',
      topCategoryShare: share,
      thisMonthActiveCount: actCount,
    };
  }, [items, firstOfMonth, today]);

  return (
    <section className="panel" style={{ padding: '24px' }}>
      {/* Top Header */}
      <div className="panel-head" style={{ marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2>Operating Expenses</h2>
            <span className="badge active" style={{ fontSize: '10px' }}>Manager Role · Single Restaurant PKR</span>
          </div>
          <p className="muted">
            Record rent, salaries, utilities and other overheads so the P&amp;L can calculate operating profit from verified costs.
          </p>
        </div>
        <button className="gold" onClick={() => setIsRecordOpen(true)}>
          <Plus size={16} /> Record Expense
        </button>
      </div>

      <div className="feature-flow" aria-label="Expense recording flow">
        <div><span>1</span><strong>Record</strong><small>Manager submits category, amount, date and reason.</small></div>
        <div><span>2</span><strong>Validate</strong><small>Backend rejects future dates, invalid values and duplicate retries.</small></div>
        <div><span>3</span><strong>Include in P&amp;L</strong><small>Active expenses reduce operating profit for their reporting date.</small></div>
      </div>

      {error && (
        <div className="error" role="alert">
          <AlertCircle size={16} /> {error}
          <button className="text-button" style={{ marginLeft: '10px' }} onClick={() => void loadExpenses()}>
            Retry
          </button>
        </div>
      )}

      {/* Step 1.5 — 3 Quick Top Cards:
          Card 1: Total Expenses This Month
          Card 2: Top Expense Category
          Card 3: Active Expense Count */}
      <div className="expense-metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {/* Card 1 */}
        <div className="expense-metric-card">
          <div className="metric-header">
            <span>Total Expenses This Month</span>
            <Receipt size={17} color="#03241a" />
          </div>
          <strong>{money(thisMonthTotal)}</strong>
          <small>Active operational spend for {currentMonthLabel}</small>
        </div>

        {/* Card 2 */}
        <div className="expense-metric-card">
          <div className="metric-header">
            <span>Top Expense Category</span>
            <TrendingUp size={17} color="#b8860b" />
          </div>
          <strong style={{ fontSize: '20px' }}>{topCategoryLabel}</strong>
          <small>{topCategoryShare}</small>
        </div>

        {/* Card 3 */}
        <div className="expense-metric-card">
          <div className="metric-header">
            <span>Active Expense Count</span>
            <FileText size={17} color="#1b3a2f" />
          </div>
          <strong>{thisMonthActiveCount} Active Vouchers</strong>
          <small>Excludes voided audit records</small>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="expense-toolbar">
        {/* Row 1: Date Range Presets & Custom Range */}
        <div className="expense-toolbar-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Period:
            </span>
            <div className="filter-pills">
              <button
                type="button"
                className={`filter-pill ${preset === 'this_month' ? 'active' : ''}`}
                onClick={() => { setPreset('this_month'); setOffset(0); }}
              >
                This Month
              </button>
              <button
                type="button"
                className={`filter-pill ${preset === 'last_30_days' ? 'active' : ''}`}
                onClick={() => { setPreset('last_30_days'); setOffset(0); }}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                className={`filter-pill ${preset === 'custom' ? 'active' : ''}`}
                onClick={() => { setPreset('custom'); setOffset(0); }}
              >
                Custom Range
              </button>
            </div>

            {preset === 'custom' && (
              <div className="custom-range-picker">
                <Calendar size={14} color="var(--muted)" />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                  From:
                  <input
                    type="date"
                    max={customEnd || today}
                    value={customStart}
                    onChange={e => { setCustomStart(e.target.value); setOffset(0); }}
                  />
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                  To:
                  <input
                    type="date"
                    min={customStart}
                    max={today}
                    value={customEnd}
                    onChange={e => { setCustomEnd(e.target.value); setOffset(0); }}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Search Box */}
          <div className="search" style={{ maxWidth: '280px' }}>
            <Search size={15} color="var(--muted)" />
            <input
              type="text"
              placeholder="Search description or amount…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                style={{ background: 'none', border: 'none', padding: '0 4px', cursor: 'pointer', fontSize: '12px', color: 'var(--muted)' }}
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Category Chips & Status Toggle */}
        <div className="expense-toolbar-row" style={{ paddingTop: '8px', borderTop: '1px solid #f0f5f1' }}>
          <div className="category-filter-chips">
            <button
              type="button"
              className={`category-chip ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              All Categories
            </button>
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                type="button"
                className={`category-chip ${selectedCategory === c.key ? 'active' : ''}`}
                onClick={() => setSelectedCategory(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Status:</span>
            <div className="filter-pills">
              <button
                type="button"
                className={`filter-pill ${selectedStatus === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedStatus('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`filter-pill ${selectedStatus === 'active' ? 'active' : ''}`}
                onClick={() => setSelectedStatus('active')}
              >
                Active
              </button>
              <button
                type="button"
                className={`filter-pill ${selectedStatus === 'voided' ? 'active' : ''}`}
                onClick={() => setSelectedStatus('voided')}
              >
                Voided
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Expenses Table */}
      <div className="table-wrap" style={{ borderRadius: '6px', border: '1px solid var(--line)' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: '135px' }}>Incurred Date</th>
              <th style={{ width: '130px' }}>Category</th>
              <th>Description</th>
              <th style={{ width: '160px', textAlign: 'right' }}>Amount (PKR)</th>
              <th style={{ width: '110px' }}>Status</th>
              <th style={{ width: '110px', textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map(expense => {
              const isVoided = Boolean(expense.voided_at);
              const isToday = expense.incurred_on === today;
              return (
                <tr key={expense.id} className={isVoided ? 'expense-voided-row' : ''}>
                  {/* Column 1: Incurred Date */}
                  <td>
                    <strong>{formatDisplayDate(expense.incurred_on)}</strong>
                    {isToday && (
                      <span style={{ display: 'inline-block', marginLeft: '6px', fontSize: '9px', background: '#dff4e4', color: '#2c7345', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                        TODAY
                      </span>
                    )}
                  </td>

                  {/* Column 2: Category Badge */}
                  <td>
                    <span className={`badge cat-${expense.category}`}>
                      {expense.category}
                    </span>
                  </td>

                  {/* Column 3: Description */}
                  <td>
                    <div>{expense.description || <span className="muted italic">No description provided</span>}</div>
                    {isVoided && expense.void_reason && (
                      <span className="void-reason-text">
                        Voided: &ldquo;{expense.void_reason}&rdquo;
                      </span>
                    )}
                  </td>

                  {/* Column 4: Amount (PKR) */}
                  <td style={{ textAlign: 'right' }}>
                    <strong className={isVoided ? 'expense-voided-amount' : ''} style={{ fontSize: '13px' }}>
                      {money(expense.amount)}
                    </strong>
                  </td>

                  {/* Column 5: Status Badge */}
                  <td>
                    {isVoided ? (
                      <span className="badge voided">Voided</span>
                    ) : (
                      <span className="badge active">Active</span>
                    )}
                  </td>

                  {/* Column 6: Step 1.4 — Void Action Button */}
                  <td style={{ textAlign: 'center' }}>
                    {isVoided ? (
                      <span className="muted small" title={expense.void_reason ? `Audit Reason: ${expense.void_reason}` : 'Voided'}>
                        Archived
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="danger-ghost"
                        style={{ padding: '4px 10px', fontSize: '11px', gap: '4px' }}
                        onClick={() => setVoidTarget(expense)}
                      >
                        <Ban size={12} /> Void
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!filteredItems.length && (
        <Empty>
          {loading ? (
            'Loading operating expenses…'
          ) : (
            <>
              No operating expenses found for this selection.
              <br />
              <button
                className="gold"
                style={{ marginTop: '12px' }}
                onClick={() => setIsRecordOpen(true)}
              >
                <Plus size={15} /> Record first expense
              </button>
            </>
          )}
        </Empty>
      )}

      {/* Pagination Controls */}
      {total > 50 && (
        <div className="pagination" style={{ marginTop: '16px' }}>
          <span>
            Showing {offset + 1}–{Math.min(offset + 50, total)} of {total} expenses
          </span>
          <button
            type="button"
            className="soft"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous
          </button>
          <button
            type="button"
            className="soft"
            disabled={offset + 50 >= total || loading}
            onClick={() => setOffset(offset + 50)}
          >
            Next
          </button>
        </div>
      )}

      {/* Record Expense Modal */}
      {isRecordOpen && (
        <Modal title="Record Operating Expense" onClose={() => setIsRecordOpen(false)}>
          <RecordExpenseModal
            today={today}
            onDone={() => {
              setIsRecordOpen(false);
              void loadExpenses();
              onChanged?.();
            }}
          />
        </Modal>
      )}

      {/* Step 1.4 — Audited Void Expense Modal */}
      {voidTarget && (
        <Modal title="Void Expense Voucher" onClose={() => setVoidTarget(null)}>
          <VoidExpenseModal
            expense={voidTarget}
            onDone={() => {
              setVoidTarget(null);
              void loadExpenses();
              onChanged?.();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function RecordExpenseModal({ today, onDone }: { today: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const retryKey = useRef<string>(crypto.randomUUID());

  return (
    <form
      className="modal-form"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const form = new FormData(e.currentTarget);
        const category = String(form.get('category') || '');
        const amount = Number(form.get('amount') || 0);
        const incurredOn = String(form.get('incurred_on') || '');
        const description = String(form.get('description') || '').trim();

        if (amount <= 0) {
          setError('Amount must be greater than 0 PKR.');
          setBusy(false);
          return;
        }

        if (incurredOn > today) {
          setError('Expense cannot be future dated per restaurant accounting policy.');
          setBusy(false);
          return;
        }

        if (description.length < 3) {
          setError('Please provide a descriptive reason (minimum 3 characters).');
          setBusy(false);
          return;
        }

        const body = {
          category,
          amount: amount.toFixed(2),
          incurred_on: incurredOn,
          description,
        };

        try {
          await api('expenses', 'POST', body, retryKey.current);
          onDone();
        } catch (err) {
          setError((err as Error).message);
          retryKey.current = crypto.randomUUID();
        } finally {
          setBusy(false);
        }
      }}
    >
      <div style={{ background: '#f2fff0', border: '1px solid #d4ebd7', borderRadius: '6px', padding: '12px', marginBottom: '16px', fontSize: '11px', color: '#274b34' }}>
        <strong>What happens next:</strong> the backend validates this entry, stores it with your manager account and includes it in Analytics &amp; P&amp;L. Repeated submissions use one idempotency key, so a retry cannot create the same expense twice.
      </div>

      <Field label="Expense Category">
        <select name="category" required defaultValue="utilities">
          {CATEGORIES.map(c => (
            <option key={c.key} value={c.key}>
              {c.label} — {c.description}
            </option>
          ))}
        </select>
      </Field>

      <div className="form-grid">
        <Field label="Amount · PKR">
          <input
            name="amount"
            type="number"
            min="1"
            max="100000000"
            step="1"
            placeholder="e.g. 25000"
            required
          />
        </Field>

        <Field label="Date Incurred (Asia/Karachi)">
          <input
            name="incurred_on"
            type="date"
            max={today}
            defaultValue={today}
            required
          />
        </Field>
      </div>

      <Field label="Description & Notes">
        <textarea
          name="description"
          placeholder="e.g. K-Electric commercial bill for kitchen unit (Ref #9823412)..."
          required
          minLength={3}
          maxLength={2000}
          rows={3}
        />
      </Field>

      {error && (
        <p role="alert" className="error" style={{ marginTop: '10px' }}>
          {error}
        </p>
      )}

      <button className="gold full" disabled={busy} style={{ marginTop: '16px' }}>
        {busy ? 'Recording expense…' : 'Confirm & Record Expense'}
      </button>
    </form>
  );
}

function VoidExpenseModal({ expense, onDone }: { expense: Expense; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const retryKey = useRef<string>(crypto.randomUUID());

  return (
    <form
      className="modal-form"
      onSubmit={async e => {
        e.preventDefault();
        const trimmed = reason.trim();
        if (trimmed.length < 3) {
          setError('Void reason must be at least 3 characters.');
          return;
        }
        setBusy(true);
        setError('');

        const body = {
          expected_version: expense.version,
          reason: trimmed,
        };

        try {
          await api(`expenses/${expense.id}/void`, 'POST', body, retryKey.current);
          onDone();
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('40001') || msg.toLowerCase().includes('conflict') || msg.toLowerCase().includes('reload')) {
            setError('This voucher was modified by another session. Please close and reload.');
          } else {
            setError(msg);
          }
          retryKey.current = crypto.randomUUID();
        } finally {
          setBusy(false);
        }
      }}
    >
      <div style={{ background: '#fff0ed', border: '1px solid #edccc8', borderRadius: '6px', padding: '12px', marginBottom: '16px', fontSize: '11px', color: '#8b221e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, marginBottom: '4px' }}>
          <AlertCircle size={15} /> Permanent Audit Action
        </div>
        Voiding this expense permanently excludes this amount from restaurant operational cost calculations and Net Profit deductions. This action cannot be undone.
      </div>

      <div style={{ background: '#f9fdfa', border: '1px solid var(--line)', borderRadius: '6px', padding: '12px', marginBottom: '16px', fontSize: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span><strong>Date Incurred:</strong> {formatDisplayDate(expense.incurred_on)}</span>
          <span className={`badge cat-${expense.category}`}>{expense.category}</span>
        </div>
        <div><strong>Amount:</strong> <strong style={{ color: 'var(--forest)' }}>{money(expense.amount)}</strong></div>
        <div style={{ marginTop: '4px', color: 'var(--muted)', fontSize: '11px' }}>
          <strong>Description:</strong> {expense.description || 'N/A'}
        </div>
      </div>

      <Field label="Reason for Voiding (Audited · Min 3 characters)">
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {QUICK_VOID_REASONS.map(r => (
            <button
              key={r}
              type="button"
              className="soft"
              style={{ padding: '3px 8px', fontSize: '10px', borderRadius: '3px' }}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          placeholder="Describe why this expense is being voided (e.g. Duplicate entry by staff)..."
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', fontSize: '10px', color: reason.trim().length >= 3 ? 'var(--muted)' : '#9c2621' }}>
          {reason.trim().length} / 1000 characters (min 3 required)
        </div>
      </Field>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button
          type="button"
          className="soft full"
          disabled={busy}
          onClick={onDone}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="danger full"
          disabled={busy || reason.trim().length < 3}
        >
          {busy ? 'Voiding…' : 'Confirm & Void Expense'}
        </button>
      </div>
    </form>
  );
}
