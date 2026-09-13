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
export type MenuItem={id:string;name:string;category:string;selling_price:string;packaging_cost?:string;is_active:boolean;version:number;stock_ingredient_id?:string|null};
export type Order={id:string;order_number?:string;table_id?:string|null;floor_name_snapshot?:string|null;table_name_snapshot?:string|null;seats_snapshot?:number|null;status:string;notes:string;version:number;created_at:string;created_by:string;created_by_name?:string|null;created_by_email?:string|null;prepared_by?:string|null;prepared_by_name?:string|null;prepared_by_email?:string|null;paid_by?:string|null;paid_by_name?:string|null;paid_by_email?:string|null;prepared_at?:string|null;completed_at?:string|null;total:string;items:{menu_item_id:string;name?:string;name_snapshot?:string;quantity:number;unit_price?:string}[];discount:string;tax:string;tax_rate?:string|number;discount_percent?:string|number|null;discount_reason?:string|null;platform_fee?:string;delivery_cost?:string};
export type StaffLedgerItem={id:string;full_name:string;email:string;staff_type:'waiter'|'kitchen'|'cashier';is_active:boolean;first_action_at:string;last_action_at:string;tenure_months:number;tenure_label:string;orders_count:number;orders_created:number;orders_prepared:number;orders_paid:number;total_sales:string};
export type Page<T>={items:T[];total:number;limit:number;offset:number};
export type ExpenseCategory='rent'|'salaries'|'utilities'|'marketing'|'maintenance'|'supplies'|'other';
export type Expense={id:string;category:ExpenseCategory;amount:string;incurred_on:string;description:string;created_by:string;created_at:string;voided_at:string|null;void_reason:string|null;version:number};
export type AnalyticsMatrixQuadrant='high_volume/high_margin'|'high_volume/low_margin'|'low_volume/high_margin'|'low_volume/low_margin'|'insufficient_sales';
export type AnalyticsItem={menu_item_id:string;name:string;quantity:number;net_revenue:string|number;contribution_margin:string|number;margin_percent:number|null;matrix:AnalyticsMatrixQuadrant};
export type AnalyticsSummaryData={start_date:string;end_date:string;currency:string;timezone:string;net_revenue:string;direct_cost:string;contribution_margin:string;operating_expenses:string;stock_losses:string;cancellation_losses:string;operating_profit:string;volume_threshold:number;margin_threshold:number;items:AnalyticsItem[]};
export type DailySalesItem={day:string;completed_orders:number;quantity:number;net_revenue:string|number;contribution_margin:string|number};
export type AnalyticsSalesData={start_date:string;end_date:string;currency:string;items:DailySalesItem[];source:string};
export type AnalyticsReportResponse<T>={period:{start_date:string;end_date:string};timezone:string;currency:string;data:T};
export type RecommendationActionType = 'price_update' | 'recipe_update' | 'menu_update' | 'marketing' | 'reorder';
export type RecommendationStatus = 'proposed' | 'approved' | 'applied' | 'rejected';
export type EvidenceItem = { source: string; reference: string; summary: string };
export type Recommendation = {
  id: string;
  action_type: RecommendationActionType;
  title: string;
  description: string;
  target_id?: string | null;
  target_name?: string | null;
  expected_target_version?: number | null;
  proposed_change: Record<string, unknown>;
  evidence: EvidenceItem[];
  status: RecommendationStatus;
  version: number;
  created_by: string;
  approved_by?: string | null;
  created_at: string;
  approved_at?: string | null;
  applied_at?: string | null;
  rejection_reason?: string | null;
};
export type AuditLogItem = {
  id: number;
  actor_id: string;
  actor_name?: string;
  actor_role?: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

export type ForecastModel = 'damped_weekly_ets' | 'weekly_seasonal_naive';
