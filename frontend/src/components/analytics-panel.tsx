'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  Receipt,
  UtensilsCrossed,
  Award,
  Calendar,
  Search,
  ArrowUpDown,
  AlertCircle,
  HelpCircle,
  Sparkles,
  Zap,
  Gem,
  AlertTriangle,
  ChevronDown,
  Star,
  MessageSquareText,
  CircleAlert
} from 'lucide-react';
import {
  api,
  money,
  AnalyticsItem,
  AnalyticsMatrixQuadrant,
  AnalyticsSummaryData,
  DailySalesItem,
  AnalyticsSalesData,
  AnalyticsReportResponse,
} from '@/lib/api';
import { Empty } from './ui';

type DatePreset = 'six_months' | 'today' | 'last_7_days' | 'this_month' | 'last_30_days' | 'last_90_days' | 'custom';
type CustomerReview={id:string;rating:number;comment:string;analysis_status:string;created_at:string};
type ReviewAspect={aspect:string;sentiment:'positive'|'neutral'|'negative'|'mixed';mentions:number};
type ReviewSummary={start_date:string;end_date:string;items:ReviewAspect[];reviews_received:number;reviews_analyzed:number};

function getKarachiDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
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

function formatShortDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

export function AnalyticsPanel() {
  const [preset, setPreset] = useState<DatePreset>('six_months');
  const today = useMemo(() => getKarachiDate(), []);

  const firstOfMonth = useMemo(() => {
    const parts = today.split('-');
    return `${parts[0]}-${parts[1]}-01`;
  }, [today]);

  const sevenDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return getKarachiDate(d);
  }, []);

  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return getKarachiDate(d);
  }, []);

  const ninetyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 89);
    return getKarachiDate(d);
  }, []);

  const sixMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return getKarachiDate(d);
  }, []);

  const [customStart, setCustomStart] = useState(firstOfMonth);
  const [customEnd, setCustomEnd] = useState(today);

  // Active Date Bounds
  const startDate = useMemo(() => {
    if (preset === 'six_months') return sixMonthsAgo;
    if (preset === 'today') return today;
    if (preset === 'last_7_days') return sevenDaysAgo;
    if (preset === 'this_month') return firstOfMonth;
    if (preset === 'last_30_days') return thirtyDaysAgo;
    if (preset === 'last_90_days') return ninetyDaysAgo;
    return customStart;
  }, [preset, today, sevenDaysAgo, firstOfMonth, thirtyDaysAgo, ninetyDaysAgo, sixMonthsAgo, customStart]);

  const endDate = useMemo(() => {
    if (preset === 'custom') return customEnd;
    return today;
  }, [preset, customEnd, today]);

  // Data states
  const [summary, setSummary] = useState<AnalyticsSummaryData | null>(null);
  const [sales, setSales] = useState<DailySalesItem[]>([]);
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Table filtering & sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedQuadrant, setSelectedQuadrant] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'revenue' | 'volume' | 'margin_pct' | 'margin_pkr'>('revenue');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Chart hover state
  const [hoveredDay, setHoveredDay] = useState<DailySalesItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const datesQuery = `start_date=${startDate}&end_date=${endDate}`;
      const [sumRes, salesRes, reviewRes, reviewAspectRes] = await Promise.all([
        api<AnalyticsReportResponse<AnalyticsSummaryData>>(`analytics/summary?${datesQuery}`),
        api<AnalyticsReportResponse<AnalyticsSalesData>>(`analytics/sales?${datesQuery}`).catch(() => null),
        api<{items:CustomerReview[]}>(`reviews?limit=100&offset=0`).catch(() => null),
        api<AnalyticsReportResponse<ReviewSummary>>(`analytics/review_aspects?${datesQuery}`).catch(() => null),
      ]);

      setSummary(sumRes.data);
      if (salesRes && salesRes.data && Array.isArray(salesRes.data.items)) {
        setSales(salesRes.data.items);
      } else {
        setSales([]);
      }
      setReviews((reviewRes?.items||[]).filter(review=>{
        const day=getKarachiDate(new Date(review.created_at));
        return day>=startDate&&day<=endDate;
      }));
      setReviewSummary(reviewAspectRes?.data||null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => void loadData(), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Filtered & Sorted Table Items
  const filteredDishes = useMemo(() => {
    if (!summary?.items) return [];
    return summary.items
      .filter(item => {
        if (selectedQuadrant !== 'all' && item.matrix !== selectedQuadrant) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          if (!item.name.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let valA = 0;
        let valB = 0;
        if (sortBy === 'revenue') {
          valA = Number(a.net_revenue) || 0;
          valB = Number(b.net_revenue) || 0;
        } else if (sortBy === 'volume') {
          valA = a.quantity || 0;
          valB = b.quantity || 0;
        } else if (sortBy === 'margin_pct') {
          valA = a.margin_percent || 0;
          valB = b.margin_percent || 0;
        } else if (sortBy === 'margin_pkr') {
          valA = Number(a.contribution_margin) || 0;
          valB = Number(b.contribution_margin) || 0;
        }
        return sortOrder === 'desc' ? valB - valA : valA - valB;
      });
  }, [summary, selectedQuadrant, searchQuery, sortBy, sortOrder]);

  // Quadrant aggregations for 2x2 matrix
  const quadrantStats = useMemo(() => {
    const stats = {
      stars: { count: 0, volume: 0, profit: 0, dishes: [] as AnalyticsItem[] },
      plowhorses: { count: 0, volume: 0, profit: 0, dishes: [] as AnalyticsItem[] },
      puzzles: { count: 0, volume: 0, profit: 0, dishes: [] as AnalyticsItem[] },
      dogs: { count: 0, volume: 0, profit: 0, dishes: [] as AnalyticsItem[] },
    };

    if (!summary?.items) return stats;

    summary.items.forEach(item => {
      const vol = item.quantity || 0;
      const prof = Number(item.contribution_margin) || 0;

      if (item.matrix === 'high_volume/high_margin') {
        stats.stars.count += 1;
        stats.stars.volume += vol;
        stats.stars.profit += prof;
        stats.stars.dishes.push(item);
      } else if (item.matrix === 'high_volume/low_margin') {
        stats.plowhorses.count += 1;
        stats.plowhorses.volume += vol;
        stats.plowhorses.profit += prof;
        stats.plowhorses.dishes.push(item);
      } else if (item.matrix === 'low_volume/high_margin') {
        stats.puzzles.count += 1;
        stats.puzzles.volume += vol;
        stats.puzzles.profit += prof;
        stats.puzzles.dishes.push(item);
      } else if (item.matrix === 'low_volume/low_margin') {
        stats.dogs.count += 1;
        stats.dogs.volume += vol;
        stats.dogs.profit += prof;
        stats.dogs.dishes.push(item);
      }
    });

    return stats;
  }, [summary]);

  const monthlyView=preset==='six_months';
  const chartSales=useMemo(()=>{
    if(!monthlyView)return sales;
    const grouped=new Map<string,DailySalesItem>();
    for(const item of sales){
      const key=`${item.day.slice(0,7)}-01`;
      const current=grouped.get(key)||{day:key,completed_orders:0,quantity:0,net_revenue:0,contribution_margin:0};
      current.completed_orders+=item.completed_orders;
      current.quantity+=item.quantity;
      current.net_revenue=Number(current.net_revenue)+Number(item.net_revenue);
      current.contribution_margin=Number(current.contribution_margin)+Number(item.contribution_margin);
      grouped.set(key,current);
    }
    return [...grouped.values()];
  },[monthlyView,sales]);
  const chartMax=useMemo(()=>Math.max(1,...chartSales.map(item=>Number(item.net_revenue)||0))*1.15,[chartSales]);

  // COGS ratio calculation
  const revenueNum = Number(summary?.net_revenue) || 0;
  const cogsNum = Number(summary?.direct_cost) || 0;
  const cogsRatio = revenueNum > 0 ? Math.round((cogsNum / revenueNum) * 100) : 0;
  const netProfitNum = Number(summary?.operating_profit) || 0;

  return (
    <section className="panel" style={{ padding: '24px' }}>
      {/* Top Header */}
      <div className="panel-head" style={{ marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2>Sales, Costs &amp; Profit</h2>
            <span className="badge active" style={{ fontSize: '10px' }}>Recorded figures · PKR</span>
          </div>
          <p className="muted">
            See what the restaurant sold, what it cost, what was spent, and the final profit left for the selected period.
          </p>
        </div>
      </div>

      {error && (
        <div className="error" role="alert" style={{ marginBottom: '18px' }}>
          <AlertCircle size={16} /> {error}
          <button className="text-button" style={{ marginLeft: '10px' }} onClick={() => void loadData()}>
            Retry
          </button>
        </div>
      )}

      {/* Step 2.1 — Date Range Selector Bar */}
      <div className="expense-toolbar" style={{ marginBottom: '22px' }}>
        <div className="expense-toolbar-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Reporting Range:
            </span>
            <div className="filter-pills">
              <button
                type="button"
                className={`filter-pill ${preset === 'six_months' ? 'active' : ''}`}
                onClick={() => setPreset('six_months')}
              >
                Full 6-Month History
              </button>
              <button
                type="button"
                className={`filter-pill ${preset === 'today' ? 'active' : ''}`}
                onClick={() => setPreset('today')}
              >
                Today
              </button>
              <button
                type="button"
                className={`filter-pill ${preset === 'last_7_days' ? 'active' : ''}`}
                onClick={() => setPreset('last_7_days')}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                className={`filter-pill ${preset === 'this_month' ? 'active' : ''}`}
                onClick={() => setPreset('this_month')}
              >
                This Month
              </button>
              <button
                type="button"
                className={`filter-pill ${preset === 'last_30_days' ? 'active' : ''}`}
                onClick={() => setPreset('last_30_days')}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                className={`filter-pill ${preset === 'last_90_days' ? 'active' : ''}`}
                onClick={() => setPreset('last_90_days')}
              >
                Last 90 Days
              </button>
              <button
                type="button"
                className={`filter-pill ${preset === 'custom' ? 'active' : ''}`}
                onClick={() => setPreset('custom')}
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
                    onChange={e => setCustomStart(e.target.value)}
                  />
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                  To:
                  <input
                    type="date"
                    min={customStart}
                    max={today}
                    value={customEnd}
                    onChange={e => setCustomEnd(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>

          <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 500 }}>
            {formatDisplayDate(startDate)} &mdash; {formatDisplayDate(endDate)} <span style={{ color: '#2c7345', fontWeight: 600 }}>· Asia/Karachi</span>
          </div>
        </div>
      </div>

      {/* Step 2.2 — Key Financial KPI Cards (Top Row) */}
      <div className="analytics-kpi-grid">
        {/* Card 1: Total Net Revenue */}
        <div className="analytics-kpi-card">
          <div className="metric-header">
            <span>Total Net Revenue</span>
            <Receipt size={17} color="#03241a" />
          </div>
          <strong>{money(summary?.net_revenue || 0)}</strong>
          <small>Cashier settled orders minus discounts</small>
        </div>

        {/* Card 2: Cost of Goods Sold (COGS) */}
        <div className="analytics-kpi-card">
          <div className="metric-header">
            <span>Cost of Goods Sold (COGS)</span>
            <UtensilsCrossed size={17} color="#854d0e" />
          </div>
          <strong style={{ color: '#713f12' }}>{money(summary?.direct_cost || 0)}</strong>
          <small>
            Kitchen recipe consumption + packaging ({cogsRatio}% of revenue)
          </small>
        </div>

        {/* Card 3: Gross Profit & Contribution Margin % */}
        <div className="analytics-kpi-card">
          <div className="metric-header">
            <span>Gross Profit & Margin</span>
            <TrendingUp size={17} color="#1b3a2f" />
          </div>
          <strong style={{ color: '#166534' }}>{money(summary?.contribution_margin || 0)}</strong>
          <small>
            <span style={{ fontWeight: 700, color: '#166534', background: '#dcfce7', padding: '1px 6px', borderRadius: '3px' }}>
              {summary?.margin_threshold || 0}% overall margin
            </span>{' '}
            (Revenue &minus; COGS)
          </small>
        </div>

        {/* Card 4: Store Net Profit */}
        <div className={`analytics-kpi-card ${netProfitNum >= 0 ? 'profit-positive' : 'profit-negative'}`}>
          <div className="metric-header">
            <span>Store Net Profit</span>
            <Award size={17} color={netProfitNum >= 0 ? '#15803d' : '#9c2621'} />
          </div>
          <strong style={{ color: netProfitNum >= 0 ? '#15803d' : '#9c2621' }}>
            {money(summary?.operating_profit || 0)}
          </strong>
          <small>
            Gross Profit &minus; OpEx ({money(summary?.operating_expenses || 0)}) &minus; Losses
          </small>
        </div>
      </div>

      {/* P&L Waterfall Strip */}
      <div className="pnl-waterfall">
        <div className="pnl-step">
          <span>Net Revenue</span>
          <strong>{money(summary?.net_revenue || 0)}</strong>
        </div>
        <div className="pnl-operator">&minus;</div>
        <div className="pnl-step">
          <span>COGS (Direct Costs)</span>
          <strong style={{ color: '#713f12' }}>{money(summary?.direct_cost || 0)}</strong>
        </div>
        <div className="pnl-operator">=</div>
        <div className="pnl-step">
          <span>Gross Profit</span>
          <strong style={{ color: '#166534' }}>{money(summary?.contribution_margin || 0)}</strong>
        </div>
        <div className="pnl-operator">&minus;</div>
        <div className="pnl-step">
          <span>Operating Expenses</span>
          <strong style={{ color: '#735824' }}>{money(summary?.operating_expenses || 0)}</strong>
        </div>
        <div className="pnl-operator">&minus;</div>
        <div className="pnl-step">
          <span>Wastage & Cancel Losses</span>
          <strong style={{ color: '#9c2621' }}>
            {money(Number(summary?.stock_losses || 0) + Number(summary?.cancellation_losses || 0))}
          </strong>
        </div>
        <div className="pnl-operator">=</div>
        <div className="pnl-step">
          <span>Store Net Profit</span>
          <strong style={{ color: netProfitNum >= 0 ? '#15803d' : '#9c2621', fontSize: '15px' }}>
            {money(summary?.operating_profit || 0)}
          </strong>
        </div>
      </div>

      {/* Step 2.3 — Sales & Margin Trend Graph */}
      <div className="chart-card">
        <div className="chart-card-header">
          <div>
            <h3>{monthlyView?'Six-Month Sales History':'Sales and Cost History'}</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '12px' }}>
              Every completed cashier settlement in the selected period, grouped {monthlyView?'by month':'by day'}.
            </p>
          </div>
          <div className="chart-legend">
            <div className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: '#03241a' }} />
              <span>Net Revenue (PKR)</span>
            </div>
            <div className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: '#d4a349' }} />
              <span>Direct Cost (COGS)</span>
            </div>
            <div className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: '#10b981' }} />
              <span>Contribution Margin</span>
            </div>
          </div>
        </div>

        {chartSales.length > 0 ? (
          <div style={{ position: 'relative', width: '100%', height: '240px' }}>
            <svg
              viewBox={`0 0 ${Math.max(chartSales.length * 90, 600)} 200`}
              style={{ width: '100%', height: '100%', overflow: 'visible' }}
            >
              <defs>
                <linearGradient id="revenueBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#03241a" />
                  <stop offset="100%" stopColor="#153c2e" />
                </linearGradient>
                <linearGradient id="cogsBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#eab308" />
                  <stop offset="100%" stopColor="#ca8a04" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines */}
              {[0, 50, 100, 150].map(y => (
                <line
                  key={y}
                  x1="0"
                  y1={y}
                  x2={Math.max(chartSales.length * 90, 600)}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeDasharray="4 4"
                />
              ))}

              {/* Render Daily Bars */}
              {chartSales.map((item, idx) => {
                const totalWidth = Math.max(chartSales.length * 90, 600);
                const step = totalWidth / chartSales.length;
                const x = idx * step + step / 2;
                const barWidth = Math.min(step * 0.55, 36);

                const rev = Number(item.net_revenue) || 0;
                const margin = Number(item.contribution_margin) || 0;
                const cogs = Math.max(0, rev - margin);

                const revHeight = (rev / chartMax) * 160;
                const cogsHeight = (cogs / chartMax) * 160;

                const isHovered = hoveredDay?.day === item.day;

                return (
                  <g
                    key={item.day}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredDay(item)}
                    onMouseLeave={() => setHoveredDay(null)}
                  >
                    {/* Revenue Bar */}
                    <rect
                      x={x - barWidth / 2}
                      y={180 - revHeight}
                      width={barWidth}
                      height={Math.max(revHeight, 2)}
                      rx="3"
                      fill="url(#revenueBarGrad)"
                      opacity={isHovered ? 1 : 0.88}
                    />

                    {/* COGS Segment Bar */}
                    <rect
                      x={x - barWidth / 2}
                      y={180 - cogsHeight}
                      width={barWidth}
                      height={Math.max(cogsHeight, 2)}
                      rx="2"
                      fill="url(#cogsBarGrad)"
                      opacity={isHovered ? 0.95 : 0.75}
                    />

                    {/* Date label */}
                    <text
                      x={x}
                      y="196"
                      fontSize="9"
                      fill="#6b7280"
                      textAnchor="middle"
                      fontWeight={isHovered ? 'bold' : 'normal'}
                    >
                      {monthlyView?new Date(item.day+'T12:00:00Z').toLocaleDateString('en-PK',{month:'short',year:'2-digit',timeZone:'Asia/Karachi'}):formatShortDate(item.day)}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Hover Tooltip Popup */}
            {hoveredDay && (
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '15px',
                  background: 'rgba(3, 36, 26, 0.95)',
                  color: '#fff',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  lineHeight: '1.5',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              >
                <div style={{ fontWeight: 600, color: '#ffc657', marginBottom: '4px' }}>
                  {formatDisplayDate(hoveredDay.day)} · {hoveredDay.completed_orders} orders
                </div>
                <div>Revenue: <strong>{money(hoveredDay.net_revenue)}</strong></div>
                <div>COGS: <strong>{money(Number(hoveredDay.net_revenue) - Number(hoveredDay.contribution_margin))}</strong></div>
                <div>Margin: <strong style={{ color: '#86efac' }}>{money(hoveredDay.contribution_margin)}</strong></div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)', fontSize: '12px' }}>
            {loading ? 'Analyzing historical sales snapshots…' : 'No completed settled orders found in this date window.'}
          </div>
        )}
      </div>

      <div className="customer-feedback-section">
        <div className="customer-feedback-head">
          <div>
            <h3><MessageSquareText size={18}/> Customer Feedback</h3>
            <p>Real customer comments and the main service areas mentioned in them.</p>
          </div>
          <div className="feedback-totals">
            <strong>{reviewSummary?.reviews_received||0}</strong><span>reviews in this period</span>
            <strong>{reviewSummary?.reviews_analyzed||0}</strong><span>comments checked</span>
          </div>
        </div>
        <div className="feedback-layout">
          <div className="feedback-aspects">
            {['taste','price_value','service_speed','cleanliness'].map(aspect=>{
              const rows=(reviewSummary?.items||[]).filter(item=>item.aspect===aspect);
              const good=rows.filter(item=>item.sentiment==='positive').reduce((sum,item)=>sum+item.mentions,0);
              const concern=rows.filter(item=>item.sentiment==='negative'||item.sentiment==='mixed').reduce((sum,item)=>sum+item.mentions,0);
              const label={taste:'Food taste',price_value:'Price & value',service_speed:'Service speed',cleanliness:'Cleanliness'}[aspect];
              return <article key={aspect}><span>{label}</span><strong>{good} positive</strong><small>{concern} need attention</small></article>;
            })}
          </div>
          <div className="review-list">
            {reviews.slice(0,4).map(review=><article key={review.id}><div><span className="review-stars" aria-label={`${review.rating} out of 5 stars`}>{Array.from({length:5},(_,index)=><Star key={index} size={12} fill={index<review.rating?'currentColor':'none'}/>)}</span><small>{new Date(review.created_at).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Karachi'})}</small></div><p>{review.comment}</p><span className={`review-state ${review.analysis_status}`}>{review.analysis_status==='completed'?'Checked':review.analysis_status==='failed'?'Needs manual review':'Being checked'}</span></article>)}
            {!reviews.length&&<Empty>No customer reviews have been received yet.</Empty>}
          </div>
        </div>
      </div>

      {/* Menu performance groups */}
      <div className="matrix-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '19px' }}>Menu Performance</h3>
              <span className="badge" style={{ background: '#fef3c7', color: '#735824' }}>Sales + profit</span>
            </div>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '12px' }}>
              Dishes are grouped by how often they sell and how much profit they contribute.
            </p>
          </div>

          <div className="filter-pills">
            <button
              type="button"
              className={`filter-pill ${selectedQuadrant === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedQuadrant('all')}
            >
              All Quadrants
            </button>
            <button
              type="button"
              className={`filter-pill ${selectedQuadrant === 'high_volume/high_margin' ? 'active' : ''}`}
              onClick={() => setSelectedQuadrant('high_volume/high_margin')}
            >
              Best Sellers ({quadrantStats.stars.count})
            </button>
            <button
              type="button"
              className={`filter-pill ${selectedQuadrant === 'high_volume/low_margin' ? 'active' : ''}`}
              onClick={() => setSelectedQuadrant('high_volume/low_margin')}
            >
              Popular, Lower Profit ({quadrantStats.plowhorses.count})
            </button>
            <button
              type="button"
              className={`filter-pill ${selectedQuadrant === 'low_volume/high_margin' ? 'active' : ''}`}
              onClick={() => setSelectedQuadrant('low_volume/high_margin')}
            >
              Growth Opportunities ({quadrantStats.puzzles.count})
            </button>
            <button
              type="button"
              className={`filter-pill ${selectedQuadrant === 'low_volume/low_margin' ? 'active' : ''}`}
              onClick={() => setSelectedQuadrant('low_volume/low_margin')}
            >
              Needs Attention ({quadrantStats.dogs.count})
            </button>
          </div>
        </div>

        {/* 4 Quadrant Grid */}
        <div className="matrix-grid">
          {/* Quadrant 1: Stars */}
          <div className="matrix-quadrant-card quadrant-stars">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={16} color="#ca8a04" />
                <strong style={{ fontSize: '14px', color: '#735824' }}>Best Sellers</strong>
              </div>
              <span className="matrix-badge star">{quadrantStats.stars.count} dishes</span>
            </div>
            <p style={{ margin: '4px 0', fontSize: '11px', color: '#713f12' }}>
              High Volume + High Margin. Highly popular dishes generating maximum profit.
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', background: '#fff', padding: '8px 10px', borderRadius: '4px', border: '1px solid #fef08a' }}>
              <span>Total Volume: <strong>{quadrantStats.stars.volume} sold</strong></span>
              <span>Total Profit: <strong>{money(quadrantStats.stars.profit)}</strong></span>
            </div>
            <div style={{ fontSize: '10px', color: '#854d0e', fontStyle: 'italic', marginTop: '4px' }}>
              Strategy: Maintain recipe consistency & prominent placement on menu.
            </div>
          </div>

          {/* Quadrant 2: Popular / Plowhorses */}
          <div className="matrix-quadrant-card quadrant-plowhorses">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap size={16} color="#356246" />
                <strong style={{ fontSize: '14px', color: '#254d35' }}>Popular, Lower Profit</strong>
              </div>
              <span className="matrix-badge plowhorse">{quadrantStats.plowhorses.count} dishes</span>
            </div>
            <p style={{ margin: '4px 0', fontSize: '11px', color: '#476455' }}>
              High Volume + Lower Margin. Sells rapidly, but ingredient or packaging costs eat into profit.
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', background: '#fff', padding: '8px 10px', borderRadius: '4px', border: '1px solid #c9dfce' }}>
              <span>Total Volume: <strong>{quadrantStats.plowhorses.volume} sold</strong></span>
              <span>Total Profit: <strong>{money(quadrantStats.plowhorses.profit)}</strong></span>
            </div>
            <div style={{ fontSize: '10px', color: '#356246', fontStyle: 'italic', marginTop: '4px' }}>
              Strategy: Audit portion sizes, negotiate supplier bulk costs, or slight price increase.
            </div>
          </div>

          {/* Quadrant 3: Hidden Gems / Puzzles */}
          <div className="matrix-quadrant-card quadrant-puzzles">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Gem size={16} color="#356246" />
                <strong style={{ fontSize: '14px', color: '#356246' }}>Growth Opportunities</strong>
              </div>
              <span className="matrix-badge puzzle">{quadrantStats.puzzles.count} dishes</span>
            </div>
            <p style={{ margin: '4px 0', fontSize: '11px', color: '#476455' }}>
              Low Volume + High Margin. High profit potential per plate, but ordered infrequently.
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', background: '#fff', padding: '8px 10px', borderRadius: '4px', border: '1px solid #c9dfce' }}>
              <span>Total Volume: <strong>{quadrantStats.puzzles.volume} sold</strong></span>
              <span>Total Profit: <strong>{money(quadrantStats.puzzles.profit)}</strong></span>
            </div>
            <div style={{ fontSize: '10px', color: '#356246', fontStyle: 'italic', marginTop: '4px' }}>
              Strategy: Pair in dinner combos, incentivize waiter recommendations, feature in social media.
            </div>
          </div>

          {/* Quadrant 4: Underperformers / Dogs */}
          <div className="matrix-quadrant-card quadrant-dogs">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={16} color="#dc2626" />
                <strong style={{ fontSize: '14px', color: '#8b312b' }}>Needs Attention</strong>
              </div>
              <span className="matrix-badge dog">{quadrantStats.dogs.count} dishes</span>
            </div>
            <p style={{ margin: '4px 0', fontSize: '11px', color: '#7f1d1d' }}>
              Low Volume + Low Margin. Weak sales and low profit contribution.
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', background: '#fff', padding: '8px 10px', borderRadius: '4px', border: '1px solid #fecaca' }}>
              <span>Total Volume: <strong>{quadrantStats.dogs.volume} sold</strong></span>
              <span>Total Profit: <strong>{money(quadrantStats.dogs.profit)}</strong></span>
            </div>
            <div style={{ fontSize: '10px', color: '#991b1b', fontStyle: 'italic', marginTop: '4px' }}>
              Strategy: Re-engineer recipe ingredients or consider retiring from menu to save prep inventory.
            </div>
          </div>
        </div>
      </div>

      {/* Step 2.5 — Dish Profitability Breakdown Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px' }}>Dish Profitability Breakdown</h3>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: '11px' }}>
            Calculated from completed cashier settlements and frozen recipe snapshot costs
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Search Box */}
          <div className="search" style={{ maxWidth: '240px' }}>
            <Search size={14} color="var(--muted)" />
            <input
              type="text"
              placeholder="Search dish name…"
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

          {/* Sort Dropdown */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
            <span style={{ color: 'var(--muted)' }}>Sort:</span>
            <select
              style={{ minHeight: '32px', padding: '4px 8px', fontSize: '11px' }}
              value={`${sortBy}-${sortOrder}`}
              onChange={e => {
                const [by, ord] = e.target.value.split('-') as [typeof sortBy, typeof sortOrder];
                setSortBy(by);
                setSortOrder(ord);
              }}
            >
              <option value="revenue-desc">Highest Revenue</option>
              <option value="volume-desc">Highest Units Sold</option>
              <option value="margin_pct-desc">Highest Margin %</option>
              <option value="margin_pkr-desc">Highest Margin (PKR)</option>
              <option value="margin_pct-asc">Lowest Margin %</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="table-wrap" style={{ borderRadius: '6px', border: '1px solid var(--line)' }}>
        <table>
          <thead>
            <tr>
              <th>Dish Name</th>
              <th style={{ width: '150px' }}>Performance Quadrant</th>
              <th style={{ width: '100px', textAlign: 'right' }}>Units Sold</th>
              <th style={{ width: '125px', textAlign: 'right' }}>Selling Price</th>
              <th style={{ width: '125px', textAlign: 'right' }}>Direct Cost</th>
              <th style={{ width: '150px', textAlign: 'right' }}>Contribution Margin</th>
              <th style={{ width: '130px', textAlign: 'center' }}>Margin %</th>
              <th style={{ width: '140px', textAlign: 'right' }}>Total Revenue</th>
            </tr>
          </thead>
          <tbody>
            {filteredDishes.map(dish => {
              const qty = dish.quantity || 0;
              const rev = Number(dish.net_revenue) || 0;
              const marginTotal = Number(dish.contribution_margin) || 0;
              const unitPrice = qty > 0 ? rev / qty : 0;
              const unitCost = qty > 0 ? (rev - marginTotal) / qty : 0;
              const marginPct = dish.margin_percent !== null ? Number(dish.margin_percent) : 0;

              return (
                <tr key={dish.menu_item_id}>
                  {/* Column 1: Dish Name */}
                  <td>
                    <strong>{dish.name}</strong>
                  </td>

                  {/* Column 2: Performance Quadrant */}
                  <td>
                    {dish.matrix === 'high_volume/high_margin' ? (
                      <span className="matrix-badge star"><Star size={11}/> Best Seller</span>
                    ) : dish.matrix === 'high_volume/low_margin' ? (
                      <span className="matrix-badge plowhorse"><Zap size={11}/> Popular</span>
                    ) : dish.matrix === 'low_volume/high_margin' ? (
                      <span className="matrix-badge puzzle"><Gem size={11}/> Opportunity</span>
                    ) : dish.matrix === 'low_volume/low_margin' ? (
                      <span className="matrix-badge dog"><CircleAlert size={11}/> Needs Attention</span>
                    ) : (
                      <span className="matrix-badge unranked">Not enough sales yet</span>
                    )}
                  </td>

                  {/* Column 3: Units Sold */}
                  <td style={{ textAlign: 'right' }}>
                    <strong>{qty}</strong> <span className="muted small">plates</span>
                  </td>

                  {/* Column 4: Selling Price */}
                  <td style={{ textAlign: 'right' }}>
                    {money(unitPrice)}
                  </td>

                  {/* Column 5: Direct Cost */}
                  <td style={{ textAlign: 'right', color: '#854d0e' }}>
                    {money(unitCost)}
                  </td>

                  {/* Column 6: Contribution Margin (PKR) */}
                  <td style={{ textAlign: 'right' }}>
                    <strong style={{ color: '#15803d' }}>{money(marginTotal)}</strong>
                  </td>

                  {/* Column 7: Margin % with visual progress bar */}
                  <td style={{ textAlign: 'center' }}>
                    <div className="margin-bar-container" style={{ justifyContent: 'center' }}>
                      <div className="margin-bar-bg">
                        <div
                          className={`margin-bar-fill ${marginPct >= 50 ? 'high' : marginPct >= 35 ? 'medium' : 'low'}`}
                          style={{ width: `${Math.min(Math.max(marginPct, 0), 100)}%` }}
                        />
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 600 }}>{marginPct}%</span>
                    </div>
                  </td>

                  {/* Column 8: Total Revenue */}
                  <td style={{ textAlign: 'right' }}>
                    <strong>{money(rev)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!filteredDishes.length && (
        <Empty>
          {loading ? 'Analyzing dish contribution margins…' : 'No dishes match the selected quadrant or search term.'}
        </Empty>
      )}
    </section>
  );
}
