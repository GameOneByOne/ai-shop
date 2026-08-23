export type OfferStatus = "PASS" | "REJECT";
export type StableSourceDecision = "PASSED" | "REJECTED";
export type DimensionGrade = "优秀" | "合格" | "良好" | "风险" | "待确认" | "不合格";

export interface OfferFacts {
  price: number | null; onePiecePrice?: number | null; onePieceDelivery: boolean | null; minOrderQuantity: number | null;
  blindShipping: boolean | null; returnShipping: boolean | null; noReasonReturn: boolean | null;
  shopAge: number | null; qualityRate: number | null; repurchaseRate: number | null;
  deliveryRate: number | null; pickup24Rate?: number | null; pickup48Rate?: number | null;
  dropshipQualityRate?: number | null; dropshipBuyerRetentionRate?: number | null;
  dropship7DayVolume?: number | null; dropship30DayVolume?: number | null; dropshipPlatforms?: string | null;
  productRating?: number | null; totalReviewCount?: number | null; positiveReviewRate?: number | null;
  productFavoriteCount?: number | null; shopFavoriteCount?: number | null;
  hasSelectionTitle?: boolean | null;
  productRepurchaseRate?: number | null; skuTotalCount?: number | null; skuKnownStockCount?: number | null;
  skuInStockCount?: number | null; skuAvailabilityRate?: number | null;
  stock: number | null; imageCount: number | null; skuImageCount?: number | null; detailImageCount?: number | null;
  hasVideo: boolean | null; inspection: boolean | null; productValid?: boolean | null;
}

export interface OfferFilterResult {
  status: OfferStatus; decision: StableSourceDecision; confidence: "高" | "中" | "低";
  hardGate: "通过" | "待确认" | "不通过";
  dimensions: { dropshipping: DimensionGrade; fulfillment: DimensionGrade; productQuality: DimensionGrade;
    supplierStability: DimensionGrade; skuAvailability: DimensionGrade; afterSales: DimensionGrade };
  reasons: string[]; strengths: string[]; hardFailures: string[]; risks: string[]; missingFields: string[];
}

export interface OfferRuleConfig { requireOnePiece: boolean; require1688Selection: boolean; requireReturnShipping: boolean; requireNoReasonReturn: boolean; rejectNoSellableSku: boolean; requireSingleOrder: boolean; rejectInvalidProduct: boolean; rejectMissingCriticalData: boolean; pickup48Min: number; qualityMin: number; reviewCountMin: number; productFavoriteMin: number; positiveReviewMin: number }
export const DEFAULT_OFFER_RULE_CONFIG: OfferRuleConfig = { requireOnePiece: true, require1688Selection: false, requireReturnShipping: false, requireNoReasonReturn: false, rejectNoSellableSku: true, requireSingleOrder: true, rejectInvalidProduct: true, rejectMissingCriticalData: false, pickup48Min: 70, qualityMin: 70, reviewCountMin: 0, productFavoriteMin: 0, positiveReviewMin: 0 };

export function normalizeRuleDecision(value: unknown): StableSourceDecision | null {
  if (value === "PRIMARY" || value === "BACKUP" || value === "PASSED") return "PASSED";
  if (value === "PENDING" || value === "REJECTED") return "REJECTED";
  return null;
}

export function filterOffer(facts: OfferFacts, config: OfferRuleConfig = DEFAULT_OFFER_RULE_CONFIG): OfferFilterResult {
  const hardFailures: string[] = [], risks: string[] = [], strengths: string[] = [], missingFields: string[] = [];
  const pickup48 = facts.pickup48Rate ?? facts.deliveryRate;
  const productFavoriteCount = facts.productFavoriteCount ?? facts.shopFavoriteCount;
  const skuTotal = facts.skuTotalCount, knownSkuStock = facts.skuKnownStockCount, inStockSkus = facts.skuInStockCount;
  const hasSkuDetails = skuTotal != null && skuTotal > 0;
  const hasCompleteSkuStock = hasSkuDetails && knownSkuStock === skuTotal;
  const allKnownSkusOut = hasCompleteSkuStock && inStockSkus === 0;
  const canBuyOne = facts.minOrderQuantity == null || facts.minOrderQuantity <= 1 || facts.onePiecePrice != null;

  if (config.requireOnePiece && facts.onePieceDelivery === false) hardFailures.push("明确不支持一件代发");
  if (config.require1688Selection && facts.hasSelectionTitle === false) hardFailures.push("不是1688严选商品");
  if (config.requireReturnShipping && facts.returnShipping === false) hardFailures.push("不支持退货包运费");
  if (config.requireNoReasonReturn && facts.noReasonReturn === false) hardFailures.push("不支持7天无理由退货");
  if (config.requireSingleOrder && facts.minOrderQuantity != null && facts.minOrderQuantity > 1 && !canBuyOne) hardFailures.push(`无法单件下单（MOQ=${facts.minOrderQuantity}，无可验证单件代发价）`);
  if (config.rejectNoSellableSku && allKnownSkusOut) hardFailures.push("无可售SKU（已知SKU库存均为0）");
  if (config.rejectInvalidProduct && facts.productValid === false) hardFailures.push("商品已下架或无法购买");
  if (pickup48 != null && pickup48 < config.pickup48Min) hardFailures.push(`48H揽收率${pickup48}%，低于${config.pickup48Min}%履约线`);
  if (facts.dropshipQualityRate != null && facts.dropshipQualityRate < config.qualityMin) hardFailures.push(`代发品质达标率${facts.dropshipQualityRate}%，低于${config.qualityMin}%质量线`);
  if (facts.qualityRate != null && facts.qualityRate < config.qualityMin) hardFailures.push(`商品品质达标率${facts.qualityRate}%，低于${config.qualityMin}%质量线`);
  if (facts.totalReviewCount != null && facts.totalReviewCount < config.reviewCountMin) hardFailures.push(`商品评价数量${facts.totalReviewCount}条，少于${config.reviewCountMin}条`);
  if (productFavoriteCount != null && productFavoriteCount < config.productFavoriteMin) hardFailures.push(`商品收藏数量${productFavoriteCount}，少于${config.productFavoriteMin}`);
  if (facts.positiveReviewRate != null && facts.positiveReviewRate < config.positiveReviewMin && !hardFailures.some((reason) => reason.startsWith("好评率"))) hardFailures.push(`好评率${facts.positiveReviewRate}%，低于${config.positiveReviewMin}%`);

  if (facts.onePieceDelivery == null) missingFields.push("一件代发状态");
  if (config.require1688Selection && facts.hasSelectionTitle == null) missingFields.push("1688严选标识");
  if (config.requireReturnShipping && facts.returnShipping == null) missingFields.push("退货包运费");
  if (config.requireNoReasonReturn && facts.noReasonReturn == null) missingFields.push("7天无理由退货");
  if (facts.minOrderQuantity == null && facts.onePiecePrice == null) missingFields.push("最小起订量或单件下单能力");
  if (!hasSkuDetails || !hasCompleteSkuStock) missingFields.push("SKU库存完整性");
  if (facts.productValid == null) missingFields.push("商品有效及可购买状态");
  if (pickup48 == null) missingFields.push("48H揽收率");
  if (facts.totalReviewCount == null) missingFields.push("商品评价数量");
  if (productFavoriteCount == null) missingFields.push("商品收藏数量");
  if (facts.qualityRate == null && facts.dropshipQualityRate == null) missingFields.push("商品品质或代发品质达标率");
  if (facts.positiveReviewRate == null) missingFields.push("好评率");
  if (config.rejectMissingCriticalData && missingFields.length) hardFailures.push(`关键规则数据缺失：${missingFields.join("、")}`);

  if (facts.pickup24Rate != null && facts.pickup24Rate < 90) risks.push(`24H揽收率偏低（${facts.pickup24Rate}%）`);
  if (pickup48 != null && pickup48 >= 85 && pickup48 < 95) risks.push(`48H揽收率一般（${pickup48}%）`);
  if (facts.skuAvailabilityRate != null && facts.skuAvailabilityRate < 100) risks.push(`存在缺货规格，SKU有货率${facts.skuAvailabilityRate.toFixed(1)}%`);
  if (facts.skuAvailabilityRate != null && facts.skuAvailabilityRate < 70) risks.push("SKU有货率低于70%，核心规格供货风险较高");
  if (facts.totalReviewCount != null && facts.totalReviewCount < 30) risks.push(`评价样本不足（${facts.totalReviewCount}条）`);
  if (facts.hasSelectionTitle === false) risks.push("不是1688严选商品，仅不享受严选加分");
  if (facts.productRepurchaseRate != null && facts.productRepurchaseRate < 10) risks.push(`商品复购率偏低（${facts.productRepurchaseRate}%）`);
  if (facts.repurchaseRate != null && facts.repurchaseRate < 15) risks.push(`店铺回头率偏低（${facts.repurchaseRate}%）`);
  if (facts.dropship30DayVolume != null && facts.dropship30DayVolume <= 0) risks.push("近期代发量不足");
  if (facts.blindShipping === false) risks.push("不支持淘宝密文代发");
  if (facts.returnShipping === false || facts.noReasonReturn === false) risks.push("售后保障不完整");
  if ((facts.imageCount != null && facts.imageCount < 1) || (facts.skuImageCount != null && facts.skuImageCount < 1) || (facts.detailImageCount != null && facts.detailImageCount < 1)) risks.push("商品素材图片不足");

  if (facts.onePieceDelivery === true && (facts.minOrderQuantity === 1 || facts.onePiecePrice != null)) strengths.push("支持一件代发且可以单件购买");
  if (pickup48 != null && pickup48 >= 95) strengths.push(`48H揽收率${pickup48}%`);
  if (facts.dropshipQualityRate != null && facts.dropshipQualityRate >= 95) strengths.push(`代发品质达标率${facts.dropshipQualityRate}%`);
  if (facts.productRating != null && facts.totalReviewCount != null && facts.totalReviewCount >= 30 && (facts.positiveReviewRate ?? 0) >= 95) strengths.push("商品评价样本充分且质量良好");

  const decision: StableSourceDecision = hardFailures.length ? "REJECTED" : "PASSED";
  const dimensions = {
    dropshipping: facts.onePieceDelivery === false || !canBuyOne ? "不合格" : facts.onePieceDelivery == null ? "待确认" : "合格",
    fulfillment: pickup48 == null ? "待确认" : pickup48 < config.pickup48Min ? "不合格" : pickup48 >= 95 ? (facts.pickup24Rate != null && facts.pickup24Rate >= 90 ? "优秀" : "良好") : "风险",
    productQuality: facts.totalReviewCount == null ? "待确认" : facts.totalReviewCount >= config.reviewCountMin && (facts.positiveReviewRate ?? 0) >= config.positiveReviewMin ? "合格" : "不合格",
    supplierStability: facts.qualityRate == null ? "待确认" : facts.qualityRate < config.qualityMin ? "不合格" : facts.shopAge != null && facts.shopAge >= 5 ? "良好" : "合格",
    skuAvailability: !hasCompleteSkuStock ? "待确认" : allKnownSkusOut ? "不合格" : (facts.skuAvailabilityRate ?? 100) < 70 ? "风险" : (facts.skuAvailabilityRate ?? 100) < 100 ? "良好" : "优秀",
    afterSales: facts.returnShipping === true && facts.noReasonReturn === true ? "优秀" : facts.returnShipping == null && facts.noReasonReturn == null ? "待确认" : "风险",
  } satisfies OfferFilterResult["dimensions"];
  return { status: decision === "REJECTED" ? "REJECT" : "PASS", decision,
    confidence: decision === "REJECTED" ? "高" : "中",
    hardGate: decision === "REJECTED" ? "不通过" : "通过",
    dimensions, reasons: [...hardFailures, ...risks], strengths, hardFailures, risks, missingFields };
}

export const isQualifiedOffer = (status: OfferStatus) => status === "PASS";
