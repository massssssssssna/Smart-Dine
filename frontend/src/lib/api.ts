export class ApiError extends Error { constructor(message:string,public status:number){super(message);} }
export async function api<T=unknown>(path:string,method='GET',body?:unknown,key?:string):Promise<T>{
 const response=await fetch('/api/backend/'+path,{method,headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const text=response.status===204?'':await response.text();
 let data=null;
 if(text){try{data=JSON.parse(text);}catch{throw new ApiError('The server returned an invalid response. Please try again.',response.status);}}
 if(!response.ok) throw new ApiError(data?.message||'The request could not be completed.',response.status);
 return data;
}
export const money=(value:string|number=0)=>new Intl.NumberFormat('en-PK',{style:'currency',currency:'PKR',maximumFractionDigits:2}).format(Number(value));
export type Profile={id:string;email:string;full_name:string;role:'manager'|'staff';staff_type:'waiter'|'kitchen'|'cashier';is_active:boolean;version:number;cashier_billing_enabled?:boolean};
export type MenuItem={id:string;name:string;category:string;selling_price:string;packaging_cost?:string;is_active:boolean;version:number};
export type Order={id:string;order_number?:string;table_id?:string|null;floor_name_snapshot?:string|null;table_name_snapshot?:string|null;seats_snapshot?:number|null;status:string;notes:string;version:number;created_at:string;created_by:string;total:string;items:{menu_item_id:string;name?:string;name_snapshot?:string;quantity:number;unit_price?:string}[];discount:string;tax:string;platform_fee?:string;delivery_cost?:string};
export type Page<T>={items:T[];total:number;limit:number;offset:number};
