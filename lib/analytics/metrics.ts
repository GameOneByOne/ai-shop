export interface MetricInput {
  impressions: number;
  clicks: number;
  visitors: number;
  addToCart: number;
  orders: number;
  unitsSold: number;
  revenue: number;
  refundOrders: number;
  refundAmount: number;
  adSpend: number;
  unitCost: number;
  platformFees?: number;
}

export interface CalculatedMetrics {
  ctr: number | null;
  visitorCvr: number | null;
  clickCvr: number | null;
  addToCartRate: number | null;
  refundRate: number | null;
  roas: number | null;
  estimatedGrossProfit: number;
}

function safeRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function calculateMetrics(input: MetricInput): CalculatedMetrics {
  return {
    ctr: safeRatio(input.clicks, input.impressions),
    visitorCvr: safeRatio(input.orders, input.visitors),
    clickCvr: safeRatio(input.orders, input.clicks),
    addToCartRate: safeRatio(input.addToCart, input.visitors),
    refundRate: safeRatio(input.refundOrders, input.orders),
    roas: safeRatio(input.revenue, input.adSpend),
    estimatedGrossProfit:
      input.revenue -
      input.unitsSold * input.unitCost -
      input.adSpend -
      input.refundAmount -
      (input.platformFees ?? 0),
  };
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

export function formatRatio(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}
