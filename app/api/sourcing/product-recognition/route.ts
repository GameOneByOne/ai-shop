import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { downloadAiImage, readAiImageCache } from "@/lib/sourcing/ai-image-cache";
import { isImageUnsupportedError, productRecognitionMode } from "@/lib/ai/image-capability";

export const maxDuration = 180;

const requestSchema = z.object({ runId: z.string().uuid(), offerIds: z.array(z.string().uuid()).length(1), maxTitleChars: z.number().int().min(20).max(120).default(60) });
const categories = {
  玩具互动: ["猫隧道", "逗猫棒", "自嗨玩具", "益智玩具", "猫薄荷木天蓼", "其他互动玩具"],
  抓挠攀爬: ["猫抓板", "猫抓柱", "猫爬架", "抓窝一体"],
  睡眠休息: ["猫窝", "猫垫猫床", "猫吊床", "多功能猫窝"],
  猫砂如厕: ["猫砂盆", "猫砂垫", "猫砂铲", "如厕耗材", "如厕收纳", "猫砂"],
  喂食饮水: ["猫碗食盆", "自动喂食器", "饮水用品", "喂食配件", "储粮用品"],
  美容护理: ["梳毛工具", "洗澡护理", "指甲护理", "口腔护理", "护理辅助"],
  居家清洁: ["毛发清洁", "家具防护", "收纳整理", "防滑防污", "环境清洁"],
  穿戴出行: ["猫包航空箱", "胸背牵引", "项圈身份", "猫咪服饰", "其他出行用品"],
} as const;
const parentNames = Object.keys(categories) as [keyof typeof categories, ...(keyof typeof categories)[]];
const childNames = Object.values(categories).flat() as [string, ...string[]];
const resultSchema = z.object({ results: z.array(z.object({
  offerId: z.string().uuid(), mixedSelling: z.boolean(), mixedSellingType: z.enum(["NONE", "VARIANT_ONLY", "ACCESSORY_MIX", "MULTI_PRODUCT"]),
  offerType: z.enum(["SINGLE_PRODUCT", "MIXED_SKU"]),
  productGroups: z.array(z.object({
    standardName: z.string().trim().min(2).max(80), sellingTitle: z.string().trim().min(8).max(120), categoryParent: z.enum(parentNames), categoryChild: z.enum(childNames),
    coreProductType: z.string().trim().min(2).max(40),
    titleFeatures: z.array(z.object({ feature: z.string().min(1), evidence: z.string().min(1), evidenceSource: z.enum(["main_image", "sku_image", "sku_name", "attribute", "detail", "original_title"]) })).max(4),
    removedClaims: z.array(z.object({ claim: z.string().min(1), reason: z.enum(["重复词", "泛化词", "无证据卖点", "来源词", "非核心规格", "风险表述"]) })).max(12),
    needsReview: z.boolean(), reviewReason: z.string(),
    skuIds: z.array(z.string()).max(50), confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    attributes: z.record(z.string(), z.string()).optional(),
  })).min(1).max(12),
  unresolvedSkus: z.array(z.string()).max(50),
  evidence: z.array(z.string().min(1)).min(1).max(8), risks: z.array(z.string().min(1)).max(8),
  sourceEvaluation: z.object({
    recommendation: z.enum(["RECOMMENDED", "USABLE", "CAUTIOUS", "NOT_RECOMMENDED"]), confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    dimensions: z.object({ dropshipFit: z.string(), supplyStability: z.string(), fulfillmentStability: z.string(), qualityConfidence: z.string(), supplierStability: z.string() }),
    directionKey: z.string().min(2).max(80), advantages: z.array(z.string()).max(8), risks: z.array(z.string()).max(8), conflicts: z.array(z.string()).max(8), missingEvidence: z.array(z.string()).max(8), recommendationReason: z.string().min(2), finalAdvice: z.string().min(2),
  }),
})).max(50) });
type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const PROMPT_VERSION = "offer-combined-recognition-evaluation-v4-evidence-naming";
type Recognition = z.infer<typeof resultSchema>["results"][number];

const categoryKeywordRules: Array<{ pattern: RegExp; categoryParent: keyof typeof categories; categoryChild: string }> = [
  { pattern: /猫隧道|隧道帐篷|隧道玩具|钻洞隧道/, categoryParent: "玩具互动", categoryChild: "猫隧道" },
  { pattern: /逗猫棒|羽毛棒|铃铛棒/, categoryParent: "玩具互动", categoryChild: "逗猫棒" },
  { pattern: /猫抓柱|抓挠柱/, categoryParent: "抓挠攀爬", categoryChild: "猫抓柱" },
  { pattern: /猫抓板|瓦楞纸抓板/, categoryParent: "抓挠攀爬", categoryChild: "猫抓板" },
  { pattern: /猫爬架|猫树|爬架/, categoryParent: "抓挠攀爬", categoryChild: "猫爬架" },
  { pattern: /猫砂盆/, categoryParent: "猫砂如厕", categoryChild: "猫砂盆" },
  { pattern: /猫砂垫/, categoryParent: "猫砂如厕", categoryChild: "猫砂垫" },
  { pattern: /猫砂铲/, categoryParent: "猫砂如厕", categoryChild: "猫砂铲" },
  { pattern: /猫吊床/, categoryParent: "睡眠休息", categoryChild: "猫吊床" },
  { pattern: /猫窝/, categoryParent: "睡眠休息", categoryChild: "猫窝" },
  { pattern: /猫包|航空箱/, categoryParent: "穿戴出行", categoryChild: "猫包航空箱" },
];

function verifyRecognitionCategory(result: Recognition, offer: ReturnType<typeof compact>) {
  const text = `${offer.title} ${offer.skus.map((sku) => sku.name).join(" ")}`;
  const matched = categoryKeywordRules.find((rule) => rule.pattern.test(text));
  if (!matched || !result.productGroups.length) return result;
  const [primary, ...rest] = result.productGroups;
  if (primary.categoryParent === matched.categoryParent && primary.categoryChild === matched.categoryChild) return result;
  return {
    ...result,
    productGroups: [{ ...primary, categoryParent: matched.categoryParent, categoryChild: matched.categoryChild }, ...rest],
    evidence: [`标题或SKU名称明确包含“${text.match(matched.pattern)?.[0] ?? matched.categoryChild}”`, ...result.evidence].slice(0, 8),
    risks: [...result.risks, `模型分类已由固定分类词复核为${matched.categoryChild}`].slice(0, 8),
  };
}

function normalizeRecognitionOutput(value: unknown, allowImageEvidence = true) {
  const root = record(value), rawResults = Array.isArray(root.results) ? root.results.map(record) : [];
  const confidence = (input: unknown) => input === "HIGH" || input === "高" ? "HIGH" : input === "LOW" || input === "低" ? "LOW" : "MEDIUM";
  const evidenceSource = (input: unknown) => {
    const source = String(input);
    if (!allowImageEvidence && ["main_image", "sku_image"].includes(source)) return "original_title";
    return ["main_image", "sku_image", "sku_name", "attribute", "detail", "original_title"].includes(source) ? source : "original_title";
  };
  const removedReason = (input: unknown) => ["重复词", "泛化词", "无证据卖点", "来源词", "非核心规格", "风险表述"].includes(String(input)) ? String(input) : "无证据卖点";
  return { results: rawResults.map((item) => {
    const mixedSelling = item.mixedSelling === true;
    const groups = Array.isArray(item.productGroups) ? item.productGroups.map(record) : [];
    const legacyGroup: Row[] = typeof item.productName === "string" && typeof item.categoryParent === "string" && typeof item.categoryChild === "string"
      ? [{ standardName: item.productName, sellingTitle: item.sellingTitle ?? item.productName, categoryParent: item.categoryParent, categoryChild: item.categoryChild, skuIds: [], confidence: item.confidence ?? "MEDIUM" }]
      : [];
    return {
      ...item,
      offerId: item.offerId ?? item.offer_id,
      mixedSelling,
      mixedSellingType: item.mixedSellingType ?? item.mixed_selling_type ?? (mixedSelling ? "MULTI_PRODUCT" : "NONE"),
      offerType: item.offerType ?? item.offer_type ?? (mixedSelling ? "MIXED_SKU" : "SINGLE_PRODUCT"),
      productGroups: (groups.length ? groups : legacyGroup).map((group) => ({
        ...group,
        standardName: group.standardName ?? group.standard_product_name ?? group.productName ?? item.standard_product_name ?? item.productName,
        sellingTitle: group.sellingTitle ?? group.selling_title ?? item.sellingTitle ?? item.selling_title ?? group.standardName ?? group.standard_product_name ?? group.productName ?? item.productName,
        coreProductType: group.coreProductType ?? group.core_product_type ?? group.categoryChild ?? item.categoryChild ?? group.standardName ?? group.standard_product_name ?? item.productName,
        titleFeatures: (Array.isArray(group.titleFeatures) ? group.titleFeatures : Array.isArray(group.title_features) ? group.title_features : []).map((entry) => { const feature = record(entry); return { feature: String(feature.feature ?? ""), evidence: String(feature.evidence ?? ""), evidenceSource: evidenceSource(feature.evidenceSource ?? feature.evidence_source) }; }).filter((entry) => entry.feature && entry.evidence),
        removedClaims: (Array.isArray(group.removedClaims) ? group.removedClaims : Array.isArray(group.removed_claims) ? group.removed_claims : []).map((entry) => { const claim = record(entry); return { claim: String(claim.claim ?? ""), reason: removedReason(claim.reason) }; }).filter((entry) => entry.claim),
        needsReview: group.needsReview === true || group.needs_review === true,
        reviewReason: String(group.reviewReason ?? group.review_reason ?? ""),
        categoryParent: group.categoryParent ?? group.category_parent ?? item.categoryParent ?? item.category_parent,
        categoryChild: group.categoryChild ?? group.category_child ?? item.categoryChild ?? item.category_child,
        skuIds: (Array.isArray(group.skuIds) ? group.skuIds : Array.isArray(group.sku_ids) ? group.sku_ids : []).map(String),
        confidence: confidence(group.confidence ?? item.confidence),
        ...(group.attributes && typeof group.attributes === "object" && !Array.isArray(group.attributes)
          ? { attributes: Object.fromEntries(Object.entries(group.attributes as Record<string, unknown>).map(([key, content]) => [key, String(content)])) }
          : {}),
      })),
      unresolvedSkus: (Array.isArray(item.unresolvedSkus) ? item.unresolvedSkus : Array.isArray(item.unresolved_skus) ? item.unresolved_skus : []).map(String),
      evidence: Array.isArray(item.evidence) && item.evidence.length ? item.evidence.map(String) : ["根据标题、图片和SKU信息识别"],
      risks: Array.isArray(item.risks) ? item.risks.map(String) : [],
      sourceEvaluation: item.sourceEvaluation ?? item.source_evaluation,
    };
  }) };
}

function withoutPriceFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPriceFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/price|cost|amount|fee|freight|shipping|postage|coupon|discount|包邮|运费|价格|优惠|金额/i.test(key))
    .map(([key, content]) => [key, withoutPriceFields(content)]));
}

function compact(row: Row) {
  const raw = record(row.raw_data), detail = record(raw.detailEnrichment), products = Array.isArray(detail.sourceProducts) ? detail.sourceProducts.map(record) : [];
  const skus = products.flatMap((product) => Array.isArray(product.skus) ? product.skus.map(record) : []).map((sku) => ({
    id: String(sku.skuId ?? sku.sourceVariantId ?? sku.id ?? ""), name: String(sku.rawSpecText ?? sku.specName ?? ""), values: sku.specValues ?? [], image: sku.image ?? sku.imageUrl ?? null,
  }));
  const mainImages = Array.isArray(detail.mainImages) ? detail.mainImages.filter((value): value is string => typeof value === "string") : [];
  const mainImage = mainImages[0] ?? row.image_url ?? null;
  return { offerId: String(row.id), title: row.title, productAttributes: record(detail.productAttributes), mainImage, cachedImage: readAiImageCache(raw.aiImageCache, typeof mainImage === "string" ? mainImage : null), skus };
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "AI商品识别参数无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: rows, error } = await db.from("source_products").select("id,title,image_url,raw_data,candidate_product_id").eq("user_id", auth.user.id).eq("sourcing_run_id", parsed.data.runId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // The current workflow stops rule-rejected offers before every AI stage.
  const eligibleRows = ((rows ?? []) as Row[]).filter((row) => {
    const selection = record(record(row.raw_data).sourcingSelection);
    const decision = selection.ruleOverride === true ? "PASSED" : String(record(record(row.raw_data).ruleSelection).decision ?? "");
    const manualStatus = String(selection.status ?? "");
    return decision === "PASSED" && manualStatus !== "REJECTED" && (!parsed.data.offerIds || parsed.data.offerIds.includes(String(row.id)));
  });
  const offers = eligibleRows.map(compact);
  if (!offers.length) return Response.json({ error: "当前没有可识别的候选货源" }, { status: 409 });
  const inputHash = createHash("sha256").update(JSON.stringify({ PROMPT_VERSION, offers: offers.map(({ cachedImage, ...offer }) => ({ ...offer, imagePreparedAt: cachedImage?.preparedAt ?? null })) })).digest("hex");
  const saved = offers.map((offer) => record(record(eligibleRows.find((row) => row.id === offer.offerId)?.raw_data).productRecognition));
  if (saved.length === offers.length && saved.every((item) => item.inputHash === inputHash)) return Response.json({ ok: true, deduplicated: true, results: saved });
  const apiKey = process.env.VISION_API_KEY || process.env.OPENAI_API_KEY, model = process.env.VISION_MODEL || process.env.OPENAI_MODEL;
  const baseUrl = (process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const configuredMode = productRecognitionMode(process.env.VISION_MODEL);
  let actualAnalysisMode: "vision" | "text" = configuredMode;
  if (!apiKey || !model) return Response.json({ error: "缺少多模态商品识别模型配置" }, { status: 500 });
  const allResults: z.infer<typeof resultSchema>["results"] = [], started = performance.now();
  const batches = offers.map((offer) => [offer]);
  try {
    const batchResults = await Promise.all(batches.map(async (batch) => {
      const content: Array<Record<string, unknown>> = [{ type: "text", text: `你是AI-shop的商品标准化与淘宝标题生成模块，同时完成SKU分组和货源评估。标准商品名与售卖标题是两个完全不同的任务。

【标准商品名】用于内部归类、商品聚合和货源比较，只回答“这到底是什么商品”。结构为“核心商品词+必要区分特征”。只保留影响购买选择、SKU归并或货源比较的核心用途、主要结构、核心材质、明显造型、关键功能。同类商品跨供应商应尽量使用一致名称。禁止泛化词、交易词、营销卖点、普通颜色尺寸赠品、重复或近义商品词。猫爬架、猫抓柱、猫抓板、猫玩具同时出现时，必须根据图片、结构、现有分类和主要购买目的选择唯一核心商品词；抓挠磨爪为主选猫抓柱/猫抓架，明显多层攀爬休息才选猫爬架。

【售卖标题】用于淘宝搜索、点击和消费者理解。结构为“核心搜索词+造型或材质+核心功能+使用场景或真实卖点”。核心商品词靠前，只保留2至4个有输入证据的特征，语言自然，不堆砌或重复近义词。禁止编造材质、功效、规格或承诺；禁止品牌、授权、官方、正品、第一、最佳；禁止网红、爆款、厂家直销、1688同款；不写供应商、价格、MOQ、代发或物流。颜色尺寸只有构成主要购买差异时才使用。sellingTitle不得超过输入参数maxTitleChars。

【证据】每个进入sellingTitle的特征必须返回titleFeatures证据；证据不足就删除，不得依靠常识补全。优先级：主图/SKU图/明确属性/详情，其次SKU名称，原始标题只作辅助。对“不粘毛、易清洁、耐抓耐磨”等无法由输入明确证明的描述必须删除并写入removedClaims。分类使用输入中的固定分类树和已有分类，不创建新分类；不使用程序名称词典。

再评估货源，但不得重复固定阈值、设置主备货源或猜测SKU价格库存。${configuredMode === "text" ? "本次没有配置视觉模型，只能使用标题、属性、SKU名称和详情文字；严禁声称查看了主图或SKU图，严禁使用main_image或sku_image作为证据，无法从文字确认的外观与材质必须标记待复核。" : "本次已配置视觉模型，可以结合提供的主图识别。"}maxTitleChars=${parsed.data.maxTitleChars}。分类树=${JSON.stringify(categories)}。仅输出JSON：{"results":[{"offerId":"uuid","offerType":"SINGLE_PRODUCT|MIXED_SKU","productGroups":[{"standardName":"","coreProductType":"","sellingTitle":"","titleFeatures":[{"feature":"","evidence":"","evidenceSource":"main_image|sku_image|sku_name|attribute|detail|original_title"}],"removedClaims":[{"claim":"","reason":"重复词|泛化词|无证据卖点|来源词|非核心规格|风险表述"}],"categoryParent":"父分类","categoryChild":"子分类","skuIds":["sku-id"],"confidence":"HIGH|MEDIUM|LOW","needsReview":false,"reviewReason":"","attributes":{}}],"mixedSelling":false,"mixedSellingType":"NONE|VARIANT_ONLY|ACCESSORY_MIX|MULTI_PRODUCT","unresolvedSkus":[],"evidence":["识别依据"],"risks":[],"sourceEvaluation":{"recommendation":"RECOMMENDED|USABLE|CAUTIOUS|NOT_RECOMMENDED","confidence":"HIGH|MEDIUM|LOW","dimensions":{"dropshipFit":"结论","supplyStability":"结论","fulfillmentStability":"结论","qualityConfidence":"结论","supplierStability":"结论"},"directionKey":"现有分类+核心结构+使用场景","advantages":[],"risks":[],"conflicts":[],"missingEvidence":[],"recommendationReason":"理由","finalAdvice":"建议"}}]}` }];
      for (const offer of batch) {
        const sourceRow = eligibleRows.find((row) => String(row.id) === offer.offerId), raw = record(sourceRow?.raw_data);
        const existingRecognition = record(raw.productRecognition);
        content.push({ type: "text", text: `Offer事实：${JSON.stringify({ offerId: offer.offerId, title: offer.title, existingCategory: { parent: existingRecognition.categoryParent ?? null, child: existingRecognition.categoryChild ?? null }, productAttributes: withoutPriceFields(offer.productAttributes), skus: offer.skus.map((sku) => ({ id: sku.id, name: sku.name, values: sku.values, hasImage: Boolean(sku.image) })), ruleSelection: record(raw.ruleSelection), offerFacts: withoutPriceFields(record(raw.offerFacts)) })}` });
        if (configuredMode === "vision" && typeof offer.mainImage === "string" && /^https?:/i.test(offer.mainImage)) {
          const imageData = offer.cachedImage?.dataUrl ?? (await downloadAiImage(offer.mainImage)).dataUrl;
          content.push({ type: "image_url", image_url: { url: imageData, detail: "low" } });
        }
      }
      const requestModel = async (requestContent: Array<Record<string, unknown>>) => {
        const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: "关闭深度思考。只输出合法JSON。标准商品名用于同类统一，售卖标题必须真实自然且逐项提供证据；分类只能来自给定分类树。" }, { role: "user", content: requestContent }], response_format: { type: "json_object" }, max_tokens: 1800, stream: false, thinking: { type: "disabled" } }), signal: AbortSignal.timeout(45_000) });
        return { response, responseText: await response.text() };
      };
      let { response, responseText } = await requestModel(content);
      let body: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } = {};
      try { body = responseText ? JSON.parse(responseText) as typeof body : {}; } catch { throw new Error(`视觉模型返回了无法解析的响应（HTTP ${response.status}）`); }
      if (!response.ok && configuredMode === "vision" && isImageUnsupportedError(body.error?.message ?? responseText)) {
        actualAnalysisMode = "text";
        const textOnlyContent = content.filter((part) => part.type !== "image_url");
        textOnlyContent[0] = { type: "text", text: `${String(textOnlyContent[0]?.text ?? "")}\n视觉输入不可用，本次已降级为纯文字识别；不得使用图片作为证据，外观与材质不确定时必须标记待复核。` };
        ({ response, responseText } = await requestModel(textOnlyContent));
        try { body = responseText ? JSON.parse(responseText) as typeof body : {}; } catch { throw new Error(`文字降级模型返回了无法解析的响应（HTTP ${response.status}）`); }
      }
      if (!response.ok) throw new Error(body.error?.message ?? `视觉模型请求失败（HTTP ${response.status}）`);
      let value: unknown; try { value = JSON.parse(body.choices?.[0]?.message?.content ?? ""); } catch { throw new Error("视觉模型未返回合法JSON"); }
      const output = resultSchema.safeParse(normalizeRecognitionOutput(value, actualAnalysisMode === "vision"));
      if (!output.success) throw new Error("视觉模型返回的商品识别字段不完整");
      const offerById = new Map(batch.map((offer) => [offer.offerId, offer]));
      return output.data.results.map((result) => {
        const offer = offerById.get(result.offerId);
        return offer ? verifyRecognitionCategory(result, offer) : result;
      });
    }));
    allResults.push(...batchResults.flat());
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI识别与分类请求失败";
    return Response.json({ error: /abort|timeout/i.test(message) ? "视觉模型响应超时，请重试本批商品" : message }, { status: 502 });
  }
  const expected = new Set(offers.map((offer) => offer.offerId)), byId = new Map(allResults.filter((item) => expected.has(item.offerId)).map((item) => [item.offerId, item]));
  if (byId.size !== expected.size) return Response.json({ error: `AI商品识别仅返回 ${byId.size}/${expected.size} 个商品，请重试` }, { status: 502 });
  const analyzedAt = new Date().toISOString(), analysisRunId = randomUUID();
  const persistence = eligibleRows.filter((row) => byId.has(String(row.id))).map((row) => {
    const raw = record(row.raw_data), result = byId.get(String(row.id))!, primary = result.productGroups[0], rule = record(raw.ruleSelection);
    const evaluation = rule.decision === "PENDING" && ["RECOMMENDED", "USABLE"].includes(result.sourceEvaluation.recommendation)
      ? { ...result.sourceEvaluation, recommendation: "CAUTIOUS" as const, recommendationReason: `规则待补数据，最高只能谨慎。${result.sourceEvaluation.recommendationReason}` }
      : result.sourceEvaluation;
    return db.from("source_products").update({ raw_data: { ...raw, productRecognition: {
      ...result,
      // Transitional display aliases for old clients; v2 consumers use productGroups.
      productName: primary.standardName, sellingTitle: primary.sellingTitle, categoryParent: primary.categoryParent, categoryChild: primary.categoryChild, confidence: primary.confidence,
      analyzedAt, analysisRunId, inputHash, promptVersion: PROMPT_VERSION, model, analysisMode: actualAnalysisMode,
    }, aiSelection: { offerId: String(row.id), ...evaluation, analyzedAt, analysisRunId, inputHash, promptVersion: "offer-source-evaluation-v2-combined", model } } }).eq("id", row.id);
  });
  const persisted = await Promise.all(persistence);
  const persistenceError = persisted.find((result) => result.error)?.error;
  if (persistenceError) return Response.json({ error: persistenceError.message }, { status: 500 });
  for (const row of eligibleRows) {
    const candidateId = typeof row.candidate_product_id === "string" ? row.candidate_product_id : null;
    const result = byId.get(String(row.id));
    const primary = result?.productGroups[0];
    if (!candidateId || !primary) continue;
    const candidate = await db.from("candidate_products").select("notes").eq("id", candidateId).eq("user_id", auth.user.id).maybeSingle();
    if (candidate.error) return Response.json({ error: candidate.error.message }, { status: 500 });
    const trace = (() => { try { return record(JSON.parse(candidate.data?.notes ?? "{}")); } catch { return {}; } })();
    if (record(trace.listing).status) continue;
    const synced = await db.from("candidate_products").update({ name: primary.sellingTitle, category: primary.categoryChild }).eq("id", candidateId).eq("user_id", auth.user.id);
    if (synced.error) return Response.json({ error: synced.error.message }, { status: 500 });
  }
  await db.from("ai_runs").insert({ id: analysisRunId, user_id: auth.user.id, type: "AI_PRODUCT_RECOGNITION_V1", model, input_json: { sourcing_run_id: parsed.data.runId, inputHash }, output_json: { results: allResults }, status: "success", latency_ms: Math.round(performance.now() - started), adopted: false });
  return Response.json({ ok: true, deduplicated: false, analyzedAt, results: allResults });
}
