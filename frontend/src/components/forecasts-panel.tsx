'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp,
  LineChart,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Sparkles,
  UploadCloud,
  FileDown,
  Play,
  HelpCircle,
  ChefHat,
  Package,
  Search,
  Filter,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  ChevronRight,
  LoaderCircle,
  XCircle,
  Activity,
} from 'lucide-react';
import {
  api,
  money,
  MenuItem,
  ForecastRun,
  ForecastResult,
  ProcessingJob,
  HistoryImportResult,
  Page,
  Order,
} from '@/lib/api';
import { Modal } from './ui';

export function ForecastsPanel({ orders = [] }: { orders?: Order[] }) {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [forecastRuns, setForecastRuns] = useState<ForecastRun[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // Forecast triggering states
  const [triggeringItem, setTriggeringItem] = useState<string | null>(null);
  const [batchTriggering, setBatchTriggering] = useState<boolean>(false);

  // CSV Import Modal states
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [csvSourceName, setCsvSourceName] = useState<string>('POS Historical Data');
  const [csvText, setCsvText] = useState<string>('');
  const [importing, setImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>('');
  const [importSuccess, setImportSuccess] = useState<HistoryImportResult | null>(null);

  // SVG Chart hover states
  const [hoveredDay, setHoveredDay] = useState<{ day: string; quantity: number } | null>(null);

  // Load initial data
  const loadData = useCallback(async () => {
    try {
      const [menuRes, runsRes, jobsRes] = await Promise.all([
        api<Page<MenuItem>>('menu?limit=100'),
        api<Page<ForecastRun>>('forecasts?limit=100'),
        api<Page<ProcessingJob>>('forecasts/jobs?limit=50'),
      ]);
      setMenuItems(menuRes.items || []);
      setForecastRuns(runsRes.items || []);
      setJobs(jobsRes.items || []);

      if (menuRes.items && menuRes.items.length > 0 && !selectedItemId) {
        setSelectedItemId(menuRes.items[0].id);
      }
    } catch (e) {
      setError((e as Error).message || 'Failed to load demand forecasting data.');
    } finally {
      setLoading(false);
    }
  }, [selectedItemId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Active job polling (every 3 seconds when jobs are in progress)
  useEffect(() => {
    const hasActiveJobs = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!hasActiveJobs) return;

    const timer = setInterval(async () => {
      try {
        const [jobsRes, runsRes] = await Promise.all([
          api<Page<ProcessingJob>>('forecasts/jobs?limit=50'),
          api<Page<ForecastRun>>('forecasts?limit=100'),
        ]);
        setJobs(jobsRes.items || []);
        setForecastRuns(runsRes.items || []);
      } catch {
        // silent polling fail
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [jobs]);

  // Categories list
  const categories = useMemo(() => {
    const cats = new Set(menuItems.map((m) => m.category).filter(Boolean));
    return ['all', ...Array.from(cats)];
  }, [menuItems]);

  // Filtered menu items
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        return item.name.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  // Latest forecast run map by menu_item_id
  const latestRunByItem = useMemo(() => {
    const map = new Map<string, ForecastRun>();
    for (const run of forecastRuns) {
      if (!map.has(run.menu_item_id)) {
        map.set(run.menu_item_id, run);
      }
    }
    return map;
  }, [forecastRuns]);

  // Focused item and its forecast
  const focusedItem = useMemo(() => {
    return menuItems.find((m) => m.id === selectedItemId) || menuItems[0];
  }, [menuItems, selectedItemId]);

  const focusedForecastRun = useMemo(() => {
    return focusedItem ? latestRunByItem.get(focusedItem.id) : null;
  }, [focusedItem, latestRunByItem]);

  const focusedResult = focusedForecastRun?.result;
  const actualDaily = useMemo(() => {
    if (!focusedItem) return [];
    const totals = new Map<string, number>();
    orders.filter(order => order.status === 'completed').forEach(order => order.items.forEach(item => {
      if (item.menu_item_id === focusedItem.id) {
        const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(order.completed_at || order.created_at));
        totals.set(day,(totals.get(day)||0)+item.quantity);
      }
    }));
    return [...totals.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-14);
  }, [focusedItem, orders]);

  // Global aggregate metrics for Overview Header (Step 4.1)
  const aggregateMetrics = useMemo(() => {
    const completedRuns = forecastRuns.filter((r) => r.result?.status === 'completed');
    if (!completedRuns.length) {
      return {
        avgMae: 0,
        avgWape: 0,
      };
    }
    const totalMae = completedRuns.reduce((acc, r) => acc + (r.result.metrics?.mae || 0), 0);
    const totalWape = completedRuns.reduce((acc, r) => acc + (r.result.metrics?.wape || 0), 0);
    return {
      avgMae: (totalMae / completedRuns.length).toFixed(1),
      avgWape: (totalWape / completedRuns.length * 100).toFixed(1),
    };
  }, [forecastRuns]);

  // Trigger single item forecast run (Step 4.3)
  async function handleRunSingleForecast(itemId: string) {
    setTriggeringItem(itemId);
    setError('');
    try {
      await api(
        'forecasts/runs',
        'POST',
        { menu_item_ids: [itemId] },
        crypto.randomUUID()
      );
      // Reload jobs
      const jobsRes = await api<Page<ProcessingJob>>('forecasts/jobs?limit=50');
      setJobs(jobsRes.items || []);
    } catch (e) {
      setError((e as Error).message || 'Failed to enqueue forecast run.');
    } finally {
      setTriggeringItem(null);
    }
  }

  // Trigger batch forecast for all items (Step 4.3)
  async function handleRunBatchForecast() {
    if (!menuItems.length) return;
    setBatchTriggering(true);
    setError('');
    try {
      const ids = menuItems.map((m) => m.id);
      await api(
        'forecasts/runs',
        'POST',
        { menu_item_ids: ids },
        crypto.randomUUID()
      );
      const jobsRes = await api<Page<ProcessingJob>>('forecasts/jobs?limit=50');
      setJobs(jobsRes.items || []);
    } catch (e) {
      setError((e as Error).message || 'Failed to enqueue batch forecast run.');
    } finally {
      setBatchTriggering(false);
    }
  }

  // Retry failed job
  async function handleRetryJob(jobId: string) {
    try {
      await api(`forecasts/jobs/${jobId}/retry`, 'POST', {}, crypto.randomUUID());
      const jobsRes = await api<Page<ProcessingJob>>('forecasts/jobs?limit=50');
      setJobs(jobsRes.items || []);
    } catch (e) {
      setError((e as Error).message || 'Could not retry job.');
    }
  }

  // Step 4.4: Generate sample CSV template using live menu items
  function handleDownloadSampleCsv() {
    if (!menuItems.length) return;
    const headers = 'day,menu_item_id,quantity,day_status';
    const lines = [headers];

    // Generate 180 days of realistic history
    const today = new Date();
    for (let i = 180; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday

      // Pick top 3 items to populate sample
      const sampleItems = menuItems.slice(0, 3);
      for (const item of sampleItems) {
        // Higher volume on weekends
        const baseQty = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0 ? 35 : 18;
        const variation = Math.floor((i % 7) * 2 - 3);
        const qty = Math.max(5, baseQty + variation);
        lines.push(`${dayStr},${item.id},${qty},complete`);
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smartdine_sample_historical_sales.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Step 4.4: Submit CSV Import
  async function handleImportSubmit() {
    if (!csvText.trim()) {
      setImportError('Please provide CSV content.');
      return;
    }
    setImporting(true);
    setImportError('');
    setImportSuccess(null);
    try {
      const res = await api<HistoryImportResult>(
        'forecasts/history/import',
        'POST',
        { source_name: csvSourceName.trim() || 'Historical Import', csv_text: csvText },
        crypto.randomUUID()
      );
      setImportSuccess(res);
      setCsvText('');
      await loadData();
    } catch (e) {
      setImportError((e as Error).message || 'Failed to import CSV.');
    } finally {
      setImporting(false);
    }
  }

  // Interactive SVG Daily Chart computation
  const chartData = useMemo(() => {
    if (!focusedResult?.daily || !focusedResult.daily.length) return null;
    const daily = focusedResult.daily;
    const maxQty = Math.max(...daily.map((d) => d.quantity), 1);
    const chartHeight = 180;
    const chartWidth = 720;
    const paddingX = 40;
    const paddingY = 24;

    const availableWidth = chartWidth - paddingX * 2;
    const availableHeight = chartHeight - paddingY * 2;

    const stepX = daily.length > 1 ? availableWidth / (daily.length - 1) : 0;

    const points = daily.map((d, index) => {
      const x = paddingX + index * stepX;
      const y = chartHeight - paddingY - (d.quantity / (maxQty * 1.15)) * availableHeight;
      return { x, y, ...d };
    });

    // Generate SVG path string
    const pathD = points.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, '');

    // Uncertainty upper/lower area path
    const interval = focusedResult.prediction_interval;
    const uncertaintyRatio = interval && interval.lower > 0 && interval.upper > 0
      ? interval.upper / Math.max(1, interval.lower)
      : 1.25;

    const upperPoints = points.map((p) => ({
      x: p.x,
      y: Math.max(paddingY, p.y - 12 * (uncertaintyRatio - 1)),
    }));
    const lowerPoints = points.map((p) => ({
      x: p.x,
      y: Math.min(chartHeight - paddingY, p.y + 12 * (uncertaintyRatio - 1)),
    }));

    const upperPath = upperPoints.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, '');
    const lowerPathReversed = [...lowerPoints].reverse().reduce((acc, pt) => {
      return `${acc} L ${pt.x} ${pt.y}`;
    }, '');
    const areaD = `${upperPath} ${lowerPathReversed} Z`;

    return {
      points,
      pathD,
      areaD,
      chartHeight,
      chartWidth,
      maxQty: Math.round(maxQty * 1.15),
      dailyCount: daily.length,
    };
  }, [focusedResult]);

  return (
    <section className="forecasts-container">
      {/* Top Header & Overview (Step 4.1) */}
      <div className="forecasts-overview-header">
        <div className="overview-title-block">
          <div className="overview-badge-row">
            <span className="model-badge active">
              <Calendar size={13} /> 6 months of completed sales
            </span>
            <span className="model-badge baseline">
              <Layers size={13} /> Updated from recorded orders
            </span>
            <span className="model-badge calibrated">
              <ShieldCheck size={13} /> Accuracy checked before display
            </span>
          </div>
          <h2>Demand &amp; Kitchen Planning</h2>
          <p>
            See how many portions each dish may need next month, then plan ingredients and kitchen preparation with a sensible buffer.
          </p>
          <p className="intelligence-helper"><strong>How it works:</strong> The system reads completed sales, checks the estimate against past weeks, saves the result, and then shows it here. Nothing is guessed in the browser.</p>
        </div>

        <div className="overview-actions-row">
          <button
            type="button"
            className="action-btn soft"
            onClick={() => setImportModalOpen(true)}
          >
            <UploadCloud size={16} />
            <span>Import past sales</span>
          </button>
          <button
            type="button"
            className="action-btn primary"
            onClick={() => void handleRunBatchForecast()}
            disabled={batchTriggering}
          >
            {batchTriggering ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}
            <span>Prepare plans for all dishes</span>
          </button>
        </div>
      </div>

      {/* 4-Metric Executive Strip (Step 4.1) */}
      <div className="forecasts-kpi-grid">
        <div className="forecast-kpi-card">
          <div className="kpi-label">Sales history used</div>
          <div className="kpi-val text-sm font-bold">6 complete months</div>
          <div className="kpi-sub">Completed restaurant orders only</div>
        </div>
        <div className="forecast-kpi-card highlight-blue">
          <div className="kpi-label">Accuracy check</div>
          <div className="kpi-val text-sm font-bold">12 weeks tested</div>
          <div className="kpi-sub">Past weeks are hidden and predicted before use</div>
        </div>
        <div className="forecast-kpi-card highlight-purple">
          <div className="kpi-label">Average daily difference</div>
          <div className="kpi-val">{aggregateMetrics.avgMae} <small>units/day</small></div>
          <div className="kpi-sub">Typical difference between expected and actual demand</div>
        </div>
        <div className="forecast-kpi-card highlight-emerald">
          <div className="kpi-label">Overall planning gap</div>
          <div className="kpi-val">{aggregateMetrics.avgWape}%</div>
          <div className="kpi-sub">Lower is better</div>
        </div>
      </div>

      {/* Active Worker Jobs Banner (Step 4.3) */}
      {jobs.some((j) => j.status === 'queued' || j.status === 'running') && (
        <div className="active-jobs-banner">
          <LoaderCircle size={18} className="spin" />
          <div className="jobs-banner-content">
            <strong>Preparing demand plan:</strong> Reading completed sales and checking the likely range for queued dishes…
          </div>
          <span className="jobs-count-tag">
            {jobs.filter((j) => j.status === 'queued' || j.status === 'running').length} in progress
          </span>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div className="decisions-alert error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Forecasting Console (Step 4.2) */}
      <div className="forecasts-main-grid">
        {/* Left Column: Focused Item Deep Dive & Chart */}
        <div className="forecast-focus-pane">
          {/* Item Selector & Category Tabs */}
          <div className="item-selection-bar">
            <div className="item-select-wrap">
              <label htmlFor="dish-demand-select">Focus Dish:</label>
              <select
                id="dish-demand-select"
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
              >
                {filteredMenuItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.category})
                  </option>
                ))}
              </select>
            </div>

            <div className="item-run-action">
              <button
                type="button"
                className="action-btn primary small"
                disabled={triggeringItem === selectedItemId}
                onClick={() => void handleRunSingleForecast(selectedItemId)}
              >
                {triggeringItem === selectedItemId ? (
                  <LoaderCircle size={13} className="spin" />
                ) : (
                  <RotateCcw size={13} />
                )}
                <span>Prepare next-month plan</span>
              </button>
            </div>
          </div>

          {/* Focused Item Analysis Card */}
          {focusedItem && (
            <div className="forecast-card-deepdive">
              <div className="deepdive-header">
                <div>
                  <h3 className="item-title">{focusedItem.name}</h3>
                  <span className="item-meta">
                    Category: {focusedItem.category} · Price: {money(focusedItem.selling_price)}
                  </span>
                </div>
                {focusedResult?.model && (
                  <span className="selected-model-pill">
                    Forecast ready
                  </span>
                )}
              </div>

              {/* Status: Completed vs Insufficient History */}
              {focusedResult?.status === 'completed' ? (
                <>
                  {/* Next-Month Monthly Forecast & Uncertainty Gauge */}
                  <div className="demand-projection-box">
                    <div className="projection-main-stat">
                      <div className="stat-caption">Predicted Demand for Next Month:</div>
                      <div className="stat-number">
                        {Math.round(focusedResult.monthly_quantity || 0)}{' '}
                        <span className="stat-unit">units</span>
                      </div>
                      <div className="stat-period">
                        Horizon: {focusedResult.target_start} ➔ {focusedResult.target_end}
                      </div>
                      <div className="forecast-revenue">Expected sales value <strong>{money(Number(focusedResult.monthly_quantity || 0) * Number(focusedItem.selling_price || 0))}</strong></div>
                    </div>

                    <div className="uncertainty-range-stat">
                      <div className="range-caption">
                        Likely demand range (80% confidence):
                      </div>
                      <div className="range-bounds">
                        <span className="bound-val lower">
                          P10: {Math.round(focusedResult.prediction_interval?.lower || 0)} units
                        </span>
                        <span className="bound-sep">➔</span>
                        <span className="bound-val upper">
                          P90: {Math.round(focusedResult.prediction_interval?.upper || 0)} units
                        </span>
                      </div>
                      <div className="range-gauge-wrap">
                        <div className="gauge-track">
                          <div className="gauge-fill" />
                          <div className="gauge-marker pin-expected" title="Expected" />
                        </div>
                        <div className="gauge-labels">
                          <small>Min Order ({Math.round(focusedResult.prediction_interval?.lower || 0)})</small>
                          <small>Expected ({Math.round(focusedResult.monthly_quantity || 0)})</small>
                          <small>Max Buffer ({Math.round(focusedResult.prediction_interval?.upper || 0)})</small>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="actual-sales-strip">
                    <div><strong>Recent daily sales</strong><span>Actual completed portions from the database</span></div>
                    <div className="actual-sales-bars">{actualDaily.map(([day,value])=><span key={day} title={`${day}: ${value} units`}><i style={{height:`${Math.max(8,(value/Math.max(1,...actualDaily.map(([,v])=>v)))*100)}%`}}/><small>{new Date(`${day}T12:00:00`).getDate()}</small></span>)}</div>
                  </div>

                  {/* Kitchen & Procurement Recommendations */}
                  <div className="operational-guidelines-box">
                    <div className="guideline-item">
                      <Package size={16} className="text-emerald-600" />
                      <div>
                        <strong>Procurement Guideline:</strong> Commit supplier purchase orders for at
                        least {Math.round(focusedResult.prediction_interval?.lower || 0)} units of key
                        ingredients to avoid stockouts.
                      </div>
                    </div>
                    <div className="guideline-item">
                      <ChefHat size={16} />
                      <div>
                        <strong>Kitchen Prep Guideline:</strong> Prepare weekend batch mise-en-place
                        with surge capacity up to {Math.round(focusedResult.prediction_interval?.upper || 0)} units.
                        Avoid holding perishable marinades beyond this limit.
                      </div>
                    </div>
                  </div>

                  {/* SVG Daily Demand Curve Chart (Step 4.2) */}
                  {chartData && (
                    <div className="forecast-chart-container">
                      <div className="chart-header">
                        <div className="chart-title">
                          <LineChart size={15} />
                          <span>Expected daily demand for the next 30 days</span>
                        </div>
                        {hoveredDay && (
                          <div className="chart-hover-pill">
                            <strong>{hoveredDay.day}</strong>: {Math.round(hoveredDay.quantity)} units
                          </div>
                        )}
                      </div>

                      <div className="svg-chart-wrapper">
                        <svg
                          viewBox={`0 0 ${chartData.chartWidth} ${chartData.chartHeight}`}
                          className="forecast-svg"
                        >
                          {/* Uncertainty envelope shaded area */}
                          <path d={chartData.areaD} className="svg-uncertainty-envelope" />

                          {/* Grid reference lines */}
                          <line
                            x1="40"
                            y1={chartData.chartHeight - 24}
                            x2={chartData.chartWidth - 40}
                            y2={chartData.chartHeight - 24}
                            className="svg-grid-line"
                          />

                          {/* Daily Forecast Line */}
                          <path d={chartData.pathD} className="svg-forecast-line" />

                          {/* Daily Points */}
                          {chartData.points.map((pt, i) => (
                            <circle
                              key={i}
                              cx={pt.x}
                              cy={pt.y}
                              r={hoveredDay?.day === pt.day ? 5 : 3}
                              className={`svg-point ${hoveredDay?.day === pt.day ? 'active' : ''}`}
                              onMouseEnter={() => setHoveredDay({ day: pt.day, quantity: pt.quantity })}
                              onMouseLeave={() => setHoveredDay(null)}
                            />
                          ))}
                        </svg>
                      </div>

                      <div className="chart-footer-note">
                        <span>Shaded area: likely lower-to-upper demand range</span>
                        <span>Weekend peaks use the restaurant&apos;s recorded weekly sales pattern</span>
                      </div>
                    </div>
                  )}
                </>
              ) : focusedResult?.status === 'insufficient_history' ? (
                <div className="insufficient-history-card">
                  <AlertCircle size={28} className="text-amber-500" />
                  <h4>More sales history is needed</h4>
                  <p>
                    This plan needs <strong>6 complete calendar months</strong> of daily sales. This dish is currently missing{' '}
                    <strong>{focusedResult.missing_days} days</strong>.
                  </p>
                  <button
                    type="button"
                    className="action-btn soft small"
                    onClick={() => setImportModalOpen(true)}
                  >
                    <UploadCloud size={14} />
                    <span>Upload past sales file</span>
                  </button>
                </div>
              ) : (
                <div className="no-forecast-card">
                  <Clock size={28} className="text-gray-400" />
                  <h4>No demand plan yet</h4>
                  <p>Prepare a next-month plan for this dish when you are ready.</p>
                  <button
                    type="button"
                    className="action-btn primary small"
                    disabled={triggeringItem === selectedItemId}
                    onClick={() => void handleRunSingleForecast(selectedItemId)}
                  >
                    <Play size={13} />
                    <span>Prepare plan now</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: All Items Demand Ledger Table (Step 4.2) */}
        <div className="forecast-ledger-pane">
          <div className="ledger-header-row">
            <h4>Dish planning</h4>
            <div className="ledger-search-input">
              <Search size={13} />
              <input
                type="text"
                placeholder="Filter dishes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="forecast-table-wrap">
            <table className="forecast-table">
              <thead>
                <tr>
                  <th>Dish Name</th>
                  <th>Next month</th>
                  <th>Likely range</th>
                  <th>Planning gap</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredMenuItems.map((item) => {
                  const run = latestRunByItem.get(item.id);
                  const res = run?.result;
                  const isSelected = item.id === selectedItemId;

                  return (
                    <tr
                      key={item.id}
                      className={isSelected ? 'row-selected' : ''}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <td>
                        <div className="dish-name-cell">
                          <strong>{item.name}</strong>
                          <small>{item.category}</small>
                        </div>
                      </td>
                      <td>
                        {res?.status === 'completed' ? (
                          <span className="forecast-qty-val">
                            {Math.round(res.monthly_quantity || 0)} units
                          </span>
                        ) : res?.status === 'insufficient_history' ? (
                          <span className="status-pill warning">Needs History</span>
                        ) : (
                          <span className="status-pill gray">Not Run</span>
                        )}
                      </td>
                      <td>
                        {res?.prediction_interval ? (
                          <span className="interval-bounds-val">
                            [{Math.round(res.prediction_interval.lower)} – {Math.round(res.prediction_interval.upper)}]
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td>
                        {res?.metrics ? (
                          <div className="model-metrics-cell">
                            <span className="model-tag">Checked</span>
                            <small>{(Number(res.metrics.wape || 0) * 100).toFixed(0)}% difference</small>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn-small"
                          title="Run Forecast"
                          disabled={triggeringItem === item.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRunSingleForecast(item.id);
                          }}
                        >
                          {triggeringItem === item.id ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <Play size={13} />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL: HISTORICAL SALES CSV IMPORT (Step 4.4)             */}
      {/* ========================================================= */}
      {importModalOpen && (
        <Modal
          title="Import Past Sales"
          onClose={() => {
            if (!importing) setImportModalOpen(false);
          }}
        >
          <div className="import-modal-body">
            <p className="import-modal-desc">
              If Smart Dine has less than 6 months of live records, upload your previous daily sales here.
            </p>

            <div className="csv-template-box">
              <div className="template-info">
                <strong>Required CSV Headers:</strong>
                <code>day,menu_item_id,quantity,day_status</code>
              </div>
              <button
                type="button"
                className="action-btn soft small"
                onClick={handleDownloadSampleCsv}
              >
                <FileDown size={13} />
                <span>Download Sample Template</span>
              </button>
            </div>

            <div className="import-field-group">
              <label htmlFor="csv-source-name">Source Identifier:</label>
              <input
                id="csv-source-name"
                type="text"
                placeholder="e.g. Legacy POS 2025-2026 Archive"
                value={csvSourceName}
                onChange={(e) => setCsvSourceName(e.target.value)}
              />
            </div>

            <div className="import-field-group">
              <label htmlFor="csv-text-area">Paste CSV Data or Drag File:</label>
              <textarea
                id="csv-text-area"
                rows={8}
                placeholder={`day,menu_item_id,quantity,day_status\n2026-03-01,${menuItems[0]?.id || 'uuid'},25,complete\n2026-03-02,${menuItems[0]?.id || 'uuid'},0,closed`}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
            </div>

            {importError && (
              <div className="decisions-alert error">
                <AlertCircle size={15} />
                <span>{importError}</span>
              </div>
            )}

            {importSuccess && (
              <div className="decisions-alert success">
                <CheckCircle2 size={15} />
                <span>
                  Successfully imported {importSuccess.row_count} historical observations from &quot;
                  {importSuccess.source_name}&quot;!
                </span>
              </div>
            )}

            <div className="modal-actions-bar">
              <button
                type="button"
                className="soft-btn"
                disabled={importing}
                onClick={() => setImportModalOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="action-btn primary"
                disabled={importing || !csvText.trim()}
                onClick={() => void handleImportSubmit()}
              >
                {importing ? <LoaderCircle size={15} className="spin" /> : <UploadCloud size={15} />}
                <span>{importing ? 'Validating & Importing…' : 'Import Sales Data'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
