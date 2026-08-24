import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { readAiImageCache } from "@/lib/sourcing/ai-image-cache";
import { sourcingCategoryTree, sourcingModelOutputSchema, sourcingSelectionInputSchema, type SourcingOfferJudgement } from "@/lib/ai/sourcing-selection-contract";

export const maxDuration = 300;
const PROMPT_VERSION = "offer-source-evaluation-v6-structured-recognition-evaluation";
type Judgement = SourcingOfferJudgement;

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};

function compactOffer(row: Row) {
  const raw = record(row.raw_data), detail = record(raw.detailEnrichment), facts = record(raw.offerFacts), pricing = record(detail.pricingContext), productRecognition = record(raw.productRecognition);
  const mainImages = Array.isArray(detail.mainImages) ? detail.mainImages : [], mainImage = typeof mainImages[0] === "string" ? mainImages[0] : typeof row.image_url === "string" ? row.image_url : null;
  return {
    offerId: String(row.id),
    cachedImageData: readAiImageCache(raw.aiImageCache, mainImage)?.dataUrl ?? null,
    title: row.title,
    productRecognition: Object.keys(productRecognition).length ? productRecognition : null,
    productStructuredInfo: record(detail.productAttributes),
    supply: {
      priceMin: row.price_min,
      priceMax: row.price_max,
      priceDisplay: facts.offerPriceDisplay ?? null,
      moq: row.minimum_order_quantity,
      shippingFee: pricing.shippingQuote ?? pricing.shippingFee ?? null,
    },
    dropshipping: {
      onePiece: row.one_piece_delivery,
      encrypted: row.blind_shipping,
      onePiecePrice: facts.onePiecePrice ?? null,
      platforms: facts.dropshipPlatforms ?? null,
      volume7Days: facts.dropship7DayVolumeDisplay ?? facts.dropship7DayVolume ?? null,
      volume30Days: facts.dropship30DayVolumeDisplay ?? facts.dropship30DayVolume ?? null,
      qualityRate: facts.dropshipQualityRate ?? null,
      pickup24Rate: facts.pickup24Rate ?? null,
      pickup48Rate: facts.pickup48Rate ?? null,
    },
    fulfillment: {
      origin: facts.shippingOrigin ?? null,
      estimatedDelivery: facts.estimatedDelivery ?? null,
      returnShipping: row.return_shipping,
      noReasonReturn: row.no_reason_return,
      qualityCompensation: facts.qualityCompensation ?? null,
      lateDeliveryCompensation: facts.lateDeliveryCompensation ?? null,
    },
    supplier: {
      name: row.supplier_name,
      merchantType: facts.merchantType ?? null,
      merchantLevel: facts.merchantLevel ?? null,
      shopAge: row.shop_age,
      repurchaseRate: row.repurchase_rate,
      qualityRate: row.quality_rate,
      pickup48Rate: facts.shopPickup48Rate ?? null,
    },
    performance: {
      rating: facts.productRating ?? null,
      reviewCount: facts.totalReviewCountDisplay ?? facts.totalReviewCount ?? null,
      positiveReviewRate: facts.positiveReviewRate ?? null,
      sales: facts.salesDisplay ?? row.sales_count ?? null,
      productRepurchaseRate: facts.productRepurchaseRate ?? null,
    },
  };
}

function diversityKey(value: string) {
  return value.toLowerCase().replace(/(?:高颜值|网红|爆款|新款|创意|可爱|简约|豪华|升级款|厂家直销|一件代发)/g, "").replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 40);
}

function qualityEligible(row: Row) {
  const raw = record(row.raw_data), selection = record(raw.sourcingSelection);
  const ruleDecision = selection.ruleOverride === true ? "PASSED" : String(record(raw.ruleSelection).decision ?? "");
  return ["PASSED", "PRIMARY", "BACKUP"].includes(ruleDecision);
}

function fallbackDimensions(row?: Row): SourcingOfferJudgement["dimensions"] {
  const raw = record(row?.raw_data), facts = record(raw.offerFacts);
  const pickup48 = Number(facts.pickup48Rate ?? row?.delivery_rate), quality = Number(facts.dropshipQualityRate ?? row?.quality_rate), reviews = Number(facts.totalReviewCount), positive = Number(facts.positiveReviewRate), shopAge = Number(row?.shop_age), repurchase = Number(row?.repurchase_rate), volume30 = Number(facts.dropship30DayVolume), skuAvailability = Number(facts.skuAvailabilityRate);
  const known = (value: number) => Number.isFinite(value);
  return {
    dropshipFit: row?.one_piece_delivery === true ? "良好" : row?.one_piece_delivery === false ? "不适配" : "待确认",
    supplyStability: known(skuAvailability) ? skuAvailability >= 90 ? "良好" : skuAvailability >= 70 ? "一般" : "风险" : known(volume30) ? volume30 > 0 ? "一般" : "风险" : "待确认",
    fulfillmentStability: known(pickup48) ? pickup48 >= 95 ? "优秀" : pickup48 >= 80 ? "良好" : pickup48 >= 60 ? "一般" : "风险" : "待确认",
    qualityConfidence: known(quality) ? quality >= 95 ? "优秀" : quality >= 85 ? "良好" : quality >= 70 ? "一般" : "风险" : known(reviews) && known(positive) ? reviews >= 20 && positive >= 95 ? "良好" : positive >= 85 ? "一般" : "风险" : "待确认",
    supplierStability: known(shopAge) || known(repurchase) ? (shopAge >= 5 || repurchase >= 30) ? "良好" : (shopAge >= 2 || repurchase >= 15) ? "一般" : "风险" : "待确认",
  };
}

function normalizeModelJudgement(item: (typeof sourcingModelOutputSchema)["_output"]["results"][number], row?: Row): SourcingOfferJudgement {
  const recommendation = item.sourceEvaluation.recommendation === "recommended" ? "RECOMMENDED" : item.sourceEvaluation.recommendation === "rejected" ? "NOT_RECOMMENDED" : "CAUTIOUS";
  const confidence = item.productRecognition.productStructure === "uncertain" || item.sourceEvaluation.recommendation === "manual_review" ? "LOW" : item.sourceEvaluation.missingEvidence.length ? "MEDIUM" : "HIGH";
  const category = item.contentCategory.categoryChild ?? "未匹配固定分类";
  return {
    offerId: item.offerId,
    standardProductName: item.productRecognition.standardProductName,
    categoryParent: item.contentCategory.categoryParent,
    categoryChild: item.contentCategory.categoryChild,
    productStructure: item.productRecognition.productStructure,
    recognitionBasis: item.productRecognition.recognitionBasis,
    splitRequired: item.productRecognition.splitRequired,
    splitReason: item.productRecognition.splitReason,
    classificationBasis: item.contentCategory.classificationBasis,
    sourceRecommendation: item.sourceEvaluation.recommendation,
    recommendation,
    confidence,
    dimensions: item.sourceEvaluation.dimensions ?? fallbackDimensions(row),
    directionKey: `${category}+${item.productRecognition.productStructure}+供货`,
    advantages: item.sourceEvaluation.positiveEvidence,
    risks: item.sourceEvaluation.risks,
    conflicts: [],
    observations: item.sourceEvaluation.observations,
    missingEvidence: item.sourceEvaluation.missingEvidence,
    recommendationReason: item.sourceEvaluation.conclusion,
    finalAdvice: item.sourceEvaluation.conclusion,
  };
}

function normalizeCompatibleModelOutput(value: unknown) {
  const root = record(value);
  const rawResults = Array.isArray(root.results) ? root.results.map(record) : root.result ? [record(root.result)] : [];
  const strings = (input: unknown) => Array.isArray(input) ? input.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10) : [];
  const recommendation = (input: unknown) => {
    const normalized = String(input ?? "manual_review").toLowerCase();
    if (["recommended", "recommend", "推荐", "recommmended"].includes(normalized)) return "recommended";
    if (["conditional", "usable", "有条件", "可用"].includes(normalized)) return "conditional";
    if (["rejected", "not_recommended", "不推荐", "淘汰"].includes(normalized)) return "rejected";
    return "manual_review";
  };
  const parents = new Set(Object.keys(sourcingCategoryTree));
  return { results: rawResults.map((item) => {
    const recognition = record(item.productRecognition), category = record(item.contentCategory), evaluation = record(item.sourceEvaluation), dimensions = record(evaluation.dimensions ?? item.dimensions);
    const parentValue = category.categoryParent ?? item.categoryParent;
    const childValue = category.categoryChild ?? item.categoryChild;
    const parent = parents.has(String(parentValue)) ? String(parentValue) as keyof typeof sourcingCategoryTree : null;
    const child = parent && sourcingCategoryTree[parent].includes(String(childValue) as never) ? String(childValue) : null;
    const conclusion = String(evaluation.conclusion ?? item.recommendationReason ?? item.finalAdvice ?? "证据不足，建议人工复核").trim();
    const structure = String(recognition.productStructure ?? item.productStructure ?? "uncertain");
    return {
      offerId: item.offerId ?? item.offer_id,
      productRecognition: {
        productStructure: ["single_product", "multi_product", "integrated_product", "bundle", "uncertain"].includes(structure) ? structure : "uncertain",
        standardProductName: recognition.standardProductName ?? item.standardProductName ?? null,
        recognitionBasis: strings(recognition.recognitionBasis ?? item.recognitionBasis).length ? strings(recognition.recognitionBasis ?? item.recognitionBasis) : ["根据商品图片、标题与结构化事实综合识别"],
        splitRequired: recognition.splitRequired === true || item.splitRequired === true,
        splitReason: recognition.splitReason == null ? null : String(recognition.splitReason),
      },
      contentCategory: { categoryParent: parent, categoryChild: child, classificationBasis: String(category.classificationBasis ?? item.classificationBasis ?? "依据主体商品用途归入固定分类；无法确认时留空") },
      sourceEvaluation: {
        recommendation: recommendation(evaluation.recommendation ?? item.sourceRecommendation ?? item.recommendation),
        ...(Object.keys(dimensions).length ? { dimensions } : {}),
        positiveEvidence: strings(evaluation.positiveEvidence ?? item.advantages),
        risks: strings(evaluation.risks ?? item.risks),
        observations: strings(evaluation.observations ?? item.observations),
        missingEvidence: strings(evaluation.missingEvidence ?? item.missingEvidence),
        conclusion: conclusion.length >= 2 ? conclusion : "证据不足，建议人工复核",
      },
    };
  }) };
}

function diversifyRecommendations(results: Judgement[], rows: Row[], applyRules: boolean) {
  const rowById = new Map(rows.map((row) => [String(row.id), row]));
  const guarded = results.map((item) => {
    const row = rowById.get(item.offerId), rule = record(record(row?.raw_data).ruleSelection);
    if (applyRules && rule.decision === "PENDING" && ["RECOMMENDED", "USABLE"].includes(item.recommendation)) {
      const missing = Array.isArray(rule.missingFields) ? rule.missingFields.map(String) : [];
      return { ...item, recommendation: "CAUTIOUS" as const, recommendationReason: `规则初筛待补数据，最高只能谨慎：${missing.join("、") || "关键证据不完整"}。${item.recommendationReason}` };
    }
    return item;
  });
  const recommended = guarded.filter((item) => item.recommendation === "RECOMMENDED").sort((a, b) => {
    const rowA = rowById.get(a.offerId) ?? {}, rowB = rowById.get(b.offerId) ?? {};
    return Number(rowB.rough_score ?? 0) - Number(rowA.rough_score ?? 0);
  });
  const kept = new Set<string>(), directions = new Set<string>(), suppliers = new Map<string, number>();
  for (const item of recommended) {
    const row = rowById.get(item.offerId) ?? {}, supplier = String(row.supplier_name ?? "").trim(), direction = diversityKey(item.directionKey);
    const qualityPass = !applyRules || qualityEligible(row), directionAvailable = !direction || !directions.has(direction), supplierAvailable = !supplier || (suppliers.get(supplier) ?? 0) < 2;
    if (qualityPass && directionAvailable && supplierAvailable && kept.size < 5) {
      kept.add(item.offerId);
      if (direction) directions.add(direction);
      if (supplier) suppliers.set(supplier, (suppliers.get(supplier) ?? 0) + 1);
    }
  }
  return guarded.map((item) => {
    if (item.recommendation !== "RECOMMENDED" || kept.has(item.offerId)) return item;
    const row = rowById.get(item.offerId) ?? {}, qualityPass = !applyRules || qualityEligible(row);
    const better = recommended.find((candidate) => kept.has(candidate.offerId) && diversityKey(candidate.directionKey) === diversityKey(item.directionKey));
    const reason = qualityPass ? `与更优候选${better ? ` ${better.offerId}` : ""}的功能、结构和场景同质，降为可用。` : "规则结果不是通过，不进入推荐位。";
    return { ...item, recommendation: qualityPass ? "USABLE" as const : "CAUTIOUS" as const, recommendationReason: reason, finalAdvice: `${reason}${item.finalAdvice}` };
  });
}

export async function POST(request: Request) {
  const parsed = sourcingSelectionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "AI选款参数无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: run, error: runError } = await db.from("sourcing_runs").select("id,query,criteria").eq("id", parsed.data.runId).eq("user_id", auth.user.id).single();
  if (runError || !run) return Response.json({ error: "货源任务不存在" }, { status: 404 });
  const { data: rows, error } = await db.from("source_products").select("*").eq("sourcing_run_id", run.id).in("data_status", ["valid", "needs_review"]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const sourceRows = (rows ?? []) as Row[];
  const requestedIds = parsed.data.offerIds ? new Set(parsed.data.offerIds) : null;
  const candidates = sourceRows.filter((row) => {
    const raw = record(row.raw_data), selection = record(raw.sourcingSelection);
    if (selection.status === "REJECTED") return false;
    if (requestedIds && !requestedIds.has(String(row.id))) return false;
    if (!parsed.data.applyRules) return true;
    return selection.ruleOverride === true || String(record(raw.ruleSelection).decision ?? "") === "PASSED";
  });
  if (!candidates.length) return Response.json({ error: parsed.data.applyRules ? "该货源未通过规则，已记录规则结果并跳过AI评估" : "当前没有可评估的候选货源" }, { status: 409 });
  const offers = candidates.map(compactOffer);
  const inputHash = createHash("sha256").update(JSON.stringify({ promptVersion: PROMPT_VERSION, offers: offers.map(({ cachedImageData, ...offer }) => ({ ...offer, hasPreparedImage: Boolean(cachedImageData) })) })).digest("hex");
  const criteria = record(run.criteria), previous = record(criteria.offerAiSelection);
  if (!parsed.data.force && !parsed.data.offerIds && previous.status === "COMPLETED" && previous.inputHash === inputHash)
    return Response.json({ ok: true, deduplicated: true, analyzedAt: previous.analyzedAt, results: previous.results ?? [] });
  const savedResults = candidates.map((row) => record(record(row.raw_data).aiSelection));
  if (!parsed.data.force && savedResults.length === candidates.length && savedResults.every((item) => item.inputHash === inputHash))
    return Response.json({ ok: true, deduplicated: true, analyzedAt: savedResults[0]?.analyzedAt, results: savedResults });

  const apiKey = process.env.OPENAI_API_KEY || process.env.VISION_API_KEY;
  const model = process.env.OPENAI_MODEL || process.env.VISION_MODEL;
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.VISION_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!apiKey || !model) return Response.json({ error: "缺少AI选款模型配置" }, { status: 500 });
  const ruleModeInstruction = parsed.data.applyRules
    ? "本轮应用规则：不得覆盖规则结果；规则PENDING最高只能CAUTIOUS。"
    : "本轮不应用规则：历史规则结果仅作背景记录，不得据此跳过、降级或限制recommendation；请独立评估全部候选。";
  const instruction = `你是AI-shop第一阶段的商品识别、内容分类与货源评估模块。本阶段只输出标准商品名、商品内容分类和货源评估；禁止生成淘宝展示标题、搜索标题、卖点、详情文案与素材策划，这些全部留到内容管理阶段。搜索任务词只用于召回货源，不是标准答案，不得把货源与搜索词的差异写成质量、履约、供货风险，也不得因此降低recommendation。

【标准商品名】standardProductName用于商品聚合、后台识别和货源比较，不是售卖标题。先识别图片与结构化事实共同指向的实际主体商品，再命名为“必要视觉特征/造型 + 必要结构或材质特征 + 核心商品类型”，通常控制在4至18个汉字。核心商品类型必须明确，例如猫隧道、猫抓柱、饮水器、猫砂盆；不得只写宽泛类别。若同一物理主体同时承担两个独立核心功能，必须按真实结构命名为“功能A+功能B二合一”，例如食盆与自动饮水机构一体时命名“猫碗饮水器二合一”，不得把其中一个功能误判为偏差或配件。只有能够从主图、标题或结构化属性直接验证，且确实能区分不同商品形态时，才保留彩色、折叠、蘑菇造型、双柱立式、剑麻等特征。普通颜色、常规尺寸、数量、赠品、促销、厂家直销、一件代发、爆款、新款、供应商、平台词不得写入。不得照抄冗长货源标题，不得创造输入中没有的材质、功能或适用承诺。若标题与图片冲突，以主体图片和结构化属性交叉验证；无法确认的特征删除，不猜测。独立附赠配件不得冒充主体；真正一体化的双功能结构不得当作配件。相同形态跨供应商必须尽量同名，不同结构必须能从名称区分。合格示例：“彩色折叠猫隧道”“蘑菇造型剑麻猫抓柱”“双柱立式剑麻猫抓柱”“猫碗饮水器二合一”；不合格示例：“宠物用品”“猫咪爆款玩具”“厂家直销彩色大号猫抓柱”。

【商品内容分类】categoryParent和categoryChild必须严格选自固定分类树，不得新建分类：${JSON.stringify(sourcingCategoryTree)}。分类按实际主体用途选择，不按标题中的引流词选择；categoryChild必须属于所选categoryParent。标准商品名与分类必须语义一致。

【货源评估】只解释确定性规则无法解决的证据组合，不得设置主货源、备用货源或人工淘汰，不输出综合数字分，不猜测SKU价格库存。${ruleModeInstruction}商品识别、搜索词相关性和货源质量是不同维度，商品类型与搜索词不完全一致不能写成供货、履约或质量风险。履约证据优先级为48H揽收率高于24H揽收率；两者同时存在时必须结合判断，不得只引用较低的24H值。代发量没有同类基线或固定规则阈值时只能客观陈述，禁止用“仅、偏低、不足”等比较性措辞。输入中非null的经营年限、评价、回头率、品质率等字段视为已提供，禁止再次列入missingEvidence。综合五维：单件代发适配、供货稳定性、履约稳定性、商品质量可信度、长期商家稳定性。冲突写入conflicts，缺失证据写入missingEvidence。输出前必须逐项核对risks、missingEvidence与输入事实，删除相互矛盾的说法。directionKey严格使用“功能品类+核心结构+使用场景”，二合一商品可同时体现两个核心功能。

只输出合法JSON：{"results":[{"offerId":"uuid","productRecognition":{"productStructure":"single_product|multi_product|integrated_product|bundle|uncertain","standardProductName":"string|null","recognitionBasis":["string"],"splitRequired":false,"splitReason":null},"contentCategory":{"categoryParent":"string|null","categoryChild":"string|null","classificationBasis":"string"},"sourceEvaluation":{"recommendation":"recommended|conditional|rejected|manual_review","dimensions":{"dropshipFit":"优秀|良好|一般|存在障碍|不适配|待确认","supplyStability":"优秀|良好|一般|风险|待确认","fulfillmentStability":"优秀|良好|一般|风险|待确认","qualityConfidence":"优秀|良好|一般|风险|待确认","supplierStability":"优秀|良好|一般|风险|待确认"},"positiveEvidence":["string"],"risks":["string"],"observations":["string"],"missingEvidence":["string"],"conclusion":"string"}}]}。每个offerId恰好一次。任务=${String(run.query ?? "")}`;
  const started = performance.now();
  const batches = Array.from({ length: Math.ceil(offers.length / 4) }, (_, index) => offers.slice(index * 4, index * 4 + 4));
  const collectedResults: SourcingOfferJudgement[] = [];
  let actualModel = model, inputTokens = 0, outputTokens = 0;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const userContent: Array<Record<string, unknown>> = [{ type: "text", text: instruction }];
    for (const offer of batches[batchIndex]) {
      const { cachedImageData, ...facts } = offer;
      userContent.push({ type: "text", text: `Offer结构化事实：${JSON.stringify(facts)}` });
      if (cachedImageData) userContent.push({ type: "image_url", image_url: { url: cachedImageData, detail: "low" } });
    }
    let batchOutput: SourcingOfferJudgement[] | null = null;
    for (let attempt = 1; attempt <= 2 && !batchOutput; attempt += 1) {
      const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: "关闭深度思考。只输出简短合法JSON，不要Markdown代码块。逐条覆盖全部Offer，每个文字结论限20字。" }, { role: "user", content: userContent }], response_format: { type: "json_object" }, max_tokens: 2200, stream: false, thinking: { type: "disabled" } }), signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]) });
      const body = await response.json() as { model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
      if (!response.ok) {
        if (attempt === 2) return Response.json({ error: body.error?.message ?? `AI选款第 ${batchIndex + 1} 批失败 (${response.status})` }, { status: 502 });
        continue;
      }
      actualModel = body.model ?? actualModel;
      inputTokens += body.usage?.prompt_tokens ?? 0;
      outputTokens += body.usage?.completion_tokens ?? 0;
      const raw = body.choices?.[0]?.message?.content?.trim() ?? "";
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      let value: unknown;
      try { value = JSON.parse(cleaned); } catch {
        const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
        try { value = start >= 0 && end > start ? JSON.parse(cleaned.slice(start, end + 1)) : null; } catch { value = null; }
      }
      const parsedOutput = sourcingModelOutputSchema.safeParse(normalizeCompatibleModelOutput(value));
      if (parsedOutput.success) batchOutput = parsedOutput.data.results.map((item, index) => normalizeModelJudgement(item, candidates.find((row) => String(row.id) === item.offerId) ?? candidates.find((row) => String(row.id) === batches[batchIndex][index]?.offerId)));
      else if (attempt === 2) return Response.json({ error: `AI选款第 ${batchIndex + 1}/${batches.length} 批未返回完整合法JSON，请重试` }, { status: 502 });
    }
    if (batchOutput) collectedResults.push(...batchOutput);
  }
  const expectedIds = candidates.map((row) => String(row.id));
  // A one-offer request has only one possible identity. Some compatible
  // models copy the external Offer number or mutate the UUID even when the
  // judgement itself is valid; bind that sole result to the requested row.
  const identityBoundResults = expectedIds.length === 1 && collectedResults.length === 1
    ? [{ ...collectedResults[0], offerId: expectedIds[0] }]
    : collectedResults;
  const expected = new Set(expectedIds), diversifiedResults = diversifyRecommendations(identityBoundResults, candidates, parsed.data.applyRules), byId = new Map(diversifiedResults.filter((item) => expected.has(item.offerId)).map((item) => [item.offerId, item]));
  if (byId.size !== expected.size) return Response.json({ error: `AI选款仅返回 ${byId.size}/${expected.size} 个商品，请重试` }, { status: 502 });
  const analyzedAt = new Date().toISOString(), analysisRunId = randomUUID();
  const finalOutput = { results: diversifiedResults };
  const { error: aiRunError } = await db.from("ai_runs").insert({ id: analysisRunId, user_id: auth.user.id, type: "AI_OFFER_SELECTION_V2", model: actualModel, input_json: { sourcing_run_id: run.id, inputHash, offers }, output_json: finalOutput, status: "success", latency_ms: Math.round(performance.now() - started), input_tokens: inputTokens, output_tokens: outputTokens, adopted: false });
  if (aiRunError) return Response.json({ error: aiRunError.message }, { status: 500 });
  const { data: freshRows, error: freshError } = await db.from("source_products").select("id,raw_data").eq("sourcing_run_id", run.id).in("id", [...expected]);
  if (freshError) return Response.json({ error: freshError.message }, { status: 500 });
  const updates = await Promise.all((freshRows ?? []).map((row) => db.from("source_products").update({ raw_data: { ...record(row.raw_data), aiSelection: { ...byId.get(row.id), analyzedAt, model: actualModel, promptVersion: PROMPT_VERSION, analysisRunId, inputHash } } }).eq("id", row.id)));
  const updateFailure = updates.find((result) => result.error)?.error;
  if (updateFailure) return Response.json({ error: updateFailure.message }, { status: 500 });
  const accumulatedById = new Map<string, SourcingOfferJudgement>();
  for (const row of (rows ?? []) as Row[]) {
    const saved = record(record(row.raw_data).aiSelection);
    if (saved.promptVersion === PROMPT_VERSION && saved.recommendation && saved.offerId)
      accumulatedById.set(String(saved.offerId), saved as SourcingOfferJudgement);
  }
  for (const result of diversifiedResults) accumulatedById.set(result.offerId, result);
  const eligibleCount = ((rows ?? []) as Row[]).filter((row) => {
    const raw = record(row.raw_data), selection = record(raw.sourcingSelection), decision = selection.ruleOverride === true ? "PASSED" : String(record(raw.ruleSelection).decision ?? "");
    if (selection.status === "REJECTED") return false;
    return !parsed.data.applyRules || (decision !== "REJECTED" && ["PASSED", "PENDING", "PRIMARY", "BACKUP"].includes(decision));
  }).length;
  const accumulatedResults = [...accumulatedById.values()];
  const nextCriteria = { ...criteria, offerAiSelection: { status: accumulatedResults.length >= eligibleCount ? "COMPLETED" : "IN_PROGRESS", applyRules: parsed.data.applyRules, promptVersion: PROMPT_VERSION, inputHash, analyzedAt, analysisRunId, model: actualModel, completed: accumulatedResults.length, total: eligibleCount, results: accumulatedResults } };
  const { error: criteriaError } = await db.from("sourcing_runs").update({ criteria: nextCriteria }).eq("id", run.id).eq("user_id", auth.user.id);
  if (criteriaError) return Response.json({ error: criteriaError.message }, { status: 500 });
  return Response.json({ ok: true, deduplicated: false, analyzedAt, results: diversifiedResults });
}
