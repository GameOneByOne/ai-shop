import type {CommerceProvider,DailyMetric,Order,Product} from "./types";
export class ManualCommerceProvider implements CommerceProvider {constructor(private products:Product[]=[],private metrics:DailyMetric[]=[]){}async getProducts(){return this.products}async getDailyMetrics(date:string){return this.metrics.filter(x=>x.date===date)}async getOrders():Promise<Order[]>{return []}}
