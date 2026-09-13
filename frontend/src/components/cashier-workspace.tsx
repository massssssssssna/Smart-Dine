'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Receipt,LogOut,Printer,Check,Search,WalletCards,ListChecks,TrendingUp,CalendarDays,ExternalLink,QrCode} from 'lucide-react';
import QRCode from 'qrcode';
import {api,ApiError,Profile,Page,money} from '@/lib/api';
import {Brand,Modal,Field,Empty} from './ui';
import styles from './cashier.module.css';

type Bill={id:string;order_number:string;floor_name_snapshot:string|null;table_name_snapshot:string|null;seats_snapshot:number|null;status:string;version:number;notes:string;subtotal:string;discount:string;tax:string;tax_rate?:string|number;discount_percent?:string|number|null;discount_reason?:string|null;total:string;created_at:string;completed_at:string|null;paid_by?:string|null;paid_by_name?:string|null;paid_by_email?:string|null;cash_received:string|null;change_given:string|null;items:{id:string;name_snapshot:string;quantity:number;price_snapshot:string}[]};
type ReceiptData=Bill&{receipt_number:string;branch_name:string;payment_status:string};
const time=(value:string)=>new Date(value).toLocaleString('en-PK',{timeZone:'Asia/Karachi',dateStyle:'medium',timeStyle:'short'});
const cents=(value:string)=>{const [whole,fraction='']=value.split('.');return Number(whole)*100+Number((fraction+'00').slice(0,2));};
const karachiDay=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const monthLabel=(key:string)=>new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-PK',{month:'short',year:'numeric',timeZone:'Asia/Karachi'});

async function loadEveryBill(firstPage:Page<Bill>):Promise<Bill[]>{
 const pageSize=100;
 if(firstPage.total<=firstPage.items.length)return firstPage.items;
 const offsets:Array<number>=[];
 for(let next=firstPage.items.length;next<firstPage.total;next+=pageSize)offsets.push(next);
 const rest=await Promise.all(offsets.map(next=>api<Page<Bill>>(`orders/bills?payment_status=all&limit=${pageSize}&offset=${next}`)));
 return [firstPage.items,...rest.map(page=>page.items)].flat();
}

export default function CashierWorkspace(){
 const [me,setMe]=useState<Profile|null>(null),[bills,setBills]=useState<Bill[]>([]),[allBills,setAllBills]=useState<Bill[]>([]),[filter,setFilter]=useState('unpaid'),[search,setSearch]=useState('');
 const [offset,setOffset]=useState(0),[total,setTotal]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(true),[selected,setSelected]=useState<ReceiptData|null>(null);
 const [cash,setCash]=useState(''),[discountPercent,setDiscountPercent]=useState('0'),[discountReason,setDiscountReason]=useState(''),[busy,setBusy]=useState(false),[paymentError,setPaymentError]=useState('');
 const [reviewToken,setReviewToken]=useState<string|null>(null),[reviewUrl,setReviewUrl]=useState<string|null>(null),[qrCodeDataUrl,setQrCodeDataUrl]=useState<string|null>(null),[loadingQr,setLoadingQr]=useState(false),[qrError,setQrError]=useState('');
 const paying=useRef(false),retry=useRef<{body:string;key:string}|null>(null);

 useEffect(()=>{
  if(!selected||selected.status!=='completed'){
    setReviewToken(null);
    setReviewUrl(null);
    setQrCodeDataUrl(null);
    setQrError('');
    return;
  }
  let active=true;
  async function generateReviewQr(){
    try{
      setLoadingQr(true);
      setQrError('');
      const res=await api<{token:string}>(
        'reviews/tokens',
        'POST',
        {order_id:selected!.id},
        `review-token-${selected!.id}`
      );
      if(!active||!res?.token)return;
      setReviewToken(res.token);
      const publicBase=(process.env.NEXT_PUBLIC_SITE_URL||window.location.origin).replace(/\/$/,'');
      const destination=`${publicBase}/review?token=${res.token}`;
      setReviewUrl(destination);
      const url=await QRCode.toDataURL(destination,{
        width:512,
        margin:4,
        errorCorrectionLevel:'M',
        color:{dark:'#000000',light:'#ffffff'}
      });
      if(active)setQrCodeDataUrl(url);
    }catch(err){
      if(active)setQrError((err as Error)?.message||'Review QR could not be generated.');
    }finally{
      if(active)setLoadingQr(false);
    }
  }
  void generateReviewQr();
  return ()=>{active=false;};
 },[selected?.id,selected?.status]);
 const load=useCallback(async()=>{
  try{
    const user=await api<Profile>('auth/me');
    if(!user.is_active){await api('auth/logout','POST');window.location.replace('/sign-in');return;}
    const expectedPortal=user.role==='manager'?'manager':user.staff_type;
    if(expectedPortal!=='cashier'){window.location.replace('/'+expectedPortal);return;}
    setMe(user);
    const [page,summaryPage]=await Promise.all([
      api<Page<Bill>>(`orders/bills?payment_status=${filter}&limit=50&offset=${offset}`),
      api<Page<Bill>>('orders/bills?payment_status=all&limit=100&offset=0'),
    ]);
    const completeHistory=await loadEveryBill(summaryPage);
    setBills(page.items);setAllBills(completeHistory);setTotal(page.total);setError('');
  }catch(e){if(e instanceof ApiError&&[401,403].includes(e.status)){window.location.replace('/sign-in');return;}setError((e as Error).message);}finally{setLoading(false);}
 },[filter,offset]);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load]);
 async function openBill(bill:Bill){
  try{
    setError('');
    const receipt=await api<ReceiptData>('orders/'+bill.id+'/receipt');
    setSelected(receipt);
    setCash('');
    setDiscountPercent(receipt.discount_percent ? String(receipt.discount_percent) : '0');
    setDiscountReason(receipt.discount_reason || '');
    setPaymentError('');
    retry.current=null;
  }catch(e){setError((e as Error).message);}
 }

 const discPct = Number(discountPercent) || 0;
 const computedDiscount = selected ? Math.round(Number(selected.subtotal) * (discPct / 100) * 100) / 100 : 0;
 const computedTotal = selected ? Math.max(0, Math.round((Number(selected.subtotal) - computedDiscount + Number(selected.tax)) * 100) / 100) : 0;

 async function pay(){
  if(!selected||paying.current)return;
  if(!cash||!Number.isFinite(Number(cash))||cents(cash)<cents(String(computedTotal))){setPaymentError('Cash received must cover the full bill.');return;}
  paying.current=true;setBusy(true);setPaymentError('');
  const body={
    expected_version:selected.version,
    cash_received:cash,
    discount:computedDiscount,
    discount_percent:discPct>0?discPct:null,
    discount_reason:discountReason.trim()||undefined
  };
  const serialized=JSON.stringify({id:selected.id,...body});
  if(retry.current?.body!==serialized)retry.current={body:serialized,key:crypto.randomUUID()};
  try{
   const paid=await api<Bill>('orders/'+selected.id+'/pay','POST',body,retry.current.key);
   setSelected({
     ...selected,
     ...paid,
     discount:String(computedDiscount),
     discount_percent:discPct>0?discPct:null,
     discount_reason:discountReason.trim()||null,
     total:String(computedTotal),
     payment_status:'paid'
   });
   await load();
  }catch(e){
   setPaymentError((e as Error).message);
   if(e instanceof ApiError&&e.status===409){try{setSelected(await api<ReceiptData>('orders/'+selected.id+'/receipt'));retry.current=null;}catch{ /* Keep the original error visible. */ }}
  }finally{paying.current=false;setBusy(false);}
 }
 if(loading&&!me)return <main className="loading"><Brand/><p>Opening billing…</p>{error&&<p className="error">{error}</p>}</main>;
 const visible=bills.filter(b=>(b.id+' '+b.order_number+' '+b.floor_name_snapshot+' '+b.table_name_snapshot+' '+b.notes).toLowerCase().includes(search.toLowerCase()));
 const today=karachiDay(new Date().toISOString());
 const isMine=(bill:Bill)=>bill.paid_by===me?.id||bill.paid_by_email?.toLowerCase()===me?.email.toLowerCase();
 const completedBills=allBills.filter(b=>b.status==='completed'&&b.completed_at);
 const myPaidBills=completedBills.filter(isMine);
 const myPaidToday=myPaidBills.filter(b=>b.completed_at&&karachiDay(b.completed_at)===today);
 const collectedToday=myPaidToday.reduce((sum,b)=>sum+Number(b.total||0),0);
 const unpaidCount=allBills.filter(b=>['pending','preparing','ready'].includes(b.status)).length;
 const readyCount=allBills.filter(b=>b.status==='ready').length;
 const collectedByMe=myPaidBills.reduce((sum,b)=>sum+Number(b.total||0),0);
 const averageBill=myPaidBills.length?collectedByMe/myPaidBills.length:0;
 const monthlyHistory=Object.entries(completedBills.reduce<Record<string,{count:number,total:number}>>((acc,bill)=>{
   const key=karachiDay(bill.completed_at as string).slice(0,7);
   acc[key]??={count:0,total:0};acc[key].count+=1;acc[key].total+=Number(bill.total||0);return acc;
 },{})).sort(([a],[b])=>a.localeCompare(b));
 const maxMonth=Math.max(1,...monthlyHistory.map(([,value])=>value.total));
 return <div className="app-shell station-cashier">
  <aside className="sidebar"><Link href="/"><Brand/></Link><span className="nav-caption">CASHIER STATION</span><nav><button className="nav-link active"><Receipt size={18}/>Bills & receipts</button></nav>
   <div className="sidebar-user"><span className="avatar">{me?.full_name.slice(0,1)}</span><div><strong>{me?.full_name}</strong><small>Cashier / Billing</small></div><button className="icon" aria-label="Sign out" onClick={async()=>{try{await api('auth/logout','POST');window.location.replace('/sign-in');}catch(e){setError((e as Error).message);}}}><LogOut size={18}/></button></div>
  </aside>
  <div className="workspace"><main className="workspace-main">
   <div className="page-heading"><div><span className="eyebrow">PAYMENTS & RECEIPTS</span><h1>Cashier / Billing</h1><p className="muted">Review bills, receive payment and print receipts.</p></div></div>
   <section className="role-suite panel" aria-label="Cashier performance snapshot">
    <div className="panel-head role-suite-head"><div><span className="eyebrow">BILLING PERFORMANCE</span><h2>Six-month settlement history</h2><p className="muted">Complete paid and unpaid bill history recorded for this restaurant.</p></div><span className="role-live-chip"><i/> Live · Asia/Karachi</span></div>
    <div className="role-metric-grid">
     {[
      {label:'Unpaid queue',value:unpaidCount,note:`${readyCount} ready to collect`,icon:ListChecks},
      {label:'Bills I settled',value:myPaidBills.length,note:`${myPaidToday.length} settled today`,icon:Receipt},
      {label:'My recorded collection',value:money(collectedByMe),note:`${money(collectedToday)} collected today`,icon:WalletCards},
      {label:'My average bill',value:money(averageBill),note:'Across your complete recorded history',icon:TrendingUp},
     ].map(({label,value,note,icon:Icon})=><article className="role-metric" key={label}><span className="role-metric-icon"><Icon size={17}/></span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></article>)}
    </div>
    <div className={styles.historySummary}>
      <div className={styles.historyTitle}><CalendarDays size={17}/><div><strong>Restaurant collection by month</strong><span>{completedBills.length} settled bills · {money(completedBills.reduce((sum,bill)=>sum+Number(bill.total||0),0))} recorded</span></div></div>
      <div className={styles.monthBars}>
        {monthlyHistory.map(([month,value])=><div className={styles.monthBar} key={month} title={`${monthLabel(month)}: ${value.count} bills, ${money(value.total)}`}><div className={styles.barTrack}><i style={{height:`${Math.max(6,(value.total/maxMonth)*100)}%`}}/></div><strong>{money(value.total)}</strong><span>{monthLabel(month)}</span><small>{value.count} bills</small></div>)}
      </div>
    </div>
   </section>
   <div className={styles.toolbar}><div className={styles.filters}>{['unpaid','paid','all'].map(value=><button key={value} className={filter===value?'':'soft'} onClick={()=>{setFilter(value);setOffset(0);}}>{value==='all'?'All bills':value==='paid'?'Paid':'Unpaid'}</button>)}</div><label className="search"><Search size={16}/><input aria-label="Search bills" placeholder="Search bill or table on this page…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
   {error&&<p className="error" role="alert">{error}</p>}
   <section className="panel"><div className="panel-head"><h2>{filter==='paid'?'Paid bills':filter==='unpaid'?'Unpaid bills':'All bills'}</h2><span className="muted">{total} bills</span></div>
    <div className="table-wrap"><table><thead><tr><th>Bill / table</th><th>Time</th><th>Total</th><th>Payment</th><th>Order</th><th>Action</th></tr></thead><tbody>{visible.map(b=><tr key={b.id}><td><strong>{b.order_number||b.id}</strong><div>{[b.floor_name_snapshot,b.table_name_snapshot].filter(Boolean).join(' · ')||b.notes.split('\n')[0]||'Dining order'}</div></td><td>{time(b.created_at)}</td><td>{money(b.total)}</td><td><span className={`badge ${b.status==='completed'?'active':b.status==='cancelled'?'inactive':'pending'}`}>{b.status==='completed'?'Paid':b.status==='cancelled'?'Cancelled':'Unpaid'}</span></td><td>{b.status==='completed'?'Completed':b.status}</td><td><button className="soft" onClick={()=>void openBill(b)}>View bill</button></td></tr>)}</tbody></table></div>
    {!visible.length&&<Empty>No bills in this view.</Empty>}
    {total>50&&<div className="pagination"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button><span>{offset+1}–{Math.min(offset+50,total)} of {total}</span><button disabled={offset+50>=total} onClick={()=>setOffset(offset+50)}>Next</button></div>}
   </section>
  </main></div>
  {selected&&<Modal title={selected.status==='completed'?'Payment receipt':'Customer bill'} preventClose={busy} onClose={()=>{setSelected(null);setPaymentError('');}}>
   <article className={styles.receipt}>
    <header><h2>Smart Dine</h2><p>{selected.branch_name}</p><strong>{selected.payment_status.toUpperCase()}</strong></header>
    <p className={styles.billId}><strong>Receipt ID:</strong> {selected.receipt_number}</p><p>{time(selected.created_at)}</p><p>{[selected.floor_name_snapshot,selected.table_name_snapshot].filter(Boolean).join(' · ')||'Dining order'}{selected.seats_snapshot?` · ${selected.seats_snapshot} seats`:''}</p><p>{selected.notes.split('\n')[0]}</p>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{selected.items.map(item=><tr key={item.id}><td>{item.name_snapshot}</td><td>{item.quantity}</td><td>{money(item.price_snapshot)}</td><td>{money(cents(item.price_snapshot)*item.quantity/100)}</td></tr>)}</tbody></table>
    <dl>
      <div><dt>Subtotal</dt><dd>{money(selected.subtotal)}</dd></div>
      <div><dt>Table Tax ({Number(selected.tax_rate ?? 15)}%)</dt><dd>+ {money(selected.tax)}</dd></div>
      {(Number(selected.discount)>0||(selected.status==='ready'&&computedDiscount>0))&&<div><dt>Discount {selected.status==='ready'?(discPct>0?`(${discPct}%)`:''):(selected.discount_percent?`(${Number(selected.discount_percent)}%)`:'')}</dt><dd style={{color:'#b91c1c'}}>− {money(selected.status==='ready'?computedDiscount:selected.discount)}</dd></div>}
      {selected.discount_reason&&<div style={{fontSize:'0.82rem',color:'#64748b'}}><dt>Discount note</dt><dd>{selected.discount_reason}</dd></div>}
      <div className={styles.total}><dt>Total · PKR</dt><dd>{money(selected.status==='ready'?computedTotal:selected.total)}</dd></div>
      {selected.status==='completed'&&<>{selected.cash_received!==null&&<><div><dt>Cash received</dt><dd>{money(selected.cash_received)}</dd></div><div><dt>Change returned</dt><dd>{money(selected.change_given||'0')}</dd></div></>}{selected.completed_at&&<div><dt>Paid at</dt><dd>{time(selected.completed_at)}</dd></div>}</>}
    </dl>
    <p className={styles.thanks}>{selected.status==='completed'?'Thank you for dining with us.':selected.status==='cancelled'?'Cancelled — no payment due.':'Unpaid bill — payment has not been received.'}</p>
    {selected.status==='completed'&&(
      <div className={styles.receiptQr}>
        <div className={styles.qrTitleRow}>
          <QrCode size={13}/>
          <strong>Scan to review your meal</strong>
        </div>
        {qrCodeDataUrl ? (
          <>
            <img src={qrCodeDataUrl} alt={`Review QR for receipt ${selected.receipt_number}`} width={216} height={216} className={styles.qrImg}/>
            <span className={styles.qrSub}>Point your phone camera at this code to open the review form.</span>
            <span className={styles.qrReceipt}>Receipt {selected.receipt_number}</span>
            {reviewUrl&&<a href={reviewUrl} target="_blank" rel="noopener noreferrer" className={styles.qrLink}>
              Test review form <ExternalLink size={11}/>
            </a>}
            {!process.env.NEXT_PUBLIC_SITE_URL&&<span className={styles.qrSetupNote}>Local test QR only — add your public website address before giving this receipt to a guest.</span>}
          </>
        ) : (
          <span className={qrError?styles.qrError:styles.qrSub}>{loadingQr?'Generating secure review QR…':qrError||'Review QR is not available.'}</span>
        )}
      </div>
    )}
   </article>
   <div className={styles.controls}>
    {selected.status==='ready'&&<>
      <div style={{background:'rgba(0,0,0,0.02)',padding:'0.85rem',borderRadius:'8px',marginBottom:'1rem',border:'1px solid #e2e8f0'}}>
        <label style={{display:'block',fontWeight:600,fontSize:'0.85rem',marginBottom:'0.4rem'}}>Cashier Discount (%):</label>
        <div style={{display:'flex',gap:'0.35rem',marginBottom:'0.5rem',flexWrap:'wrap'}}>
          {[0,5,10,15,20].map(p=>(
            <button key={p} type="button" className={Number(discountPercent)===p?'':'soft'} style={{padding:'4px 10px',fontSize:'0.85rem'}} disabled={busy} onClick={()=>setDiscountPercent(String(p))}>
              {p}%
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Custom % discount"><input type="number" min={0} max={100} step={1} value={discountPercent} onChange={e=>setDiscountPercent(e.target.value)} disabled={busy}/></Field>
          <Field label="Discount reason (optional)"><input placeholder="e.g. Regular guest, Manager approval" value={discountReason} maxLength={200} onChange={e=>setDiscountReason(e.target.value)} disabled={busy}/></Field>
        </div>
      </div>
      <Field label="Cash received · Rs"><input type="number" min={Math.ceil(computedTotal)} step="1" value={cash} onChange={e=>setCash(e.target.value)} placeholder="Amount received from customer" disabled={busy}/></Field>
      {cash&&cents(cash)>=cents(String(computedTotal))&&<p>Return change: <strong>{money((cents(cash)-cents(String(computedTotal)))/100)}</strong></p>}
    </>}
    {['pending','preparing'].includes(selected.status)&&<p className="muted">Payment can be recorded once the kitchen marks this order ready. Reopen the bill to refresh its status.</p>}
    {paymentError&&<p className="error" role="alert">{paymentError}</p>}
    <div className={styles.buttons}><button className="soft" disabled={busy||(selected.status==='completed'&&loadingQr)} onClick={()=>window.print()}><Printer size={16}/>{selected.status==='completed'?(loadingQr?'Preparing review QR…':'Print receipt'):'Print bill'}</button>{selected.status==='ready'&&<button className="gold" disabled={busy||!cash||cents(cash)<cents(String(computedTotal))} onClick={()=>void pay()}><Check size={16}/>{busy?'Recording…':'Confirm cash received · Mark paid'}</button>}</div>
   </div>
  </Modal>}
 </div>;
}
