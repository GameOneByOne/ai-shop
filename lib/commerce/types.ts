export interface Product { id:string; skuCode:string; name:string }
export interface DailyMetric { skuCode:string; date:string; impressions:number; clicks:number; orders:number; revenue:number }
export interface Order { id:string; skuCode:string; amount:number }
export interface CommerceProvider { getProducts():Promise<Product[]>; getDailyMetrics(date:string):Promise<DailyMetric[]>; getOrders():Promise<Order[]> }
