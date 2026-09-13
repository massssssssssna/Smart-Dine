'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Search,
  Eye,
  TrendingUp,
  Tag,
  ChefHat,
  Package,
  Gift,
  Clock,
  Check,
  LoaderCircle,
  FileSpreadsheet,
  Zap,
} from 'lucide-react';
import {
  api,
  money,
  Recommendation,
  RecommendationActionType,
  RecommendationStatus,
  AuditLogItem,
  Page,
} from '@/lib/api';
import { Modal } from './ui';

export function formatKarachiTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return (
      new Intl.DateTimeFormat('en-PK', {
        timeZone: 'Asia/Karachi',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(d) + ' PKT'
    );
  } catch {
    return isoString;
  }
}

export function formatRelativeTime(isoString: string): string {
  try {
    const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  } catch {
    return '';
  }
}

const REJECTION_PRESETS = [
  'Price increase too aggressive for current neighborhood demand',
  'Supplier agreement already locked; raw material costs stable',
  'Customer sensitivity / Core traditional specialty item',
  'Portion reduction compromises dish standard',
  'Temporary seasonal stock surplus; reorder not required yet',
];

function readableLabel(value:string){return value.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());}
function readableValue(value:unknown):string{
  if(value===null||value===undefined||value==='')return 'Not recorded';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(Array.isArray(value))return value.length?value.map(readableValue).join(' · '):'None';
  if(typeof value==='object')return Object.entries(value as Record<string,unknown>).map(([key,item])=>`${readableLabel(key)}: ${readableValue(item)}`).join(' · ');
  return String(value);
}
function ReadableRecord({value}:{value:Record<string,unknown>}){
  return <dl className="record-list">{Object.entries(value).map(([key,item])=><div key={key}><dt>{readableLabel(key)}</dt><dd>{readableValue(item)}</dd></div>)}</dl>;
}

export function DecisionsAuditPanel() {
  const [subView, setSubView] = useState<'recommendations' | 'audit'>('recommendations');

  // Recommendation states
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recStatusFilter, setRecStatusFilter] = useState<'all' | RecommendationStatus>('all');
  const [recCategoryFilter, setRecCategoryFilter] = useState<'all' | RecommendationActionType>('all');
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState<'6m' | '30d' | '7d' | 'month' | '90d'>('6m');
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  // Rejection modal
  const [rejectItem, setRejectItem] = useState<Recommendation | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState('');

  // Audit states
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditEntityFilter, setAuditEntityFilter] = useState<string>('all');
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogItem | null>(null);

  // Load recommendations
  const loadRecommendations = useCallback(async () => {
    setRecLoading(true);
    setRecError('');
    try {
      const query = recStatusFilter !== 'all' ? `?status=${recStatusFilter}&limit=100` : '?limit=100';
      const res = await api<Page<Recommendation>>(`recommendations${query}`);
      setRecommendations(res.items || []);
    } catch (e) {
      setRecError((e as Error).message || 'Failed to load recommendations');
    } finally {
      setRecLoading(false);
    }
  }, [recStatusFilter]);

  // Load audit logs
  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const res = await api<Page<AuditLogItem>>(`audit?limit=50&offset=${auditOffset}`);
      setAuditLogs(res.items || []);
      setAuditTotal(res.total || 0);
    } catch (e) {
      setAuditError((e as Error).message || 'Failed to load audit logs');
    } finally {
      setAuditLoading(false);
    }
  }, [auditOffset]);

  useEffect(() => {
    if (subView === 'recommendations') {
      void loadRecommendations();
    } else {
      void loadAuditLogs();
    }
  }, [subView, loadRecommendations, loadAuditLogs]);

  // Generate recommendations
  async function handleGenerate() {
    setGenerating(true);
    setRecError('');
    try {
      const today = new Date();
      const end_date = today.toISOString().split('T')[0];
      let days = 30;
      if (generatePeriod === '7d') days = 7;
      if (generatePeriod === '90d') days = 90;
      if (generatePeriod === 'month') {
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        days = Math.max(1, Math.floor((today.getTime() - startOfMonth.getTime()) / (1000 * 60 * 60 * 24)));
      }
      const startDateObj = generatePeriod==='6m' ? new Date(today) : new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
      if(generatePeriod==='6m')startDateObj.setMonth(startDateObj.getMonth()-6);
      const start_date = startDateObj.toISOString().split('T')[0];

      await api('recommendations/generate', 'POST', { start_date, end_date }, crypto.randomUUID());
      setGenerateModalOpen(false);
      await loadRecommendations();
    } catch (e) {
      setRecError((e as Error).message || 'Could not generate recommendations');
    } finally {
      setGenerating(false);
    }
  }

  // Approve recommendation
  async function handleApprove(rec: Recommendation) {
    setActiveActionId(rec.id);
    setRecError('');
    try {
      await api(
        `recommendations/${rec.id}/approve`,
        'POST',
        { expected_version: rec.version },
        crypto.randomUUID()
      );
      await loadRecommendations();
    } catch (e) {
      setRecError((e as Error).message || 'Approval failed');
    } finally {
      setActiveActionId(null);
    }
  }

  // Apply recommendation (Live change to database)
  async function handleApply(rec: Recommendation) {
    setActiveActionId(rec.id);
    setRecError('');
    try {
      await api(
        `recommendations/${rec.id}/apply`,
        'POST',
        { expected_version: rec.version },
        crypto.randomUUID()
      );
      await loadRecommendations();
    } catch (e) {
      setRecError((e as Error).message || 'Failed to apply recommendation');
    } finally {
      setActiveActionId(null);
    }
  }

  // Reject recommendation
  async function handleRejectSubmit() {
    if (!rejectItem) return;
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      setRejectError('A meaningful reason of at least 3 characters is required.');
      return;
    }
    setRejectSubmitting(true);
    setRejectError('');
    try {
      await api(
        `recommendations/${rejectItem.id}/reject`,
        'POST',
        { expected_version: rejectItem.version, reason: rejectReason.trim() },
        crypto.randomUUID()
      );
      setRejectItem(null);
      setRejectReason('');
      await loadRecommendations();
    } catch (e) {
      setRejectError((e as Error).message || 'Failed to reject recommendation');
    } finally {
      setRejectSubmitting(false);
    }
  }

  // Computed summary metrics
  const recStats = useMemo(() => {
    const total = recommendations.length;
    const proposed = recommendations.filter((r) => r.status === 'proposed').length;
    const approved = recommendations.filter((r) => r.status === 'approved').length;
    const applied = recommendations.filter((r) => r.status === 'applied').length;
    return { total, proposed, approved, applied };
  }, [recommendations]);

  // Filtered recommendations list
  const filteredRecommendations = useMemo(() => {
    return recommendations.filter((r) => {
      if (recCategoryFilter !== 'all' && r.action_type !== recCategoryFilter) return false;
      return true;
    });
  }, [recommendations, recCategoryFilter]);

  // Filtered audit logs list
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      if (auditEntityFilter !== 'all' && log.entity !== auditEntityFilter) return false;
      if (auditSearch.trim()) {
        const q = auditSearch.toLowerCase();
        const actionMatch = log.action.toLowerCase().includes(q);
        const entityMatch = log.entity.toLowerCase().includes(q);
        const actorMatch = (log.actor_name || '').toLowerCase().includes(q);
        const entityIdMatch = (log.entity_id || '').toLowerCase().includes(q);
        return actionMatch || entityMatch || actorMatch || entityIdMatch;
      }
      return true;
    });
  }, [auditLogs, auditEntityFilter, auditSearch]);

  // Render Category Badge
  function renderCategoryBadge(actionType: RecommendationActionType) {
    switch (actionType) {
      case 'price_update':
        return (
          <span className="rec-cat-badge price">
            <Tag size={12} /> Price Revision
          </span>
        );
      case 'recipe_update':
        return (
          <span className="rec-cat-badge recipe">
            <ChefHat size={12} /> Cost Control / Recipe
          </span>
        );
      case 'marketing':
        return (
          <span className="rec-cat-badge promo">
            <Gift size={12} /> Combo &amp; Promotion
          </span>
        );
      case 'reorder':
        return (
          <span className="rec-cat-badge reorder">
            <Package size={12} /> Stock Replenishment
          </span>
        );
      default:
        return (
          <span className="rec-cat-badge menu">
            <FileSpreadsheet size={12} /> Menu Engineering
          </span>
        );
    }
  }

  // Render Status Badge
  function renderStatusBadge(status: RecommendationStatus) {
    switch (status) {
      case 'proposed':
        return <span className="rec-status-badge proposed"><Clock size={12} /> Needs Review</span>;
      case 'approved':
        return <span className="rec-status-badge approved"><CheckCircle2 size={12} /> Approved (Pending Apply)</span>;
      case 'applied':
        return <span className="rec-status-badge applied"><Zap size={12} /> Live &amp; Applied</span>;
      case 'rejected':
        return <span className="rec-status-badge rejected"><XCircle size={12} /> Rejected</span>;
    }
  }

  // Extract Diff summary from before/after in audit log
  function renderAuditDiffSummary(log: AuditLogItem) {
    const before = log.before_data;
    const after = log.after_data;

    if (!before && !after) return <span className="audit-diff-empty">No state recorded</span>;
    if (!before && after) {
      return (
        <span className="audit-diff-chip created">
          Created: {after.name ? String(after.name) : after.title ? String(after.title) : log.entity}
        </span>
      );
    }
    if (before && after) {
      const keys = Object.keys(after).filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
      );
      if (!keys.length) return <span className="audit-diff-empty">No field change</span>;

      // Special handling for common fields
      if (keys.includes('selling_price')) {
        return (
          <span className="audit-diff-chip changed">
            Price: {money(String(before.selling_price || 0))} ➔ {money(String(after.selling_price || 0))}
          </span>
        );
      }
      if (keys.includes('status')) {
        return (
          <span className="audit-diff-chip changed">
            Status: {String(before.status)} ➔ {String(after.status)}
          </span>
        );
      }
      if (keys.includes('voided_at') || keys.includes('void_reason')) {
        return (
          <span className="audit-diff-chip voided">
            Voided: &quot;{String(after.void_reason || 'No reason')}&quot;
          </span>
        );
      }
      if (keys.includes('discount')) {
        return (
          <span className="audit-diff-chip discount">
            Discount: {money(String(after.discount || 0))}
          </span>
        );
      }
      return (
        <span className="audit-diff-chip changed">
          {keys.slice(0, 2).map((k) => `${k}: ${String(before[k] ?? '—')} ➔ ${String(after[k] ?? '—')}`).join(', ')}
          {keys.length > 2 ? ` (+${keys.length - 2} more)` : ''}
        </span>
      );
    }
    return <span className="audit-diff-empty">Details recorded</span>;
  }

  return (
    <section className="decisions-audit-container">
      {/* Top Segmented Sub-View Switcher */}
      <div className="decisions-subview-header">
        <div className="decisions-subview-pills">
          <button
            type="button"
            className={`subview-pill ${subView === 'recommendations' ? 'active' : ''}`}
            onClick={() => setSubView('recommendations')}
          >
            <Sparkles size={16} />
            <span>Recommended Actions</span>
            {recStats.proposed > 0 && (
              <span className="subview-counter-badge">{recStats.proposed}</span>
            )}
          </button>
          <button
            type="button"
            className={`subview-pill ${subView === 'audit' ? 'active' : ''}`}
            onClick={() => setSubView('audit')}
          >
            <ShieldCheck size={16} />
            <span>Change History</span>
            <span className="subview-counter-badge neutral">{auditTotal}</span>
          </button>
        </div>

        {subView === 'recommendations' ? (
          <button
            type="button"
            className="action-btn primary sparkle-btn"
            onClick={() => setGenerateModalOpen(true)}
            disabled={generating}
          >
            {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
            <span>Create Recommendations</span>
          </button>
        ) : (
          <button
            type="button"
            className="action-btn soft icon-text-btn"
            onClick={() => void loadAuditLogs()}
            disabled={auditLoading}
          >
            <RotateCcw size={15} className={auditLoading ? 'spin' : ''} />
            <span>Refresh Audit Log</span>
          </button>
        )}
      </div>

      {/* ========================================================= */}
      {/* SUB-VIEW A: RECOMMENDED ACTIONS                           */}
      {/* ========================================================= */}
      {subView === 'recommendations' && (
        <div className="recommendations-subview">
          {/* Top KPI Strip */}
          <div className="decisions-kpi-grid">
            <div className="decisions-kpi-card">
              <div className="kpi-label">Available Recommendations</div>
              <div className="kpi-val">{recStats.total}</div>
              <div className="kpi-sub">Actions found from recorded sales and stock</div>
            </div>
            <div className="decisions-kpi-card highlight-amber">
              <div className="kpi-label">Needs Manager Review</div>
              <div className="kpi-val">{recStats.proposed}</div>
              <div className="kpi-sub">Waiting for your decision</div>
            </div>
            <div className="decisions-kpi-card highlight-blue">
              <div className="kpi-label">Approved (Ready to Apply)</div>
              <div className="kpi-val">{recStats.approved}</div>
              <div className="kpi-sub">Approved and ready to apply</div>
            </div>
            <div className="decisions-kpi-card highlight-green">
              <div className="kpi-label">Live &amp; Applied</div>
              <div className="kpi-val">{recStats.applied}</div>
              <div className="kpi-sub">Already applied to the restaurant</div>
            </div>
          </div>

          {/* Filtering Tabs & Category Selector */}
          <div className="decisions-filters-row">
            <div className="filter-pill-group">
              {(['all', 'proposed', 'approved', 'applied', 'rejected'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`filter-pill-item ${recStatusFilter === st ? 'active' : ''}`}
                  onClick={() => setRecStatusFilter(st)}
                >
                  {st === 'all'
                    ? 'All Statuses'
                    : st === 'proposed'
                    ? 'Needs Review'
                    : st === 'approved'
                    ? 'Approved'
                    : st === 'applied'
                    ? 'Applied'
                    : 'Rejected'}
                </button>
              ))}
            </div>

            <div className="category-select-wrapper">
              <select
                aria-label="Filter recommendations by category"
                value={recCategoryFilter}
                onChange={(e) => setRecCategoryFilter(e.target.value as 'all' | RecommendationActionType)}
              >
                <option value="all">All Strategy Categories</option>
                <option value="price_update">Price Revisions</option>
                <option value="recipe_update">Cost Control &amp; Recipes</option>
                <option value="marketing">Combos &amp; Promotions</option>
                <option value="reorder">Stock Replenishment</option>
                <option value="menu_update">Menu Engineering</option>
              </select>
            </div>
          </div>

          {/* Error Message */}
          {recError && (
            <div className="decisions-alert error">
              <AlertCircle size={16} />
              <span>{recError}</span>
            </div>
          )}

          {/* Recommendations Feed Cards */}
          {recLoading ? (
            <div className="decisions-loading-state">
              <LoaderCircle size={32} className="spin" />
              <p>Scanning sales, recipe consumption, and inventory data…</p>
            </div>
          ) : filteredRecommendations.length === 0 ? (
            <div className="decisions-empty-state">
              <Sparkles size={40} />
              <h3>No Recommendations Found</h3>
              <p>
                Click <strong>&quot;Generate New Recommendations&quot;</strong> to analyze current sales margins
                and inventory levels.
              </p>
            </div>
          ) : (
            <div className="recommendations-cards-grid">
              {filteredRecommendations.map((rec) => {
                const isActionBusy = activeActionId === rec.id;
                return (
                  <article key={rec.id} className={`rec-card status-${rec.status}`}>
                    {/* Header */}
                    <div className="rec-card-header">
                      <div className="rec-badges-row">
                        {renderCategoryBadge(rec.action_type)}
                        {renderStatusBadge(rec.status)}
                      </div>
                      <span className="rec-timestamp">{formatRelativeTime(rec.created_at)}</span>
                    </div>

                    {/* Title & Description */}
                    <div className="rec-card-main">
                      <h4 className="rec-card-title">{rec.title}</h4>
                      <p className="rec-card-desc">{rec.description}</p>
                    </div>

                    {/* Proposed Change Box */}
                    <div className="rec-change-box">
                      <div className="change-box-label">Proposed Action:</div>
                      {rec.action_type === 'price_update' && rec.proposed_change?.selling_price !== undefined ? (
                        <div className="change-price-diff">
                          <span>Target New Price:</span>
                          <span className="new-price-val">
                            {money(String(rec.proposed_change.selling_price))}
                          </span>
                        </div>
                      ) : rec.action_type === 'recipe_update' && Array.isArray(rec.proposed_change?.ingredients) ? (
                        <div className="change-recipe-list">
                          <span className="recipe-count-tag">
                            {rec.proposed_change.ingredients.length} Ingredients Updated
                          </span>
                        </div>
                      ) : rec.proposed_change?.instructions ? (
                        <div className="change-instructions">
                          {String(rec.proposed_change.instructions)}
                        </div>
                      ) : (
                        <ReadableRecord value={rec.proposed_change} />
                      )}
                    </div>

                    {/* Supporting Evidence Callout */}
                    {rec.evidence && rec.evidence.length > 0 && (
                      <div className="rec-evidence-box">
                        <div className="evidence-header">
                          <TrendingUp size={13} />
                          <span>Why this is recommended</span>
                        </div>
                        <ul className="evidence-list">
                          {rec.evidence.map((ev, i) => (
                            <li key={i}>
                              <span className="evidence-source">[{ev.source}]</span>{' '}
                              <span className="evidence-summary">{ev.summary}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Expected Impact Tag */}
                    <div className="rec-impact-row">
                      <div className="rec-impact-badge">
                        <TrendingUp size={13} />
                        <span>
                          {rec.action_type === 'price_update'
                            ? 'Expected Impact: Higher Contribution Margin (+10%–20%)'
                            : rec.action_type === 'reorder'
                            ? 'Expected Impact: Stockout & Wastage Protection'
                            : rec.action_type === 'recipe_update'
                            ? 'Expected Impact: Portion Cost Reduction'
                            : 'Expected Impact: Increased Average Ticket Size'}
                        </span>
                      </div>
                    </div>

                    {/* Human-in-the-Loop Action Controls */}
                    <div className="rec-card-actions">
                      {rec.status === 'proposed' && (
                        <>
                          <button
                            type="button"
                            className="btn-approve"
                            disabled={isActionBusy}
                            onClick={() => void handleApprove(rec)}
                          >
                            {isActionBusy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            className="btn-reject"
                            disabled={isActionBusy}
                            onClick={() => {
                              setRejectError('');
                              setRejectReason('');
                              setRejectItem(rec);
                            }}
                          >
                            <XCircle size={14} />
                            <span>Reject</span>
                          </button>
                        </>
                      )}

                      {rec.status === 'approved' && (
                        <>
                          <button
                            type="button"
                            className="btn-apply"
                            disabled={isActionBusy}
                            onClick={() => void handleApply(rec)}
                          >
                            {isActionBusy ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                            <span>Apply Live Change</span>
                          </button>
                          <button
                            type="button"
                            className="btn-reject-soft"
                            disabled={isActionBusy}
                            onClick={() => {
                              setRejectError('');
                              setRejectReason('');
                              setRejectItem(rec);
                            }}
                          >
                            <XCircle size={14} />
                            <span>Reject</span>
                          </button>
                        </>
                      )}

                      {rec.status === 'applied' && (
                        <div className="rec-final-state applied">
                          <CheckCircle2 size={15} />
                          <span>
                            Live &amp; applied to system {rec.applied_at ? `(${formatRelativeTime(rec.applied_at)})` : ''}
                          </span>
                        </div>
                      )}

                      {rec.status === 'rejected' && (
                        <div className="rec-final-state rejected">
                          <XCircle size={15} />
                          <span>Rejected by manager</span>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-VIEW B: SYSTEM AUDIT TRAIL LOG                        */}
      {/* ========================================================= */}
      {subView === 'audit' && (
        <div className="audit-subview">
          {/* Audit Controls & Filters */}
          <div className="audit-controls-bar">
            <div className="audit-search-field">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search audit trail by actor, action, or entity..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
              />
            </div>

            <div className="audit-filters-group">
              <label htmlFor="audit-entity-filter-select" className="sr-only">Filter audit trail by entity</label>
              <select
                id="audit-entity-filter-select"
                value={auditEntityFilter}
                onChange={(e) => setAuditEntityFilter(e.target.value)}
              >
                <option value="all">All Entities</option>
                <option value="orders">Orders</option>
                <option value="menu">Menu Items</option>
                <option value="recipes">Recipes</option>
                <option value="expenses">Operating Expenses</option>
                <option value="inventory">Inventory &amp; Stock</option>
                <option value="recommendations">Recommendations</option>
                <option value="users">Staff &amp; Users</option>
              </select>
            </div>
          </div>

          {/* Error Message */}
          {auditError && (
            <div className="decisions-alert error">
              <AlertCircle size={16} />
              <span>{auditError}</span>
            </div>
          )}

          {/* Audit Table */}
          {auditLoading ? (
            <div className="decisions-loading-state">
              <LoaderCircle size={32} className="spin" />
              <p>Retrieving immutable audit records…</p>
            </div>
          ) : filteredAuditLogs.length === 0 ? (
            <div className="decisions-empty-state">
              <ShieldCheck size={40} />
              <h3>No Audit Events Found</h3>
              <p>No sensitive station events match your selected filters.</p>
            </div>
          ) : (
            <div className="audit-table-wrapper">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Exact Timestamp (PKT)</th>
                    <th>Actor &amp; Role</th>
                    <th>Action Type</th>
                    <th>Entity Affected</th>
                    <th>Before ➔ After Summary</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="audit-cell-time">
                        <div className="audit-exact-time">{formatKarachiTime(log.created_at)}</div>
                        <div className="audit-rel-time">{formatRelativeTime(log.created_at)}</div>
                      </td>
                      <td className="audit-cell-actor">
                        <div className="actor-profile-row">
                          <div className="actor-avatar">
                            {(log.actor_name || 'U').slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <div className="actor-name">{log.actor_name || 'Staff User'}</div>
                            <span className={`actor-role-badge ${log.actor_role || 'staff'}`}>
                              {log.actor_role || 'staff'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="audit-cell-action">
                        <span className={`audit-action-tag ${log.action}`}>
                          {log.action.replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="audit-cell-entity">
                        <span className="entity-badge">{log.entity}</span>
                        {log.entity_id && (
                          <span className="entity-id-pill" title={log.entity_id}>
                            #{log.entity_id.slice(0, 8)}
                          </span>
                        )}
                      </td>
                      <td className="audit-cell-diff">{renderAuditDiffSummary(log)}</td>
                      <td className="audit-cell-view">
                        <button
                          type="button"
                          className="btn-view-diff"
                          onClick={() => setSelectedAuditLog(log)}
                        >
                          <Eye size={13} />
                          <span>View Diff</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Audit Pagination */}
          <div className="audit-pagination-bar">
            <span className="pagination-count-label">
              Showing {filteredAuditLogs.length} of {auditTotal} recorded events
            </span>
            <div className="pagination-buttons">
              <button
                type="button"
                className="pagination-btn"
                disabled={auditOffset <= 0 || auditLoading}
                onClick={() => setAuditOffset((prev) => Math.max(0, prev - 50))}
              >
                <ChevronLeft size={16} />
                <span>Previous</span>
              </button>
              <button
                type="button"
                className="pagination-btn"
                disabled={auditOffset + 50 >= auditTotal || auditLoading}
                onClick={() => setAuditOffset((prev) => prev + 50)}
              >
                <span>Next</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 1: GENERATE RECOMMENDATIONS OPTIONS                 */}
      {/* ========================================================= */}
      {generateModalOpen && (
        <Modal title="Create Business Recommendations" onClose={() => setGenerateModalOpen(false)}>
          <div className="generate-modal-body">
            <p className="generate-modal-desc">
              Smart Dine will check completed sales, dish costs, and current stock to find pricing, profit, and restocking opportunities.
            </p>

            <div className="generate-period-selector">
              <label>Choose the sales period:</label>
              <div className="period-options-grid">
                {[
                  { id: '6m', label: 'Full 6-Month History', desc: 'Use the complete recorded sales pattern' },
                  { id: '7d', label: 'Last 7 Days', desc: 'Recent changes' },
                  { id: '30d', label: 'Last 30 Days (Recommended)', desc: 'A balanced monthly view' },
                  { id: 'month', label: 'This Month', desc: 'Current month only' },
                  { id: '90d', label: 'Last 90 Days', desc: 'Longer sales pattern' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`period-btn ${generatePeriod === opt.id ? 'active' : ''}`}
                    onClick={() => setGeneratePeriod(opt.id as '6m' | '30d' | '7d' | 'month' | '90d')}
                  >
                    <strong>{opt.label}</strong>
                    <small>{opt.desc}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-actions-bar">
              <button
                type="button"
                className="soft-btn"
                onClick={() => setGenerateModalOpen(false)}
                disabled={generating}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-btn primary"
                onClick={() => void handleGenerate()}
                disabled={generating}
              >
                {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
                <span>{generating ? 'Checking records…' : 'Create Recommendations'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: REJECTION REASON MODAL WITH PRESETS              */}
      {/* ========================================================= */}
      {rejectItem && (
        <Modal
          title="Reject Strategy Recommendation"
          onClose={() => {
            if (!rejectSubmitting) setRejectItem(null);
          }}
        >
          <div className="reject-modal-body">
            <div className="reject-target-card">
              <div className="target-title">{rejectItem.title}</div>
              <div className="target-desc">{rejectItem.description}</div>
            </div>

            <p className="reject-instructions">
              Add a short reason so the manager&apos;s decision remains clear in the change history.
            </p>

            <div className="reject-presets-wrap">
              <span className="presets-caption">Quick Presets:</span>
              <div className="preset-chips-list">
                {REJECTION_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="preset-chip"
                    onClick={() => setRejectReason(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="reject-textarea-wrap">
              <label htmlFor="reject-reason-textarea">Reason for declining:</label>
              <textarea
                id="reject-reason-textarea"
                rows={3}
                placeholder="Specify reason for rejecting this strategy recommendation..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>

            {rejectError && (
              <div className="decisions-alert error">
                <AlertCircle size={15} />
                <span>{rejectError}</span>
              </div>
            )}

            <div className="modal-actions-bar">
              <button
                type="button"
                className="soft-btn"
                disabled={rejectSubmitting}
                onClick={() => setRejectItem(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-btn danger"
                disabled={rejectSubmitting || rejectReason.trim().length < 3}
                onClick={() => void handleRejectSubmit()}
              >
                {rejectSubmitting ? <LoaderCircle size={15} className="spin" /> : <XCircle size={15} />}
                <span>Confirm Rejection</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================= */}
      {/* MODAL 3: SIDE-BY-SIDE AUDIT DIFF INSPECTOR                */}
      {/* ========================================================= */}
      {selectedAuditLog && (
        <Modal title="Audit Event Diff Inspector" onClose={() => setSelectedAuditLog(null)}>
          <div className="diff-inspector-modal">
            {/* Metadata strip */}
            <div className="inspector-meta-strip">
              <div>
                <span className="meta-label">Action:</span>
                <span className="meta-val">{selectedAuditLog.action}</span>
              </div>
              <div>
                <span className="meta-label">Entity:</span>
                <span className="meta-val">{selectedAuditLog.entity}</span>
              </div>
              <div>
                <span className="meta-label">Actor:</span>
                <span className="meta-val">
                  {selectedAuditLog.actor_name || 'Staff'} ({selectedAuditLog.actor_role || 'staff'})
                </span>
              </div>
              <div>
                <span className="meta-label">Exact Timestamp:</span>
                <span className="meta-val">{formatKarachiTime(selectedAuditLog.created_at)}</span>
              </div>
            </div>

            {/* Side-by-Side View */}
            <div className="diff-columns-grid">
              {/* Before Column */}
              <div className="diff-col before">
                <div className="diff-col-head">
                  <span className="head-badge red">BEFORE STATE</span>
                  <span className="head-sub">Pre-action snapshot</span>
                </div>
                <div className="diff-content">
                  {selectedAuditLog.before_data ? (
                    <ReadableRecord value={selectedAuditLog.before_data} />
                  ) : (
                    <div className="diff-none-recorded">No pre-existing record (New creation)</div>
                  )}
                </div>
              </div>

              {/* After Column */}
              <div className="diff-col after">
                <div className="diff-col-head">
                  <span className="head-badge green">AFTER STATE</span>
                  <span className="head-sub">Post-action snapshot</span>
                </div>
                <div className="diff-content">
                  {selectedAuditLog.after_data ? (
                    <ReadableRecord value={selectedAuditLog.after_data} />
                  ) : (
                    <div className="diff-none-recorded">Entity voided or deleted</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-actions-bar">
              <button
                type="button"
                className="action-btn soft"
                onClick={() => setSelectedAuditLog(null)}
              >
                Close Inspector
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
