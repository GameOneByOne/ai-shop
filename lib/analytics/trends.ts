import { calculateMetrics } from "./metrics";

export interface DailyMetricPoint {
  date: string;
  impressions: number;
  clicks: number;
  visitors: number;
  orders: number;
  revenue: number;
  refundOrders: number;
  adSpend: number;
  unitsSold: number;
  refundAmount: number;
  addToCart: number;
  ctr: number;
  visitorCvr: number;
  refundRate: number;
}

export function toTrendPoint(point:{date:string;impressions:number;clicks:number;visitors:number;orders:number;revenue:number;refundOrders:number;adSpend:number;unitsSold:number;refundAmount:number;addToCart:number},unitCost:number):DailyMetricPoint{const calculated=calculateMetrics({...point,unitCost});return{...point,date:point.date.slice(5).replace("-","/"),ctr:(calculated.ctr??0)*100,visitorCvr:(calculated.visitorCvr??0)*100,refundRate:(calculated.refundRate??0)*100}}

export function aggregateMetrics(points: DailyMetricPoint[], unitCost: number) {
  const total = points.reduce((sum, point) => ({
    impressions: sum.impressions + point.impressions,
    clicks: sum.clicks + point.clicks,
    visitors: sum.visitors + point.visitors,
    addToCart: sum.addToCart + point.addToCart,
    orders: sum.orders + point.orders,
    unitsSold: sum.unitsSold + point.unitsSold,
    revenue: sum.revenue + point.revenue,
    refundOrders: sum.refundOrders + point.refundOrders,
    refundAmount: sum.refundAmount + point.refundAmount,
    adSpend: sum.adSpend + point.adSpend,
  }), { impressions: 0, clicks: 0, visitors: 0, addToCart: 0, orders: 0, unitsSold: 0, revenue: 0, refundOrders: 0, refundAmount: 0, adSpend: 0 });
  return { totals: total, calculated: calculateMetrics({ ...total, unitCost }) };
}
