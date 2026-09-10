'use client';
import { useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { Modal } from './ui';
import styles from './confirmation.module.css';
type Confirmation={title:string;description:string;label:string;onConfirm:()=>Promise<unknown>};
export function useConfirmation(){
 const [pending,setPending]=useState<Confirmation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const inFlight=useRef(false);
 function close(){if(!inFlight.current)setPending(null);}
 return {
  confirm:(options:Confirmation)=>{setError('');setPending(options);},
  confirmationDialog:pending&&<Modal title={pending.title} onClose={close} preventClose={busy}>
   <div className={styles.body} aria-busy={busy}>
    <div className={styles.symbol}><AlertTriangle size={25}/></div>
    <p className={styles.description}>{pending.description}</p>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className={styles.actions}>
     <button type="button" className="soft" autoFocus disabled={busy} onClick={close}>Cancel</button>
     <button type="button" className="danger" disabled={busy} onClick={async()=>{
      if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
      try{await pending.onConfirm();setPending(null);}catch(e){setError((e as Error).message);}finally{inFlight.current=false;setBusy(false);}
     }}>{busy?<><LoaderCircle size={16}/>Please wait…</>:pending.label}</button>
    </div>
   </div>
  </Modal>
 };
}
