import type { SourceProduct } from "./types";

export type DataStatus = "valid" | "needs_review" | "data_error" | "rejected";
export interface ScoreBreakdown {
  profit: number;
  demand: number;
  supplier: number;
  afterSales: number;
  storeFit: number;
  competition: number;
  differentiation: number;
}
export interface EvaluatedProduct extends SourceProduct {
  dataStatus: DataStatus;
  dataIssues: string[];
  salesCount?: number;
  repurchaseRate?: number;
  returnShipping: boolean;
  payLater: boolean;
  dropshipping: boolean;
  clusterKey: string;
  clusterRank: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  reasons: string[];
  rejectedReasons: string[];
  estimatedSalePriceMin?: number;
  estimatedSalePriceMax?: number;
  estimatedUnitProfitMin?: number;
  estimatedUnitProfitMax?: number;
}

const money = (value: number) => Math.round(value * 100) / 100;
const salesMultiplier = (unit?: string) => (unit === "万" ? 10_000 : 1);
function parseSales(text: string) {
  const match = /(?:月销|已售|成交|销量)?\s*(\d+(?:\.\d+)?)\s*(万)?\s*\+?\s*件/.exec(text);
  return match ? Math.round(Number(match[1]) * salesMultiplier(match[2])) : undefined;
}
function clusterFor(title: string) {
  if (/滚筒|滚轮|粘毛滚/.test(title)) return "滚筒粘毛器";
  if (/水洗|可洗/.test(title)) return "可水洗除毛器";
  if (/刮毛|刮板|刮刀/.test(title)) return "沙发刮毛器";
  if (/猫梳|梳毛|脱毛梳|针梳/.test(title)) return "猫咪梳毛器";
  if (/静电|双面.*刷|除毛刷|粘毛刷/.test(title)) return "双面静电刷";
  return title.replace(/[\s\d¥￥.+%-]/g, "").slice(0, 12) || "其他";
}
function proposedPrice(cost: number) {
  const fixedCosts = 4; // 运费3 + 包装0.5 + 售后预留0.5
  const byProfit = (cost + fixedCosts + 5) / 0.84; // 平台+推广按售价16%预留
  const byMargin = (cost + fixedCosts) / 0.44; // 同时满足约40%利润率
  const minimum = Math.max(byProfit, byMargin);
  const rounded = Math.ceil(minimum) - 0.1;
  return { min: money(rounded), max: money(rounded + 3) };
}
function unitProfit(price: number, cost: number) {
  return money(price * 0.84 - cost - 4);
}

export function evaluateProducts(items: SourceProduct[]): EvaluatedProduct[] {
  const evaluated = items.map((item) => {
    const text = item.title;
    const rawText = String(item.rawData?.cardText || text);
    const rawPrice = /[¥￥]\s*(\d+(?:\s*\.\s*\d+)?)/.exec(rawText)?.[1];
    const parsedPrice = rawPrice ? Number(rawPrice.replace(/\s+/g, "")) : undefined;
    const effectivePrice = parsedPrice != null && Number.isFinite(parsedPrice) ? parsedPrice : item.priceMin;
    const parsedMoq = /(\d+)\s*(?:件|个|只|套)\s*起/.exec(rawText)?.[1];
    const effectiveMoq = item.minimumOrderQuantity ?? (parsedMoq ? Number(parsedMoq) : undefined);
    const normalizedItem = { ...item, priceMin: effectivePrice, minimumOrderQuantity: effectiveMoq };
    const salesCount = parseSales(text);
    const repurchase = /回头率\s*(\d+(?:\.\d+)?)%/.exec(text)?.[1];
    const repurchaseRate = repurchase ? Number(repurchase) : undefined;
    const returnShipping = /退货包运费/.test(text);
    const payLater = /先采后付/.test(text);
    const dropshipping = /一件代发/.test(text);
    const issues: string[] = [];
    const rejected: string[] = [];

    if (effectivePrice == null || effectivePrice <= 0) issues.push("采购价无效或未解析");
    else if (effectivePrice < 2) issues.push("采购价低于2元，可能是配件价、最低SKU价或抓取错位");
    if (!effectiveMoq) issues.push("MOQ未解析");
    if (!/规格|款|cm|厘米|大号|小号|双面|单面|颜色/i.test(text)) issues.push("SKU/规格不明确");
    if (!/猫|宠物|粘毛|除毛|梳毛|刮毛/.test(text)) rejected.push("与猫咪居家用品定位不匹配");
    if (effectivePrice != null && effectivePrice > 30) rejected.push("采购价超过30元");
    if (effectiveMoq != null && effectiveMoq > 10) rejected.push("MOQ超过10件");
    if (repurchaseRate != null && repurchaseRate < 20) rejected.push("回头率低于20%");
    if (/药|保健|充电|电池|插电|加热|玻璃|陶瓷/.test(text)) rejected.push("首版高风险品类");

    const dataStatus: DataStatus = rejected.length
      ? "rejected"
      : issues.some((issue) => /采购价无效/.test(issue))
        ? "data_error"
        : issues.length
          ? "needs_review"
          : "valid";
    const price = effectivePrice;
    const estimate = price != null && price > 0 ? proposedPrice(price) : undefined;
    const profit = estimate && price != null ? Math.min(25, Math.round(((unitProfit(estimate.min, price) - 5) / 8) * 10 + 15)) : 0;
    const demand = salesCount ? Math.min(15, Math.round(Math.log10(salesCount + 1) * 4)) : 2;
    const supplier = Math.min(20, (item.supplierName ? 5 : 0) + (repurchaseRate ? Math.min(10, Math.round(repurchaseRate / 10)) : 0) + (payLater ? 5 : 0));
    const afterSales = Math.min(10, (returnShipping ? 6 : 0) + (dropshipping ? 4 : 0));
    const storeFit = /猫/.test(text) ? 15 : /宠物|粘毛|除毛|梳毛/.test(text) ? 11 : 0;
    const competition = salesCount && salesCount > 20_000 ? 4 : salesCount && salesCount > 1000 ? 7 : 5;
    const differentiation = /双面|水洗|便携|替换|多功能/.test(text) ? 4 : 2;
    const breakdown = { profit: Math.max(0, profit), demand, supplier, afterSales, storeFit, competition, differentiation };
    const rawScore = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const score = dataStatus === "valid" ? rawScore : dataStatus === "needs_review" ? Math.min(rawScore, 59) : 0;
    return {
      ...normalizedItem,
      dataStatus,
      dataIssues: issues,
      salesCount,
      repurchaseRate,
      returnShipping,
      payLater,
      dropshipping,
      clusterKey: clusterFor(text),
      clusterRank: 0,
      score,
      scoreBreakdown: breakdown,
      reasons: [`利润空间 ${breakdown.profit}/25`, `市场验证 ${breakdown.demand}/15`, `供应商 ${breakdown.supplier}/20`],
      rejectedReasons: rejected,
      estimatedSalePriceMin: estimate?.min,
      estimatedSalePriceMax: estimate?.max,
      estimatedUnitProfitMin: estimate && price != null ? unitProfit(estimate.min, price) : undefined,
      estimatedUnitProfitMax: estimate && price != null ? unitProfit(estimate.max, price) : undefined,
    } satisfies EvaluatedProduct;
  });

  const clusters = new Map<string, EvaluatedProduct[]>();
  for (const item of evaluated) clusters.set(item.clusterKey, [...(clusters.get(item.clusterKey) || []), item]);
  for (const group of clusters.values()) {
    group.sort((a, b) => b.score - a.score).forEach((item, index) => (item.clusterRank = index + 1));
  }
  return evaluated.sort((a, b) => b.score - a.score);
}
