'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, Copy, Check, ShieldCheck } from 'lucide-react';
import { api, MenuItem, Order, Page, Profile, money } from '@/lib/api';
import { Field, Empty, Modal } from './ui';
type Done={onDone:()=>void};
function useSave(onDone:()=>void){const [error,setError]=useState(''),[busy,setBusy]=useState(false);const retry=useRef<{body:string;key:string}|null>(null);return {error,busy,async save(path:string,method:string,body:unknown){setBusy(true);setError('');const serialized=JSON.stringify(body);if(retry.current?.body!==serialized)retry.current={body:serialized,key:crypto.randomUUID()};try{const res=await api(path,method,body,retry.current!.key);onDone();return res;}catch(e){setError((e as Error).message);return null;}finally{setBusy(false);}}};}
function Result({error,busy}:{error:string;busy:boolean}){return <>{error&&<p role="alert" className="error">{error}</p>}<button className="full" disabled={busy}>{busy?'Saving…':'Save changes'}</button></>;}
export function MenuForm({item,onDone}:{item?:MenuItem}&Done){
  const save=useSave(onDone);
  const categories=['Rice','Dish'];
  // Keep an existing category (including linked drinks) when editing older items.
  if(item?.category&&!categories.includes(item.category))categories.push(item.category);
  return <form className="modal-form" onSubmit={e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    void save.save('menu'+(item?'/'+item.id:''),item?'PUT':'POST',{
      name:f.get('name'),category:f.get('category'),selling_price:f.get('price'),packaging_cost:0,
      is_active:f.get('active')==='on',...(item?{expected_version:item.version}:{})
    });
  }}>
    <Field label="Dish name"><input name="name" defaultValue={item?.name} required maxLength={120}/></Field>
    <Field label="Category"><select name="category" defaultValue={item?.category||'Dish'} required>
      {categories.map(category=><option key={category} value={category}>{category}</option>)}
    </select></Field>
    <p className="muted small">Rice: biryani or pulao. Dish: chicken karahi, handi or other main dishes.</p>
    <Field label="Selling price · PKR"><input name="price" type="number" min="1" step="1" placeholder="e.g. 450" defaultValue={item?.selling_price||''} required/></Field>
    <p className="muted small">Enter a selling price greater than zero.</p>
    <label className="check"><input type="checkbox" name="active" defaultChecked={item?.is_active??true}/>Available for ordering</label>
    <Result {...save}/>
  </form>;
}
export function StaffForm({item,onDone,cashierEnabled=false}:{item?:Profile;cashierEnabled?:boolean}&Done){
  const [showPass,setShowPass]=useState(false);
  const [created,setCreated]=useState<{name:string;email:string;pass:string;station:string}|null>(null);
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  if(created){
    const cardText=`SmartDine AI — Restaurant Access\nName: ${created.name}\nStation: ${created.station==='cashier'?'Cashier / Billing':created.station==='kitchen'?'Kitchen Display':'Waiter Station'}\nEmail: ${created.email}\nPassword: ${created.pass}\nLogin: http://127.0.0.1:3000/sign-in`;
    return <div className="modal-form" style={{textAlign:'center',padding:'0.5rem 0'}}>
      <div style={{display:'inline-flex',alignItems:'center',gap:'0.5rem',color:'#10b981',fontSize:'1.1rem',fontWeight:600,marginBottom:'0.75rem'}}>
        <ShieldCheck size={24}/> Staff Account Created!
      </div>
      <p className="muted" style={{marginBottom:'1rem'}}>Hand over these login credentials to the staff member:</p>
      <div style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'8px',padding:'1rem',textAlign:'left',fontSize:'0.9rem',lineHeight:'1.6',marginBottom:'1rem',fontFamily:'monospace'}}>
        <div><strong>Name:</strong> {created.name}</div>
        <div><strong>Station:</strong> {created.station==='cashier'?'Cashier / Billing':created.station==='kitchen'?'Kitchen Display (KDS)':'Waiter Station'}</div>
        <div><strong>Email:</strong> {created.email}</div>
        <div><strong>Password:</strong> {created.pass}</div>
      </div>
      <div style={{display:'flex',gap:'0.75rem'}}>
        <button type="button" className="soft full" onClick={()=>{navigator.clipboard.writeText(cardText);setCopied(true);setTimeout(()=>setCopied(false),2000);}}>
          {copied?<><Check size={16}/> Copied to Clipboard!</>:<><Copy size={16}/> Copy Credentials</>}
        </button>
        <button type="button" className="gold full" onClick={onDone}>Done</button>
      </div>
    </div>;
  }

  return <form className="modal-form" onSubmit={async e=>{
    e.preventDefault();
    setBusy(true); setError('');
    const f=new FormData(e.currentTarget), station=String(f.get('station'));
    const name=String(f.get('name')), email=String(f.get('email')||''), pass=String(f.get('password')||'');
    const body:Record<string,unknown>={
      full_name:name,
      role:'staff',
      staff_type:station,
      ...(item?{expected_version:item.version,is_active:f.get('active')==='on'}:{email,password:pass})
    };
    try {
      await api('users'+(item?'/'+item.id:''),item?'PUT':'POST',body,crypto.randomUUID());
      if(!item) setCreated({name,email,pass,station});
      else onDone();
    } catch(err){
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }}>
    <Field label="Full name"><input name="name" required defaultValue={item?.full_name} placeholder="e.g. Ali Raza" maxLength={120}/></Field>
    {!item&&<>
      <Field label="Staff email address"><input name="email" type="email" autoComplete="off" placeholder="e.g. ali.waiter@smartdine.pk" required/></Field>
      <Field label="Initial password (min. 8 characters)"><div className="password"><input name="password" type={showPass?'text':'password'} minLength={8} placeholder="At least 8 characters" autoComplete="new-password" required/><button type="button" className="icon" aria-label={showPass?'Hide password':'Show password'} onClick={()=>setShowPass(!showPass)}>{showPass?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></Field>
    </>}
    <Field label="Assigned Station">
      <select name="station" defaultValue={item?.staff_type||'waiter'}>
        <option value="waiter">Waiter Station (Floor Service & Orders)</option>
        <option value="kitchen">Kitchen Display (KDS Food Preparation)</option>
        {(cashierEnabled||item?.staff_type==='cashier')&&<option value="cashier">Cashier / Billing (Payments & Receipts)</option>}
      </select>
    </Field>
    {item&&<label className="check"><input name="active" type="checkbox" defaultChecked={item.is_active}/>Account active (uncheck to deactivate access)</label>}
    {error&&<p role="alert" className="error">{error}</p>}
    <button className="full" disabled={busy}>{busy?'Saving staff account…':(item?'Save changes':'Create staff account')}</button>
  </form>;
}
export function CredentialsForm({item,onDone}:{item:Profile}&Done){
  const [showPass,setShowPass]=useState(false);
  const save=useSave(onDone);
  return <form className="modal-form" onSubmit={e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    void save.save('users/'+item.id+'/credentials','PATCH',{
      ...(f.get('email')!==item.email?{email:f.get('email')}:{}),
      ...(f.get('password')?{password:f.get('password')}:{})
    });
  }}>
    <p className="muted">Update login credentials for <strong>{item.full_name}</strong>. The user will be logged out of other devices.</p>
    <Field label="Email address"><input name="email" type="email" defaultValue={item.email} required/></Field>
    <Field label="New password (leave blank to keep current)"><div className="password"><input name="password" type={showPass?'text':'password'} minLength={8} placeholder="New password (min. 8 characters)" autoComplete="new-password"/><button type="button" className="icon" aria-label={showPass?'Hide password':'Show password'} onClick={()=>setShowPass(!showPass)}>{showPass?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></Field>
    <Result {...save}/>
  </form>;
}
export function OrderForm({item,menu,onDone}:{item?:Order;menu:MenuItem[]}&Done){const save=useSave(onDone),[lines,setLines]=useState<{menu_item_id:string;quantity:number}[]>(item?.items.map(i=>({menu_item_id:i.menu_item_id,quantity:i.quantity}))||[]);const editable=!item||item.status==='pending';return <form className="modal-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save.save('orders'+(item?'/'+item.id:''),item?'PUT':'POST',{items:lines,notes:f.get('notes'),discount:f.get('discount'),tax:f.get('tax'),...(item?{expected_version:item.version,platform_fee:item.platform_fee||'0',delivery_cost:item.delivery_cost||'0'}:{})});}}><Field label="Table / order instructions"><textarea name="notes" maxLength={2000} defaultValue={item?.notes} placeholder={'Table 3\nLess spicy, no nuts'} readOnly={!editable}/></Field>{editable&&<Field label="Add a dish"><select value="" onChange={e=>{const id=e.target.value;if(id)setLines(old=>old.some(i=>i.menu_item_id===id)?old.map(i=>i.menu_item_id===id?{...i,quantity:i.quantity+1}:i):[...old,{menu_item_id:id,quantity:1}]);}}><option value="">Select from menu…</option>{menu.filter(m=>m.is_active).map(m=><option key={m.id} value={m.id}>{m.name} · {money(m.selling_price)}</option>)}</select></Field>}{lines.map((line,index)=><div className="order-line" key={line.menu_item_id}><span>{item?.items.find(i=>i.menu_item_id===line.menu_item_id)?.name_snapshot||menu.find(m=>m.id===line.menu_item_id)?.name||'Menu item'}</span><input aria-label="Quantity" type="number" min={1} max={1000} required value={line.quantity} readOnly={!editable} onChange={e=>setLines(old=>old.map((l,i)=>i===index?{...l,quantity:Number(e.target.value)}:l))}/>{editable&&<button className="icon" type="button" aria-label="Remove dish" onClick={()=>setLines(old=>old.filter((_,i)=>i!==index))}><Trash2 size={16}/></button>}</div>)}{!lines.length&&<Empty>Add at least one dish.</Empty>}<div className="form-grid"><Field label="Discount · PKR"><input type="number" name="discount" min={0} step="1" defaultValue={item?.discount||'0'} required readOnly={!editable}/></Field><Field label="Tax · PKR"><input type="number" name="tax" min={0} step="1" defaultValue={item?.tax||'0'} required readOnly={!editable}/></Field></div>{editable?<Result error={save.error} busy={save.busy||!lines.length}/>:<p className="muted">Preparation has started. Order contents are locked.</p>}</form>;}
type Ingredient={id:string;name:string;unit:string;stock_quantity:string;reorder_level:string;average_unit_cost?:string};
export function StockPanel(){const [items,setItems]=useState<Ingredient[]>([]),[error,setError]=useState(''),[modal,setModal]=useState<'ingredient'|'transaction'|null>(null);const load=()=>api<Page<Ingredient>>('inventory/ingredients?limit=100').then(r=>setItems(r.items)).catch(e=>setError(e.message));useEffect(()=>{void load();},[]);return <section className="panel"><div className="panel-head"><div><h2>Ingredient inventory</h2><p className="muted">Canonical units: grams, millilitres and pieces.</p></div><div className="row-actions"><button className="soft" onClick={()=>setModal('ingredient')}><Plus size={16}/>Ingredient</button><button onClick={()=>setModal('transaction')}>Record stock</button></div></div>{error&&<p className="error">{error}</p>}<table><thead><tr><th>Ingredient</th><th>On hand</th><th>Reorder level</th><th>Average unit cost</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.name}</td><td>{i.stock_quantity} {i.unit}</td><td>{i.reorder_level} {i.unit}</td><td>{money(i.average_unit_cost)}</td></tr>)}</tbody></table>{!items.length&&<Empty>Create ingredients, then receive your stock.</Empty>}{modal&&<Modal title={modal==='ingredient'?'Add ingredient':'Record stock movement'} onClose={()=>setModal(null)}><StockForm kind={modal} ingredients={items} onDone={()=>{setModal(null);void load();}}/></Modal>}</section>;}
function StockForm({kind,ingredients,onDone}:{kind:string;ingredients:Ingredient[]}&Done){const save=useSave(onDone),[movement,setMovement]=useState('purchase');return <form className="modal-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save.save(kind==='ingredient'?'inventory/ingredients':'inventory/transactions','POST',kind==='ingredient'?{name:f.get('name'),unit:f.get('unit'),reorder_level:f.get('reorder')}:{ingredient_id:f.get('ingredient'),kind:movement,quantity:f.get('quantity'),reason:f.get('reason'),...(movement==='purchase'?{unit_cost:f.get('cost')}:{})});}}>{kind==='ingredient'?<><Field label="Ingredient name"><input name="name" required/></Field><Field label="Unit"><select name="unit"><option value="g">Grams</option><option value="ml">Millilitres</option><option value="piece">Pieces</option></select></Field><Field label="Reorder level"><input name="reorder" type="number" min={0} step="0.000001" defaultValue="0" required/></Field></>:<><Field label="Ingredient"><select name="ingredient" required><option value="">Select ingredient…</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></Field><Field label="Movement"><select value={movement} onChange={e=>setMovement(e.target.value)}><option value="purchase">Purchase / receipt</option><option value="wastage">Wastage</option><option value="adjustment">Adjustment (+ / −)</option></select></Field><Field label="Quantity in ingredient unit"><input name="quantity" type="number" step="0.000001" min={movement==='adjustment'?undefined:'0.000001'} required/></Field>{movement==='purchase'&&<Field label="Cost per canonical unit · PKR"><input name="cost" type="number" min="0" step="1" required/></Field>}<Field label="Reason / supplier reference"><input name="reason" minLength={3} required/></Field></>}<Result {...save}/></form>;}
export function RecipeForm({item,onDone}:{item:MenuItem}&Done){const save=useSave(onDone),[ingredients,setIngredients]=useState<Ingredient[]>([]),[lines,setLines]=useState<{ingredient_id:string;quantity:string}[]>([]),[version,setVersion]=useState(item.version),[error,setError]=useState(''),[ready,setReady]=useState(false);useEffect(()=>{Promise.all([api<Page<Ingredient>>('inventory/ingredients?limit=100'),api<{version:number;ingredients:{ingredient_id:string;quantity:string}[]}>('recipes/'+item.id)]).then(([i,r])=>{setIngredients(i.items);setLines(r.ingredients);setVersion(r.version);setReady(true);}).catch(e=>setError(e.message));},[item.id]);return <form className="modal-form" onSubmit={e=>{e.preventDefault();void save.save('recipes/'+item.id,'PUT',{expected_version:version,ingredients:lines});}}><p>Quantities required for one serving of <strong>{item.name}</strong>.</p>{error&&<p className="error">{error}</p>}<Field label="Add ingredient"><select value="" onChange={e=>{if(e.target.value&&!lines.some(l=>l.ingredient_id===e.target.value))setLines([...lines,{ingredient_id:e.target.value,quantity:'1'}]);}}><option value="">Select ingredient…</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></Field>{lines.map((l,index)=><div className="order-line" key={l.ingredient_id}><span>{ingredients.find(i=>i.id===l.ingredient_id)?.name} ({ingredients.find(i=>i.id===l.ingredient_id)?.unit})</span><input aria-label="Recipe quantity" type="number" min="0.000001" step="0.000001" value={l.quantity} required onChange={e=>setLines(old=>old.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))}/><button type="button" className="icon" aria-label="Remove ingredient" onClick={()=>setLines(old=>old.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>)}<Result error={save.error} busy={save.busy||!ready||!lines.length}/></form>;}