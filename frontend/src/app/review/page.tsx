'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock3, MapPin, Receipt, ShieldCheck, Star, UtensilsCrossed, UserRound } from 'lucide-react';
import { api, AspectRatingsPayload, ReviewSubmitPayload, ReviewTokenInfo } from '@/lib/api';
import styles from './review.module.css';

type AspectKey = keyof AspectRatingsPayload;
type DishEntry = { rating: number; comment: string };
const RATING_TEXT: Record<number, string> = { 1: 'Needs improvement', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };
const ASPECTS: Array<{ key: AspectKey; label: string }> = [
  { key: 'taste', label: 'Taste & quality' }, { key: 'service_speed', label: 'Service speed' },
  { key: 'cleanliness', label: 'Cleanliness' }, { key: 'hospitality', label: 'Staff hospitality' },
  { key: 'value', label: 'Value for price' },
];
const LOCAL_PREVIEW: ReviewTokenInfo = {
  valid: true,
  order_id: 'ac0e3463-92ac-4c31-a55d-ccc39d4a85bc',
  order_number: 'SD-100002',
  floor_name: 'Floor 1',
  table_name: 'Table 1',
  seats: 4,
  waiter_name: 'raza',
  created_at: '2026-09-11T17:43:01+05:00',
  items: [
    { menu_item_id: 'bf285672-b9a8-4c33-a4df-e9d9979bbb3d', name: 'CocaCola 1.5liter', quantity: 1, price: '220.00' },
    { menu_item_id: '0c5957cd-b1f8-495a-a171-1f2aa6fca920', name: 'Beef Plaoo', quantity: 1, price: '2000.00' },
  ],
};

function RatingButtons({ value, onChange, label, large = false }: { value: number; onChange: (rating: number) => void; label: string; large?: boolean }) {
  return <div className={`${styles.ratingButtons} ${large ? styles.largeStars : ''}`} role="radiogroup" aria-label={label}>{[1, 2, 3, 4, 5].map(star => <button key={star} type="button" role="radio" aria-checked={value === star} aria-label={`${star} out of 5`} className={star <= value ? styles.starSelected : styles.starUnselected} onClick={() => onChange(star)}><Star size={large ? 38 : 22} /></button>)}</div>;
}

function ReviewContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const isPreview = searchParams.get('preview') === '1';
  const [loading, setLoading] = useState(true);
  const [tokenInfo, setTokenInfo] = useState<ReviewTokenInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [overallRating, setOverallRating] = useState(0);
  const [aspectRatings, setAspectRatings] = useState<Record<AspectKey, number>>({ taste: 0, service_speed: 0, cleanliness: 0, hospitality: 0, value: 0 });
  const [dishRatings, setDishRatings] = useState<Record<string, DishEntry>>({});
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (isPreview) {
      setTokenInfo(LOCAL_PREVIEW);
      setDishRatings(Object.fromEntries((LOCAL_PREVIEW.items || []).map(item => [item.menu_item_id, { rating: 0, comment: '' }])));
      setLoading(false);
      return;
    }
    if (!token) { setLoading(false); return; }
    let active = true;
    async function load() {
      try {
        setLoading(true); setLoadError('');
        const info = await api<ReviewTokenInfo>(`reviews/token-info?token=${encodeURIComponent(token!)}`);
        if (!active) return;
        setTokenInfo(info);
        setDishRatings(Object.fromEntries((info.items || []).map(item => [item.menu_item_id, { rating: 0, comment: '' }])));
      } catch (error: unknown) {
        if (active) setLoadError((error as Error)?.message || 'This review link could not be checked.');
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [isPreview, token]);

  const unratedDishes = useMemo(() => (tokenInfo?.items || []).filter(item => !dishRatings[item.menu_item_id]?.rating).length, [dishRatings, tokenInfo?.items]);
  const canSubmit = overallRating > 0 && comment.trim().length >= 3 && unratedDishes === 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isPreview) { setSubmitError('This is a local visual preview. Scan a QR from a paid receipt to send a real review.'); return; }
    if (!token || !tokenInfo?.valid) return;
    if (!canSubmit) { setSubmitError('Please choose an overall rating, rate every ordered dish, and add a short comment.'); return; }
    const aspects: AspectRatingsPayload = {};
    ASPECTS.forEach(({ key }) => { if (aspectRatings[key]) aspects[key] = aspectRatings[key]; });
    const payload: ReviewSubmitPayload = {
      token, rating: overallRating, comment: comment.trim(),
      aspects: Object.keys(aspects).length ? aspects : undefined,
      dish_ratings: (tokenInfo.items || []).map(item => ({ menu_item_id: item.menu_item_id, rating: dishRatings[item.menu_item_id].rating, comment: dishRatings[item.menu_item_id].comment.trim() || undefined })),
    };
    try { setSubmitting(true); setSubmitError(''); await api('reviews/submit', 'POST', payload); setSubmitted(true); }
    catch (error: unknown) { setSubmitError((error as Error)?.message || 'Your review could not be sent. Please try again.'); }
    finally { setSubmitting(false); }
  }

  if (!token && !isPreview) return <StateCard icon={<Receipt size={30} />} title="Scan the receipt QR" text="A private review link is printed at the bottom of every paid Smart Dine receipt." />;
  if (loading) return <StateCard icon={<Clock3 size={30} />} title="Opening your receipt" text="We are checking the secure review link." />;
  if (!tokenInfo?.valid) return <StateCard warning icon={tokenInfo?.reason === 'already_used' ? <CheckCircle2 size={30} /> : <AlertTriangle size={30} />} title={tokenInfo?.reason === 'already_used' ? 'Review already received' : tokenInfo?.reason === 'expired' ? 'Review link expired' : 'Review link unavailable'} text={tokenInfo?.message || loadError || 'Please ask the cashier for a fresh receipt.'} />;
  if (submitted) return <StateCard icon={<CheckCircle2 size={32} />} title="Thank you" text="Your receipt-linked review is saved and is now available to the Smart Dine manager." />;

  return <form className={styles.card} onSubmit={submit}>
    {isPreview && <div className={styles.previewBanner}>LOCAL PREVIEW · This shows how the page will look on a guest&apos;s phone.</div>}
    <header className={styles.receiptBanner}>
      <div><span className={styles.verified}><ShieldCheck size={13} /> Verified paid receipt</span><h1>How was your visit?</h1><p>Your feedback goes directly to the restaurant manager.</p></div>
      <div className={styles.receiptNumber}><small>Receipt</small><strong>{tokenInfo.order_number}</strong></div>
    </header>
    <div className={styles.serviceDetails}>
      <span><MapPin size={14} /> {[tokenInfo.floor_name, tokenInfo.table_name].filter(Boolean).join(' · ')}</span>
      <span><UserRound size={14} /> Served by {tokenInfo.waiter_name || 'Smart Dine team'}</span>
      {tokenInfo.created_at && <span><Clock3 size={14} /> {new Date(tokenInfo.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' })}</span>}
    </div>
    <div className={styles.formBody}>
      <section className={`${styles.section} ${styles.overall}`}><span className={styles.step}>01 · Overall experience</span><h2>Select your rating</h2><RatingButtons value={overallRating} onChange={setOverallRating} label="Overall experience" large />{overallRating > 0 && <strong className={styles.ratingText}>{RATING_TEXT[overallRating]}</strong>}</section>
      <section className={styles.section}><span className={styles.step}>02 · Ordered dishes</span><h2>Rate each dish</h2><p className={styles.help}>These are the items linked to this receipt.</p><div className={styles.dishList}>{(tokenInfo.items || []).map(item => <article className={styles.dishCard} key={item.menu_item_id}><div className={styles.dishHeading}><div><strong>{item.name}</strong><small>Quantity {item.quantity}</small></div><RatingButtons value={dishRatings[item.menu_item_id]?.rating || 0} onChange={rating => setDishRatings(current => ({ ...current, [item.menu_item_id]: { rating, comment: current[item.menu_item_id]?.comment || '' } }))} label={item.name} /></div><input value={dishRatings[item.menu_item_id]?.comment || ''} onChange={event => setDishRatings(current => ({ ...current, [item.menu_item_id]: { rating: current[item.menu_item_id]?.rating || 0, comment: event.target.value } }))} maxLength={1000} placeholder={`Optional note about ${item.name}`} /></article>)}</div></section>
      <section className={styles.section}><span className={styles.step}>03 · Service details</span><h2>Tell us what stood out</h2><p className={styles.help}>These ratings are optional.</p><div className={styles.aspectList}>{ASPECTS.map(aspect => <div className={styles.aspectRow} key={aspect.key}><span>{aspect.label}</span><RatingButtons value={aspectRatings[aspect.key]} onChange={rating => setAspectRatings(current => ({ ...current, [aspect.key]: rating }))} label={aspect.label} /></div>)}</div></section>
      <section className={styles.section}><span className={styles.step}>04 · Your comment</span><h2>Leave a short note</h2><textarea required minLength={3} maxLength={1800} value={comment} onChange={event => setComment(event.target.value)} placeholder="What did you enjoy, and what could we improve?" /><small className={styles.characterCount}>{comment.length} / 1800</small></section>
      {submitError && <p className={styles.error} role="alert">{submitError}</p>}
      <button className={styles.submit} type="submit" disabled={submitting || !canSubmit}>{submitting ? 'Sending review…' : 'Send review to manager'}</button>
      <p className={styles.privacy}><ShieldCheck size={13} /> Your review is tied only to this receipt. The QR can be used once.</p>
    </div>
  </form>;
}

function StateCard({ icon, title, text, warning = false }: { icon: React.ReactNode; title: string; text: string; warning?: boolean }) {
  return <section className={styles.stateCard}><span className={warning ? styles.warningIcon : styles.successIcon}>{icon}</span><h1>{title}</h1><p>{text}</p></section>;
}

export default function CustomerReviewPage() {
  return <main className={styles.page}><header className={styles.brand}><UtensilsCrossed size={23} /><div><strong>Smart Dine</strong><small>GRAND RESERVE</small></div></header><Suspense fallback={<StateCard icon={<Clock3 size={30} />} title="Opening your receipt" text="Please wait a moment." />}><ReviewContent /></Suspense><footer>SMART DINE · SERVICE WITH INTENTION</footer></main>;
}
