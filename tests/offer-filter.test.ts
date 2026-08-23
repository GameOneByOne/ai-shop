import assert from "node:assert/strict";
import { DEFAULT_OFFER_RULE_CONFIG, filterOffer, normalizeRuleDecision, type OfferFacts } from "../lib/sourcing/offer-filter.ts";

const complete: OfferFacts = {
  price: 5.9, onePiecePrice: 5.9, onePieceDelivery: true, minOrderQuantity: 1,
  blindShipping: true, returnShipping: true, noReasonReturn: true,
  shopAge: 3, productFavoriteCount: 1234, qualityRate: 100, repurchaseRate: 63, deliveryRate: 100,
  pickup24Rate: 92, pickup48Rate: 100, dropshipQualityRate: 100,
  dropshipBuyerRetentionRate: 95, dropship30DayVolume: 120, dropshipPlatforms: "淘宝、拼多多",
  productRating: 4.8, totalReviewCount: 1300, positiveReviewRate: 99.6, productRepurchaseRate: 23.45,
  skuTotalCount: 10, skuKnownStockCount: 10, skuInStockCount: 10, skuAvailabilityRate: 100,
  stock: 35_000, imageCount: 8, skuImageCount: 10, detailImageCount: 12,
  hasVideo: true, inspection: true, productValid: true, hasSelectionTitle: true,
};

// 场景 A：完整优质货源只能通过规则，绝不产生主备状态。
assert.equal(filterOffer(complete).decision, "PASSED");
assert.equal(filterOffer(complete).hardFailures.length, 0);
assert.equal(filterOffer({ ...complete, stock: 0 }).decision, "PASSED", "总库存不得覆盖SKU证据");
assert.equal(filterOffer({ ...complete, skuTotalCount: 9, skuKnownStockCount: 9, skuInStockCount: 8, skuAvailabilityRate: 88.9 }).decision, "PASSED");
assert.match(filterOffer({ ...complete, skuTotalCount: 9, skuKnownStockCount: 9, skuInStockCount: 8, skuAvailabilityRate: 88.9 }).risks.join(" "), /SKU有货率/);
assert.equal(filterOffer({ ...complete, pickup24Rate: 83, pickup48Rate: 100 }).decision, "PASSED");

// 场景 B：缺失不等于 false 或 0，并明确列出字段。
const pending = filterOffer({ ...complete, onePieceDelivery: null, skuKnownStockCount: 0, skuAvailabilityRate: null, pickup48Rate: null, deliveryRate: null });
assert.equal(pending.decision, "PASSED");
assert.ok(pending.missingFields.includes("一件代发状态"));
assert.ok(pending.missingFields.includes("SKU库存完整性"));
assert.ok(pending.missingFields.includes("48H揽收率"));

// 场景 C：每个硬门槛给出具体淘汰原因。
assert.deepEqual(filterOffer({ ...complete, onePieceDelivery: false }).hardFailures, ["明确不支持一件代发"]);
assert.equal(filterOffer({ ...complete, hasSelectionTitle: false }).decision, "PASSED");
assert.match(filterOffer({ ...complete, hasSelectionTitle: false }).risks.join(" "), /不是1688严选/);
assert.equal(filterOffer({ ...complete, returnShipping: false }).decision, "PASSED");
assert.equal(filterOffer({ ...complete, noReasonReturn: false }).decision, "PASSED");
assert.match(filterOffer({ ...complete, minOrderQuantity: 2, onePiecePrice: null }).hardFailures[0], /无法单件下单/);
assert.match(filterOffer({ ...complete, skuInStockCount: 0, skuAvailabilityRate: 0 }).hardFailures[0], /无可售SKU/);
assert.match(filterOffer({ ...complete, pickup48Rate: 69.9 }).hardFailures[0], /低于70%/);
assert.equal(filterOffer({ ...complete, positiveReviewRate: 90 }).decision, "PASSED");
assert.equal(filterOffer({ ...complete, positiveReviewRate: 20 }).decision, "PASSED");
assert.equal(filterOffer({ ...complete, totalReviewCount: 5 }).decision, "PASSED");
assert.match(filterOffer({ ...complete, totalReviewCount: 5 }).risks.join(" "), /评价样本不足/);
assert.equal(filterOffer({ ...complete, productFavoriteCount: 1 }).decision, "PASSED");
assert.equal(filterOffer({ ...complete, productFavoriteCount: undefined, shopFavoriteCount: 84 }).decision, "PASSED", "历史店铺收藏字段必须作为商品收藏数兼容读取");
assert.equal(filterOffer({ ...complete, blindShipping: null }).decision, "PASSED", "密文代发不再参与淘汰规则");
assert.equal(filterOffer({ ...complete, blindShipping: false }).decision, "PASSED", "不支持密文代发也不淘汰");

// 用户仍可在规则编辑器中把偏好升级为硬门槛。
const strict = { ...DEFAULT_OFFER_RULE_CONFIG, require1688Selection: true, requireReturnShipping: true, requireNoReasonReturn: true, rejectMissingCriticalData: true, reviewCountMin: 50, productFavoriteMin: 20, positiveReviewMin: 85 };
assert.deepEqual(filterOffer({ ...complete, hasSelectionTitle: false }, strict).hardFailures, ["不是1688严选商品"]);
assert.match(filterOffer({ ...complete, totalReviewCount: 49 }, strict).hardFailures.join(" "), /少于50条/);

assert.equal(normalizeRuleDecision("PRIMARY"), "PASSED");
assert.equal(normalizeRuleDecision("BACKUP"), "PASSED");
assert.equal(normalizeRuleDecision("PENDING"), "REJECTED");
console.log("OfferFilter stable-dropship-v3 回归通过");
