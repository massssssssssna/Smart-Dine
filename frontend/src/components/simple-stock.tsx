'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, Page } from '@/lib/api';
import { Empty, Field, Modal } from './ui';
import { useConfirmation } from './use-confirmation';

type Stock = {id:string;menu_item_id:string;name:string;stock_quantity:number;reorder_level:number;received:number;used:number;removed:number};
type Editor = {kind:'create'|'receive'|'remove';item?:Stock};

export function StockPanel({onChanged}:{onChanged:()=>void}) {
  const {confirm,confirmationDialog}=useConfirmation();
  const [items,setItems]=useState<Stock[]>([]),[error,setError]=useState(''),[editor,setEditor]=useState<Editor|null>(null);
  const [offset,setOffset]=useState(0),[total,setTotal]=useState(0),[loading,setLoading]=useState(true);
  const [deleting,setDeleting]=useState(false);
  async function deleteDrink(item:Stock) {
    setDeleting(true);setError('');
    try {
      const menuItem=await api<{version:number}>('menu/'+item.menu_item_id);
      await api('menu/'+item.menu_item_id,'DELETE',{expected_version:menuItem.version},crypto.randomUUID());
      await load();onChanged();
    } finally{setDeleting(false);}
  }
  const load=useCallback(async()=>{
    try {const result=await api<Page<Stock>>(`inventory/products?limit=100&offset=${offset}`);setItems(result.items);setTotal(result.total);setError('');}
    catch(e){setError((e as Error).message);} finally {setLoading(false);}
  },[offset]);
  useEffect(()=>{void load();const interval=setInterval(()=>void load(),15000);return()=>clearInterval(interval);},[load]);
  return <section className="panel">
    {confirmationDialog}
    <div className="panel-head"><div><h2>Drinks & bottles</h2><p className="muted">Add bottles when they arrive. Counts reduce when orders enter preparation.</p></div>
      <button onClick={()=>setEditor({kind:'create'})}><Plus size={16}/>Add drink</button></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>Drink / size</th><th>Received</th><th>Used in orders</th><th>Damaged / missing</th><th>Remaining</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{items.map(item=><tr key={item.id}><td><strong>{item.name}</strong></td><td>{Number(item.received)}</td><td>{Number(item.used)}</td><td>{Number(item.removed)}</td><td><strong>{Number(item.stock_quantity)} bottles / pieces</strong></td>
        <td>{Number(item.stock_quantity)===0?'Out of stock':Number(item.stock_quantity)<=Number(item.reorder_level)?'Low stock':'In stock'}</td>
        <td className="row-actions"><button className="soft" onClick={()=>setEditor({kind:'receive',item})}>Add stock</button><button className="danger-ghost" onClick={()=>setEditor({kind:'remove',item})}>Damaged / missing</button><button className="danger-ghost" disabled={deleting} onClick={()=>confirm({title:'Delete drink?',description:`${item.name} will be removed from inventory and the menu. Past orders and stock history will be kept.`,label:'Delete drink',onConfirm:()=>deleteDrink(item)})}>Delete</button></td></tr>)}</tbody></table></div>
    {!items.length&&<Empty>{loading?'Loading stock…':'Add your first drink, for example Pepsi 500ml or Water 1.5L.'}</Empty>}
    {total>100&&<div className="row-actions"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous</button><span>{offset+1}–{Math.min(offset+100,total)} of {total}</span><button disabled={offset+100>=total} onClick={()=>setOffset(offset+100)}>Next</button></div>}
    {editor&&<Modal title={editor.kind==='create'?'Add drink':editor.kind==='receive'?'Stock received':'Damaged / missing stock'} onClose={()=>setEditor(null)}>
      <StockForm editor={editor} onDone={()=>{setEditor(null);void load();onChanged();}}/>
    </Modal>}
  </section>;
}
