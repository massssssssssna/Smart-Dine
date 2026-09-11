'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Receipt,LogOut,Printer,Check,Search} from 'lucide-react';
import {api,ApiError,Profile,Page,money} from '@/lib/api';
import {Brand,Modal,Field,Empty} from './ui';
import styles from './cashier.module.css';

type Bill={id:string;order_number:string;floor_name_snapshot:string|null;table_name_snapshot:string|null;seats_snapshot:number|null;status:string;version:number;notes:string;subtotal:string;discount:string;tax:string;total:string;created_at:string;completed_at:string|null;cash_received:string|null;change_given:string|null;items:{id:string;name_snapshot:string;quantity:number;price_snapshot:string}[]};
type ReceiptData=Bill&{receipt_number:string;branch_name:string;payment_status:string};
const time=(value:string)=>new Date(value).toLocaleString('en-PK',{timeZone:'Asia/Karachi',dateStyle:'medium',timeStyle:'short'});
const cents=(value:string)=>{const [whole,fraction='']=value.split('.');return Number(whole)*100+Number((fraction+'00').slice(0,2));};

export default function CashierWorkspace(){
 const [me,setMe]=useState<Profile|null>(null),[bills,setBills]=useState<Bill[]>([]),[filter,setFilter]=useState('unpaid'),[search,setSearch]=useState('');
 const [offset,setOffset]=useState(0),[total,setTotal]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(true),[selected,setSelected]=useState<ReceiptData|null>(null);
 const [cash,setCash]=useState(''),[busy,setBusy]=useState(false),[paymentError,setPaymentError]=useState('');
 const paying=useRef(false),retry=useRef<{body:string;key:string}|null>(null);
 const load=useCallback(async()=>{
  try{
    const user=await api<Profile>('auth/me');
    if(!user.is_active){await api('auth/logout','POST');window.location.replace('/sign-in');return;}
    const expectedPortal=user.role==='manager'?'manager':user.staff_type;
    if(expectedPortal!=='cashier'){window.location.replace('/'+expectedPortal);return;}
    setMe(user);const page=await api<Page<Bill>>(`orders/bills?payment_status=${filter}&limit=50&offset=${offset}`);setBills(page.items);setTotal(page.total);setError('');
  }catch(e){if(e instanceof ApiError&&[401,403].includes(e.status)){window.location.replace('/sign-in');return;}setError((e as Error).message);}finally{setLoading(false);}
 },[filter,offset]);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load]);
 async function openBill(bill:Bill){try{setError('');const receipt=await api<ReceiptData>('orders/'+bill.id+'/receipt');setSelected(receipt);setCash('');setPaymentError('');retry.current=null;}catch(e){setError((e as Error).message);}}
 async function pay(){
  if(!selected||paying.current)return;
  if(!cash||!Number.isFinite(Number(cash))||cents(cash)<cents(selected.total)){setPaymentError('Cash received must cover the full bill.');return;}
  paying.current=true;setBusy(true);setPaymentError('');
  const body={expected_version:selected.version,cash_received:cash};const serialized=JSON.stringify({id:selected.id,...body});
  if(retry.current?.body!==serialized)retry.current={body:serialized,key:crypto.randomUUID()};
  try{
   const paid=await api<Bill>('orders/'+selected.id+'/pay','POST',body,retry.current.key);
   setSelected({...selected,...paid,payment_status:'paid'});await load();
  }catch(e){
   setPaymentError((e as Error).message);
   if(e instanceof ApiError&&e.status===409){try{setSelected(await api<ReceiptData>('orders/'+selected.id+'/receipt'));retry.current=null;}catch{ /* Keep the original error visible. */ }}
  }finally{paying.current=false;setBusy(false);}
 }
 if(loading&&!me)return <main className="loading"><Brand/><p>Opening billing…</p>{error&&<p className="error">{error}</p>}</main>;
 const visible=bills.filter(b=>(b.id+' '+b.order_number+' '+b.floor_name_snapshot+' '+b.table_name_snapshot+' '+b.notes).toLowerCase().includes(search.toLowerCase()));
 return <div className="app-shell station-cashier">
  <aside className="sidebar"><Link href="/"><Brand/></Link><span className="nav-caption">CASHIER STATION</span><nav><button className="nav-link active"><Receipt size={18}/>Bills & receipts</button></nav>
   <div className="sidebar-user"><span className="avatar">{me?.full_name.slice(0,1)}</span><div><strong>{me?.full_name}</strong><small>Cashier / Billing</small></div><button className="icon" aria-label="Sign out" onClick={async()=>{try{await api('auth/logout','POST');window.location.replace('/sign-in');}catch(e){setError((e as Error).message);}}}><LogOut size={18}/></button></div>
  </aside>
  <div className="workspace"><main className="workspace-main">
   <div className="page-heading"><div><span className="eyebrow">PAYMENTS & RECEIPTS</span><h1>Cashier / Billing</h1><p className="muted">Review bills, receive payment and print receipts.</p></div></div>
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
    <p className={styles.billId}>{selected.receipt_number}</p><p>{time(selected.created_at)}</p><p>{[selected.floor_name_snapshot,selected.table_name_snapshot].filter(Boolean).join(' · ')||'Dining order'}{selected.seats_snapshot?` · ${selected.seats_snapshot} seats`:''}</p><p>{selected.notes.split('\n')[0]}</p>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{selected.items.map(item=><tr key={item.id}><td>{item.name_snapshot}</td><td>{item.quantity}</td><td>{money(item.price_snapshot)}</td><td>{money(cents(item.price_snapshot)*item.quantity/100)}</td></tr>)}</tbody></table>
    <dl><div><dt>Subtotal</dt><dd>{money(selected.subtotal)}</dd></div><div><dt>Discount</dt><dd>− {money(selected.discount)}</dd></div><div><dt>Tax</dt><dd>{money(selected.tax)}</dd></div><div className={styles.total}><dt>Total · PKR</dt><dd>{money(selected.total)}</dd></div>
    {selected.status==='completed'&&<>{selected.cash_received!==null&&<><div><dt>Cash received</dt><dd>{money(selected.cash_received)}</dd></div><div><dt>Change returned</dt><dd>{money(selected.change_given||'0')}</dd></div></>}{selected.completed_at&&<div><dt>Paid at</dt><dd>{time(selected.completed_at)}</dd></div>}</>}</dl>
    <p className={styles.thanks}>{selected.status==='completed'?'Thank you for dining with us.':selected.status==='cancelled'?'Cancelled — no payment due.':'Unpaid bill — payment has not been received.'}</p>
   </article>
   <div className={styles.controls}>
    {selected.status==='ready'&&<><Field label="Cash received · Rs"><input type="number" min={Math.ceil(Number(selected.total))} step="1" value={cash} onChange={e=>setCash(e.target.value)} placeholder="Amount received from customer" disabled={busy}/></Field>{cash&&cents(cash)>=cents(selected.total)&&<p>Return change: <strong>{money((cents(cash)-cents(selected.total))/100)}</strong></p>}</>}
    {['pending','preparing'].includes(selected.status)&&<p className="muted">Payment can be recorded once the kitchen marks this order ready. Reopen the bill to refresh its status.</p>}
    {paymentError&&<p className="error" role="alert">{paymentError}</p>}
    <div className={styles.buttons}><button className="soft" disabled={busy} onClick={()=>window.print()}><Printer size={16}/>{selected.status==='completed'?'Print receipt':'Print bill'}</button>{selected.status==='ready'&&<button className="gold" disabled={busy||!cash||cents(cash)<cents(selected.total)} onClick={()=>void pay()}><Check size={16}/>{busy?'Recording…':'Confirm cash received · Mark paid'}</button>}</div>
   </div>
  </Modal>}
 </div>;
}
