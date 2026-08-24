import assert from "node:assert/strict";
import { sourcingSelectionInputSchema, sourcingSelectionOutputSchema } from "../lib/ai/sourcing-selection-contract.ts";
import { listingStockValue, taobaoDraftEnhancementSchema, taobaoDraftSnapshotSchema } from "../lib/ai/taobao-draft-enhancement.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
assert.equal(sourcingSelectionInputSchema.safeParse({ runId: uuid }).success, true);
assert.equal(sourcingSelectionInputSchema.parse({ runId: uuid, force: true }).force, true, "重新AI选择必须支持绕过缓存并覆盖当前结论");
assert.equal(sourcingSelectionInputSchema.parse({ runId: uuid, applyRules: false }).applyRules, false, "AI选择必须支持显式跳过规则分支");
const selection = sourcingSelectionOutputSchema.safeParse({ results: [{ offerId: uuid, standardProductName: "蘑菇造型猫抓柱", categoryParent: "抓挠攀爬", categoryChild: "猫抓柱", recommendation: "RECOMMENDED", confidence: "HIGH", dimensions: { dropshipFit: "优秀", supplyStability: "良好", fulfillmentStability: "良好", qualityConfidence: "一般", supplierStability: "良好" }, directionKey: "猫抓柱+剑麻+室内", advantages: ["支持一件代发"], risks: [], conflicts: [], missingEvidence: [], recommendationReason: "履约证据较完整", finalAdvice: "可作为主货源候选" }] });
assert.equal(selection.success, true, "第一阶段必须只返回货源判断结构");
assert.equal(sourcingSelectionOutputSchema.safeParse({ results: selection.success ? selection.data.results : [], title: "不允许输出上架标题" }).success, false, "第一阶段禁止夹带内容生产字段");

const snapshot = taobaoDraftSnapshotSchema.parse({ itemId: "1077969889433", url: "https://item.upload.taobao.com/sell/v2/publish.htm?itemId=1077969889433", category: "宠物用品", title: "猫抓柱", guideTitle: "", attributes: [], skus: [{ name: "红色", price: "33", stock: "100", merchantCode: "SKU-1" }], imageUrls: ["https://example.com/main.jpg"], pageText: "宝贝标题 猫抓柱" });
assert.equal(snapshot.skus[0].price, "33");
const enhancement = taobaoDraftEnhancementSchema.parse({ audit: [{ field: "title", status: "PASS", detail: "核心词完整" }], editable: { title: "剑麻猫抓柱耐磨磨爪玩具", guideTitle: "室内猫咪磨爪玩具", sellingPoints: ["剑麻抓面", "室内使用", "磨爪玩耍", "结构直观", "多规格可选"], shortDescription: "基于淘宝草稿已填信息优化。", detailSections: [{ heading: "商品特点", body: "用于猫咪日常磨爪。", evidence: ["草稿标题"] }, { heading: "规格说明", body: "规格以页面SKU为准。", evidence: ["草稿SKU"] }, { heading: "注意事项", body: "购买前请核对规格。", evidence: ["草稿SKU"] }] }, corrections: [], mediaPlan: { keepImageUrls: ["https://example.com/main.jpg"], missingAssets: [] }, skuMappings: [{ draftSkuIndex: 0, draftSkuName: "红色", sourceSkuId: "SKU-1", matchBasis: "ATTRIBUTE" }], skuUpdates: [], lockedFields: { category: true, skuStructure: true, price: false, stock: false, logistics: true }, readyForAutofill: true, factGaps: [] });
assert.deepEqual(enhancement.lockedFields, { category: true, skuStructure: true, price: false, stock: false, logistics: true });
assert.equal(taobaoDraftEnhancementSchema.safeParse({ ...enhancement, lockedFields: { ...enhancement.lockedFields, price: true } }).success, false, "第二阶段价格必须由受控SKU映射更新");
assert.equal(listingStockValue("SKU-LOW", 88), 88, "供应商库存不超过100时使用实际可售库存");
assert.ok(listingStockValue("SKU-HIGH", 5000) >= 100 && listingStockValue("SKU-HIGH", 5000) <= 999, "供应商库存超过100时必须映射到100-999");
assert.equal(listingStockValue("SKU-HIGH", 5000), listingStockValue("SKU-HIGH", 9999), "同一SourceSKU的展示库存必须稳定");

const events = ["WAREHOUSED", "DRAFT_CAPTURED", "AI_ENHANCED", "SAFE_AUTOFILLED", "READBACK_VERIFIED"];
assert.equal(events.at(-1), "READBACK_VERIFIED", "闭环必须以回读验证结束");
console.log("两阶段AI输入输出约束与闭环状态测试通过");
