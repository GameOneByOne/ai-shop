import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { readAiImageCache } from "@/lib/sourcing/ai-image-cache";

const requestSchema = z.object({ runId: z.string().uuid(), offerIds: z.array(z.string().uuid()).length(1).optional() });
const judgementSchema = z.object({
  offerId: z.string().uuid(),
  recommendation: z.enum(["RECOMMENDED", "USABLE", "CAUTIOUS", "NOT_RECOMMENDED"]), confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  dimensions: z.object({
    dropshipFit: z.enum(["优秀", "良好", "一般", "存在障碍", "不适配", "待确认"]),
    supplyStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
    fulfillmentStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
    qualityConfidence: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
    supplierStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
  }),
  directionKey: z.string().trim().min(2).max(80),
  advantages: z.array(z.string().trim().min(1)).max(8), risks: z.array(z.string().trim().min(1)).max(8),
  conflicts: z.array(z.string().trim().min(1)).max(8), missingEvidence: z.array(z.string().trim().min(1)).max(8),
  recommendationReason: z.string().trim().min(2), finalAdvice: z.string().trim().min(2),
});
const outputSchema = z.object({ results: z.array(judgementSchema).max(50) });
const PROMPT_VERSION = "offer-source-evaluation-v1";
type Judgement = z.infer<typeof judgementSchema>;

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

function diversifyRecommendations(results: Judgement[], rows: Row[]) {
  const rowById = new Map(rows.map((row) => [String(row.id), row]));
  const guarded = results.map((item) => {
    const row = rowById.get(item.offerId), rule = record(record(row?.raw_data).ruleSelection);
    if (rule.decision === "PENDING" && ["RECOMMENDED", "USABLE"].includes(item.recommendation)) {
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
    const qualityPass = qualityEligible(row), directionAvailable = !direction || !directions.has(direction), supplierAvailable = !supplier || (suppliers.get(supplier) ?? 0) < 2;
    if (qualityPass && directionAvailable && supplierAvailable && kept.size < 5) {
      kept.add(item.offerId);
      if (direction) directions.add(direction);
      if (supplier) suppliers.set(supplier, (suppliers.get(supplier) ?? 0) + 1);
    }
  }
  return guarded.map((item) => {
    if (item.recommendation !== "RECOMMENDED" || kept.has(item.offerId)) return item;
    const row = rowById.get(item.offerId) ?? {}, qualityPass = qualityEligible(row);
    const better = recommended.find((candidate) => kept.has(candidate.offerId) && diversityKey(candidate.directionKey) === diversityKey(item.directionKey));
    const reason = qualityPass ? `与更优候选${better ? ` ${better.offerId}` : ""}的功能、结构和场景同质，降为可用。` : "规则结果不是通过，不进入推荐位。";
    return { ...item, recommendation: qualityPass ? "USABLE" as const : "CAUTIOUS" as const, recommendationReason: reason, finalAdvice: `${reason}${item.finalAdvice}` };
  });
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "AI选款参数无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: run, error: runError } = await db.from("sourcing_runs").select("id,query,criteria").eq("id", parsed.data.runId).eq("user_id", auth.user.id).single();
  if (runError || !run) return Response.json({ error: "货源任务不存在" }, { status: 404 });
  const { data: rows, error } = await db.from("source_products").select("*").eq("sourcing_run_id", run.id).in("data_status", ["valid", "needs_review"]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const candidates = ((rows ?? []) as Row[]).filter((row) => {
    const raw = record(row.raw_data), selection = record(raw.sourcingSelection), ruleDecision = selection.ruleOverride === true ? "PASSED" : String(record(raw.ruleSelection).decision ?? ""), recognition = record(raw.productRecognition);
    return ruleDecision !== "REJECTED" && ["PASSED", "PENDING", "PRIMARY", "BACKUP"].includes(ruleDecision)
      && ["offer-product-recognition-v3-category-review", "offer-product-recognition-v4-single", "offer-combined-recognition-evaluation-v1", "offer-combined-recognition-evaluation-v2-selling-name", "offer-combined-recognition-evaluation-v3-standard-selling-title", "offer-combined-recognition-evaluation-v4-evidence-naming"].includes(String(recognition.promptVersion)) && Array.isArray(recognition.productGroups) && recognition.productGroups.length > 0
      && Array.isArray(recognition.unresolvedSkus) && recognition.unresolvedSkus.length === 0;
  }).filter((row) => !parsed.data.offerIds || parsed.data.offerIds.includes(String(row.id)));
  if (!candidates.length) return Response.json({ error: "没有同时满足规则未淘汰、商品识别完成且SKU关系明确的货源" }, { status: 409 });
  const offers = candidates.map(compactOffer);
  const inputHash = createHash("sha256").update(JSON.stringify({ promptVersion: PROMPT_VERSION, offers: offers.map(({ cachedImageData, ...offer }) => ({ ...offer, hasPreparedImage: Boolean(cachedImageData) })) })).digest("hex");
  const criteria = record(run.criteria), previous = record(criteria.offerAiSelection);
  if (previous.status === "COMPLETED" && previous.inputHash === inputHash)
    return Response.json({ ok: true, deduplicated: true, analyzedAt: previous.analyzedAt, results: previous.results ?? [] });
  const savedResults = candidates.map((row) => record(record(row.raw_data).aiSelection));
  if (savedResults.length === candidates.length && savedResults.every((item) => item.inputHash === inputHash))
    return Response.json({ ok: true, deduplicated: true, analyzedAt: savedResults[0]?.analyzedAt, results: savedResults });

  const apiKey = process.env.OPENAI_API_KEY || process.env.VISION_API_KEY;
  const model = process.env.OPENAI_MODEL || process.env.VISION_MODEL;
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.VISION_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!apiKey || !model) return Response.json({ error: "缺少AI选款模型配置" }, { status: 500 });
  const instruction = `你是货源综合评估员，只解释确定性规则无法解决的证据组合，不得重新执行固定阈值淘汰，不得覆盖规则结果，不得设置主货源、备用货源或人工淘汰，也不得输出综合数字分。你不会收到SKU级价格或库存，不得猜测具体SKU供货情况。综合五维：单件代发适配；供货稳定性（仅依据近期代发量等输入中的Offer级证据，证据不足必须标记待确认）；履约稳定性（48H>24H>代发品质>代发量>留货率>预计送达，48H稳定而24H一般应解释为履约稳定但不是快速发货型）；商品质量可信度（评分、评价样本、好评率、复购与品质联合判断，好评人数不独立加分）；长期商家稳定性（实际履约品质>经营年限>回头率>商家标签）。冲突放入conflicts，缺失放入missingEvidence。规则PENDING最高只能CAUTIOUS。directionKey严格按“功能品类+核心结构+使用场景”；仅颜色、尺寸、花纹、营销词或供应商不同算同质。recommendation只能RECOMMENDED、USABLE、CAUTIOUS、NOT_RECOMMENDED。输出JSON：{"results":[{"offerId":"uuid","recommendation":"RECOMMENDED|USABLE|CAUTIOUS|NOT_RECOMMENDED","confidence":"HIGH|MEDIUM|LOW","dimensions":{"dropshipFit":"优秀|良好|一般|存在障碍|不适配|待确认","supplyStability":"优秀|良好|一般|风险|待确认","fulfillmentStability":"优秀|良好|一般|风险|待确认","qualityConfidence":"优秀|良好|一般|风险|待确认","supplierStability":"优秀|良好|一般|风险|待确认"},"directionKey":"功能+结构+场景","advantages":[],"risks":[],"conflicts":[],"missingEvidence":[],"recommendationReason":"理由","finalAdvice":"建议"}]}。每个offerId恰好一次。任务=${String(run.query ?? "")}`;
  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: instruction }];
  for (const offer of offers) {
    const { cachedImageData, ...facts } = offer;
    userContent.push({ type: "text", text: `Offer结构化事实：${JSON.stringify(facts)}` });
    if (cachedImageData) userContent.push({ type: "image_url", image_url: { url: cachedImageData, detail: "low" } });
  }
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: "关闭深度思考。只输出简短合法JSON，逐条覆盖全部Offer，每个文字结论限20字。" }, { role: "user", content: userContent }], response_format: { type: "json_object" }, max_tokens: 1400, stream: false, thinking: { type: "disabled" } }), signal: AbortSignal.timeout(45_000) });
  const body = await response.json() as { model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
  if (!response.ok) return Response.json({ error: body.error?.message ?? `AI选款请求失败 (${response.status})` }, { status: 502 });
  let value: unknown;
  try { value = JSON.parse(body.choices?.[0]?.message?.content ?? ""); } catch { return Response.json({ error: "AI选款未返回合法JSON" }, { status: 502 }); }
  const output = outputSchema.safeParse(value);
  if (!output.success) return Response.json({ error: "AI选款结果格式不完整", details: output.error.flatten() }, { status: 502 });
  const expected = new Set(candidates.map((row) => String(row.id))), diversifiedResults = diversifyRecommendations(output.data.results, candidates), byId = new Map(diversifiedResults.filter((item) => expected.has(item.offerId)).map((item) => [item.offerId, item]));
  if (byId.size !== expected.size) return Response.json({ error: `AI选款仅返回 ${byId.size}/${expected.size} 个商品，请重试` }, { status: 502 });
  const analyzedAt = new Date().toISOString(), analysisRunId = randomUUID();
  const finalOutput = { results: diversifiedResults };
  const { error: aiRunError } = await db.from("ai_runs").insert({ id: analysisRunId, user_id: auth.user.id, type: "AI_OFFER_SELECTION_V2", model: body.model ?? model, input_json: { sourcing_run_id: run.id, inputHash, offers }, output_json: finalOutput, status: "success", latency_ms: Math.round(performance.now() - started), input_tokens: body.usage?.prompt_tokens, output_tokens: body.usage?.completion_tokens, adopted: false });
  if (aiRunError) return Response.json({ error: aiRunError.message }, { status: 500 });
  const { data: freshRows, error: freshError } = await db.from("source_products").select("id,raw_data").eq("sourcing_run_id", run.id).in("id", [...expected]);
  if (freshError) return Response.json({ error: freshError.message }, { status: 500 });
  const updates = await Promise.all((freshRows ?? []).map((row) => db.from("source_products").update({ raw_data: { ...record(row.raw_data), aiSelection: { ...byId.get(row.id), analyzedAt, model: body.model ?? model, promptVersion: PROMPT_VERSION, analysisRunId, inputHash } } }).eq("id", row.id)));
  const updateFailure = updates.find((result) => result.error)?.error;
  if (updateFailure) return Response.json({ error: updateFailure.message }, { status: 500 });
  const nextCriteria = { ...criteria, offerAiSelection: { status: "COMPLETED", promptVersion: PROMPT_VERSION, inputHash, analyzedAt, analysisRunId, model: body.model ?? model, results: diversifiedResults } };
  const { error: criteriaError } = await db.from("sourcing_runs").update({ criteria: nextCriteria }).eq("id", run.id).eq("user_id", auth.user.id);
  if (criteriaError) return Response.json({ error: criteriaError.message }, { status: 500 });
  return Response.json({ ok: true, deduplicated: false, analyzedAt, results: diversifiedResults });
}
