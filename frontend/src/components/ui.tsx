'use client';
import { useEffect, useId, useRef } from 'react';
import { X, UtensilsCrossed } from 'lucide-react';
export function Brand(){return <span className="brand"><UtensilsCrossed size={27}/><span>Smart Dine<small>GRAND RESERVE</small></span></span>;}
export function Badge({status}:{status:string}){return <span className={`badge ${status}`}>{status.replaceAll('_',' ')}</span>;}
export function Empty({children='Nothing here yet.'}:{children?:React.ReactNode}){return <div className="empty"><UtensilsCrossed size={28}/><p>{children}</p></div>;}
export function Modal({title,children,onClose,preventClose=false}:{title:string;children:React.ReactNode;onClose:()=>void;preventClose?:boolean}){
 const titleId=useId();
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!preventClose)onClose();}}><div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="icon" disabled={preventClose} onClick={onClose} aria-label="Close"><X size={20}/></button></div>{children}</dialog>;
}
export function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>;}
