'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, MessageSquareText, RefreshCw, Search, ShieldCheck, Star, TableProperties, Utensils, UserRound } from 'lucide-react';
import { api, CustomerReview, Page } from '@/lib/api';
import styles from './reviews.module.css';

type TimePreset = '30d' | '6m' | 'all';
type ShiftFilter = 'all' | 'morning' | 'lunch' | 'dinner';
type AspectKey = 'taste' | 'service_speed' | 'cleanliness' | 'hospitality' | 'value';
type ParsedDishRating = { menuItemId: string; rating: number; comment?: string };

const ASPECTS: Array<{ key: AspectKey; label: string }> = [
  { key: 'taste', label: 'Taste & quality' }, { key: 'service_speed', label: 'Service speed' },
  { key: 'cleanliness', label: 'Cleanliness' }, { key: 'hospitality', label: 'Staff hospitality' },
  { key: 'value', label: 'Value for price' },
];
const ASPECT_NAME_MAP: Record<string, AspectKey> = { taste: 'taste', 'service speed': 'service_speed', cleanliness: 'cleanliness', hospitality: 'hospitality', value: 'value' };

function parseReviewComment(comment: string) {
  let cleanComment = comment || '';
  const aspectsMatch = cleanComment.match(/\[Aspects:\s*([^\]]*)\]/i);
  const dishesMatch = cleanComment.match(/\[Dish Ratings:\s*([^\]]*)\]/i);
  const aspects: Partial<Record<AspectKey, number>> = {};
  const dishes: ParsedDishRating[] = [];
  if (aspectsMatch) {
    aspectsMatch[1].split(',').forEach(part => {
      const match = part.trim().match(/^(.+?):\s*([1-5])★$/);
      const key = match ? ASPECT_NAME_MAP[match[1].trim().toLowerCase()] : undefined;
      if (match && key) aspects[key] = Number(match[2]);
    });
    cleanComment = cleanComment.replace(aspectsMatch[0], '').trim();
  }
  if (dishesMatch) {
    const pattern = /Dish\s+([0-9a-f-]{36}):\s*([1-5])★(?:\s*\((.*?)\))?/gi;
    for (const match of dishesMatch[1].matchAll(pattern)) dishes.push({ menuItemId: match[1], rating: Number(match[2]), comment: match[3]?.trim() });
    cleanComment = cleanComment.replace(dishesMatch[0], '').trim();
  }
  return { userNote: cleanComment, aspects, dishes };
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const rounded = Math.round(value);
  return <span className={styles.stars} aria-label={`${value} out of 5 stars`}>{[1, 2, 3, 4, 5].map(star => <Star key={star} size={size} className={star <= rounded ? styles.starFilled : styles.starEmpty} />)}</span>;
}

function karachiHour(value: string) {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Karachi' }).formatToParts(new Date(value)).find(part => part.type === 'hour')?.value;
  return Number(hour || 0);
}

async function loadAllReviews() {
  const pageSize = 100;
  const first = await api<Page<CustomerReview>>(`reviews?limit=${pageSize}&offset=0`);
  if (first.total <= first.items.length) return first.items;
  const offsets: number[] = [];
  for (let offset = pageSize; offset < first.total; offset += pageSize) offsets.push(offset);
  const pages = await Promise.all(offsets.map(offset => api<Page<CustomerReview>>(`reviews?limit=${pageSize}&offset=${offset}`)));
  return [first.items, ...pages.map(page => page.items)].flat();
}

export function ReviewsPanel() {
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timePreset, setTimePreset] = useState<TimePreset>('6m');
  const [shift, setShift] = useState<ShiftFilter>('all');
  const [search, setSearch] = useState('');
  const [starFilter, setStarFilter] = useState<'all' | '5' | '4' | '3' | '2' | '1' | 'attention'>('all');
  const load = useCallback(async () => {
    try { setLoading(true); setError(''); setReviews(await loadAllReviews()); }
    catch (err: unknown) { setError((err as Error)?.message || 'Customer reviews could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const enrichedReviews = useMemo(() => reviews.map(review => ({ ...review, parsed: parseReviewComment(review.comment) })), [reviews]);
  const filteredReviews = useMemo(() => {
    const now = Date.now();
    return enrichedReviews.filter(review => {
      const age = now - new Date(review.created_at).getTime();
      if (timePreset === '30d' && age > 30 * 86_400_000) return false;
      if (timePreset === '6m' && age > 183 * 86_400_000) return false;
      const hour = karachiHour(review.order_time || review.created_at);
      if (shift === 'morning' && (hour < 6 || hour >= 12)) return false;
      if (shift === 'lunch' && (hour < 12 || hour >= 17)) return false;
      if (shift === 'dinner' && hour >= 2 && hour < 17) return false;
      return true;
    });
  }, [enrichedReviews, shift, timePreset]);
  const feedReviews = useMemo(() => filteredReviews.filter(review => {
    if (starFilter === 'attention' && review.rating > 3) return false;
    if (starFilter !== 'all' && starFilter !== 'attention' && review.rating !== Number(starFilter)) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [review.parsed.userNote, review.order_number, review.waiter_name, review.table_name_snapshot].some(value => (value || '').toLowerCase().includes(query)) || (review.order_items || []).some(item => item.name.toLowerCase().includes(query));
  }), [filteredReviews, search, starFilter]);

  const totalCount = filteredReviews.length;
  const averageRating = totalCount ? filteredReviews.reduce((sum, review) => sum + review.rating, 0) / totalCount : 0;
  const positiveCount = filteredReviews.filter(review => review.rating >= 4).length;
  const attentionCount = filteredReviews.filter(review => review.rating <= 3).length;
  const positivePercent = totalCount ? Math.round((positiveCount / totalCount) * 100) : 0;
  const starCounts = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    filteredReviews.forEach(review => { counts[review.rating] = (counts[review.rating] || 0) + 1; });
    return counts;
  }, [filteredReviews]);
  const aspectStats = useMemo(() => ASPECTS.map(aspect => {
    const ratings = filteredReviews.map(review => review.parsed.aspects[aspect.key]).filter((rating): rating is number => typeof rating === 'number');
    const evidence = filteredReviews.flatMap(review => review.analysis_result?.aspects || []).find(item => item.aspect === aspect.key || (aspect.key === 'value' && item.aspect === 'price_value'))?.evidence;
    return { ...aspect, count: ratings.length, average: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0, evidence };
  }), [filteredReviews]);
  const dishLeaders = useMemo(() => {
    const dishes = new Map<string, { name: string; ratings: number[] }>();
    filteredReviews.forEach(review => {
      const names = new Map((review.order_items || []).map(item => [item.menu_item_id, item.name]));
      review.parsed.dishes.forEach(dish => { const name = names.get(dish.menuItemId); if (!name) return; const current = dishes.get(dish.menuItemId) || { name, ratings: [] }; current.ratings.push(dish.rating); dishes.set(dish.menuItemId, current); });
    });
    return [...dishes.values()].map(dish => ({ ...dish, average: dish.ratings.reduce((sum, rating) => sum + rating, 0) / dish.ratings.length })).sort((a, b) => b.average - a.average || b.ratings.length - a.ratings.length).slice(0, 5);
  }, [filteredReviews]);
  const serverLeaders = useMemo(() => {
    const servers = new Map<string, number[]>();
    filteredReviews.forEach(review => {
      const hospitalityRating = review.parsed.aspects.hospitality;
      if (!hospitalityRating) return;
      const name = review.waiter_name || 'Service team';
      servers.set(name, [...(servers.get(name) || []), hospitalityRating]);
    });
    return [...servers.entries()].map(([name, ratings]) => ({ name, count: ratings.length, average: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length })).sort((a, b) => b.average - a.average || b.count - a.count).slice(0, 5);
  }, [filteredReviews]);

  return <div className={styles.container}>
    <section className={styles.toolbar} aria-label="Review filters">
      <div className={styles.filterBlock}><span className={styles.filterLabel}>Period</span><div className={styles.segmented}>{([['30d', 'Last 30 days'], ['6m', 'Last 6 months'], ['all', 'All time']] as const).map(([key, label]) => <button key={key} type="button" className={timePreset === key ? styles.selected : ''} onClick={() => setTimePreset(key)}>{label}</button>)}</div></div>
      <div className={styles.toolbarRight}><label className={styles.selectLabel}>Service time<select value={shift} onChange={event => setShift(event.target.value as ShiftFilter)}><option value="all">All day</option><option value="morning">Morning · 6am–12pm</option><option value="lunch">Lunch · 12pm–5pm</option><option value="dinner">Dinner · 5pm–2am</option></select></label><button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? styles.spinning : ''} /> {loading ? 'Refreshing' : 'Refresh'}</button></div>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    <section className={styles.summaryGrid} aria-label="Review summary">
      <article className={styles.summaryCard}><span className={styles.cardIcon}><Star size={17} /></span><small>Average guest rating</small><strong>{averageRating ? averageRating.toFixed(1) : '—'}</strong><Stars value={averageRating} size={18} /></article>
      <article className={styles.summaryCard}><span className={styles.cardIcon}><CheckCircle2 size={17} /></span><small>Positive experiences</small><strong>{positivePercent}%</strong><span>{positiveCount} reviews with 4 or 5 stars</span></article>
      <article className={styles.summaryCard}><span className={styles.cardIcon}><ShieldCheck size={17} /></span><small>Receipt-verified reviews</small><strong>{totalCount}</strong><span>One protected review per paid bill</span></article>
      <article className={`${styles.summaryCard} ${attentionCount ? styles.attentionCard : ''}`}><span className={styles.cardIcon}><AlertCircle size={17} /></span><small>Needs attention</small><strong>{attentionCount}</strong><span>Reviews with 3 stars or fewer</span></article>
    </section>
    <section className={styles.ratingBreakdown}><div><span className="eyebrow">RATING BREAKDOWN</span><h2>What guests selected</h2><p>Every row shows five stars. Filled stars are the rating given.</p></div><div className={styles.distribution}>{[5, 4, 3, 2, 1].map(rating => { const count = starCounts[rating]; const percent = totalCount ? Math.round((count / totalCount) * 100) : 0; return <div className={styles.distributionRow} key={rating}><Stars value={rating} size={14} /><div className={styles.track}><i style={{ width: `${percent}%` }} /></div><strong>{count}</strong></div>; })}</div></section>
    <div className={styles.insightGrid}>
      <section className={styles.panel}><div className={styles.panelHeading}><div><span className="eyebrow">GUEST PRIORITIES</span><h2>Ratings by service area</h2></div><MessageSquareText size={20} /></div><div className={styles.aspectList}>{aspectStats.map(aspect => <article key={aspect.key} className={styles.aspectRow}><div><strong>{aspect.label}</strong><small>{aspect.count ? `${aspect.count} guest ratings` : 'No rating received yet'}</small></div><div className={styles.aspectScore}>{aspect.count ? <><Stars value={aspect.average} size={13} /><b>{aspect.average.toFixed(1)}</b></> : <span>—</span>}</div>{aspect.evidence && <q>{aspect.evidence}</q>}</article>)}</div></section>
      <section className={styles.panel}><div className={styles.panelHeading}><div><span className="eyebrow">SERVICE PERFORMANCE</span><h2>Dishes & team</h2></div><Utensils size={20} /></div><div className={styles.leaderColumns}><div><h3>Top-rated dishes</h3>{dishLeaders.length ? dishLeaders.map(dish => <div className={styles.leaderRow} key={dish.name}><span>{dish.name}<small>{dish.ratings.length} ratings</small></span><span><Stars value={dish.average} size={12} /><b>{dish.average.toFixed(1)}</b></span></div>) : <p className={styles.emptyNote}>Dish ratings will appear after guests submit them.</p>}</div><div><h3>Server hospitality</h3>{serverLeaders.length ? serverLeaders.map(server => <div className={styles.leaderRow} key={server.name}><span>{server.name}<small>{server.count} reviewed tables</small></span><span><Stars value={server.average} size={12} /><b>{server.average.toFixed(1)}</b></span></div>) : <p className={styles.emptyNote}>Hospitality ratings will appear here.</p>}</div></div></section>
    </div>
    <section className={styles.feed}>
      <div className={styles.feedHeading}><div><span className="eyebrow">VERIFIED FEEDBACK</span><h2>Receipt-linked guest reviews</h2><p>{feedReviews.length} reviews in this view</p></div><label className={styles.search}><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search receipt, table, server or dish" /></label></div>
      <div className={styles.ratingFilters}>{(['all', '5', '4', '3', '2', '1', 'attention'] as const).map(value => <button key={value} type="button" className={starFilter === value ? styles.selected : ''} onClick={() => setStarFilter(value)}>{value === 'all' ? 'All reviews' : value === 'attention' ? 'Needs attention' : <Stars value={Number(value)} size={11} />}</button>)}</div>
      <div className={styles.reviewList}>{feedReviews.map(review => {
        const dishNames = new Map((review.order_items || []).map(item => [item.menu_item_id, item.name]));
        const serviceRatings = ASPECTS.flatMap(aspect => {
          const rating = review.parsed.aspects[aspect.key];
          return rating ? [{ ...aspect, rating }] : [];
        });
        return <article className={styles.reviewCard} key={review.id}><header><div className={styles.reviewIdentity}><span className={styles.verified}><CheckCircle2 size={12} /> Verified receipt</span><strong>Receipt {review.order_number || review.order_id.slice(0, 8)}</strong></div><Stars value={review.rating} size={17} /></header><div className={styles.receiptMeta}><span><TableProperties size={13} /> {[review.floor_name_snapshot, review.table_name_snapshot].filter(Boolean).join(' · ') || 'Dining table'}</span><span><UserRound size={13} /> Served by {review.waiter_name || 'Service team'}</span><span><Clock3 size={13} /> {new Date(review.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' })}</span></div><p className={styles.comment}>{review.parsed.userNote || 'Guest submitted ratings without an additional comment.'}</p>{serviceRatings.length > 0 && <div className={styles.serviceRatings}>{serviceRatings.map(aspect => <span key={aspect.key}><b>{aspect.label}</b><Stars value={aspect.rating} size={11} /></span>)}</div>}{review.parsed.dishes.length > 0 && <div className={styles.dishRatings}>{review.parsed.dishes.map(dish => <div key={dish.menuItemId}><span><Utensils size={12} /> {dishNames.get(dish.menuItemId) || 'Ordered dish'}</span><Stars value={dish.rating} size={12} />{dish.comment && <small>{dish.comment}</small>}</div>)}</div>}{review.analysis_result?.aspects?.length ? <div className={styles.analysis}><strong>Comment themes</strong>{review.analysis_result.aspects.map((aspect, index) => <span key={`${aspect.aspect}-${index}`} className={styles[aspect.sentiment]}>{aspect.aspect.replace('_', ' ')} · {aspect.sentiment}</span>)}</div> : <span className={styles.analysisState}>{review.analysis_status === 'failed' ? 'Comment needs a manual check' : 'Comment analysis pending'}</span>}</article>;
      })}{!feedReviews.length && <div className={styles.emptyState}><MessageSquareText size={28} /><h3>No reviews in this view</h3><p>Try another period or rating filter. New QR reviews will appear here automatically.</p></div>}</div>
    </section>
  </div>;
}
