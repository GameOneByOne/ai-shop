export type OfferStatus = "PASS" | "RISK" | "REJECT";

export interface OfferFacts {
  price: number | null;
  onePieceDelivery: boolean | null;
  minOrderQuantity: number | null;
  blindShipping: boolean | null;
  returnShipping: boolean | null;
  noReasonReturn: boolean | null;
  shopAge: number | null;
  qualityRate: number | null;
  repurchaseRate: number | null;
  deliveryRate: number | null;
  stock: number | null;
  imageCount: number | null;
  hasVideo: boolean | null;
  inspection: boolean | null;
}

export interface OfferFilterResult {
  status: OfferStatus;
  reasons: string[];
  hardFailures: string[];
  risks: string[];
}

export function filterOffer(facts: OfferFacts): OfferFilterResult {
  const hardFailures: string[] = [];
  const risks: string[] = [];

  if (facts.price == null || facts.price <= 0) hardFailures.push("采购价不存在");
  if (facts.onePieceDelivery === false) hardFailures.push("不支持一件代发");
  if (facts.minOrderQuantity != null && facts.minOrderQuantity > 10)
    hardFailures.push(`起订量过高（MOQ=${facts.minOrderQuantity}）`);
  if (facts.stock != null && facts.stock < 50)
    risks.push(`库存不足（${facts.stock}）`);

  if (facts.onePieceDelivery == null) risks.push("一件代发能力待确认");
  if (facts.minOrderQuantity == null) risks.push("最小起订量待确认");
  if (facts.stock == null) risks.push("库存待确认");
  if (facts.blindShipping == null) risks.push("无痕发货能力待确认");
  if (facts.returnShipping == null && facts.noReasonReturn == null)
    risks.push("退货保障待确认");

  const status: OfferStatus = hardFailures.length
    ? "REJECT"
    : risks.length
      ? "RISK"
      : "PASS";
  return { status, reasons: [...hardFailures, ...risks], hardFailures, risks };
}

export const isQualifiedOffer = (status: OfferStatus) => status === "PASS";
