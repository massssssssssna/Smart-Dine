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
} from '@/lib/api';
import { Modal } from './ui';

export function ForecastsPanel() {
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
