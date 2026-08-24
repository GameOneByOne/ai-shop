import { z } from "zod";

export const taobaoDraftSnapshotSchema = z.object({
  itemId: z.string().regex(/^\d{8,}$/),
  url: z.string().url(),
  category: z.string().default(""),
  title: z.string().default(""),
  guideTitle: z.string().default(""),
  attributes: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  skus: z.array(z.object({ name: z.string(), price: z.string(), stock: z.string(), merchantCode: z.string() })).default([]),
  imageUrls: z.array(z.string().url()).max(40).default([]),
  pageText: z.string().max(30000).default(""),
});

export const taobaoDraftEnhancementSchema = z.object({
  audit: z.array(z.object({ field: z.string(), status: z.enum(["PASS", "WARN", "BLOCK"]), detail: z.string() })),
  editable: z.object({
    title: z.string().min(1).max(30),
    guideTitle: z.string().max(30),
    sellingPoints: z.array(z.string().min(1).max(40)).length(5),
    shortDescription: z.string().min(1).max(160),
    detailSections: z.array(z.object({ heading: z.string().max(20), body: z.string().max(500), evidence: z.array(z.string()) })).min(3).max(10),
  }),
  corrections: z.array(z.object({ field: z.enum(["CATEGORY", "ATTRIBUTE", "SKU_NAME"]), current: z.string(), suggested: z.string(), evidence: z.string(), confidence: z.number().min(0).max(1) })),
  mediaPlan: z.object({
    keepImageUrls: z.array(z.string().url()).max(10),
    missingAssets: z.array(z.object({ type: z.enum(["SQUARE_MAIN", "VERTICAL_MAIN", "WHITE_BACKGROUND", "DETAIL", "VIDEO"]), brief: z.string(), requiredFacts: z.array(z.string()) })),
  }),
  skuMappings: z.array(z.object({
    draftSkuIndex: z.number().int().min(0),
    draftSkuName: z.string(),
    sourceSkuId: z.string(),
    matchBasis: z.enum(["IMAGE", "ATTRIBUTE", "NAME", "SINGLE_SKU"]),
  })).default([]),
  skuUpdates: z.array(z.object({
    draftSkuIndex: z.number().int().min(0),
    draftSkuName: z.string(),
    sourceSkuId: z.string(),
    matchBasis: z.enum(["IMAGE", "ATTRIBUTE", "NAME", "SINGLE_SKU"]),
    price: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
    stock: z.number().int().min(0).max(999),
  })).default([]),
  lockedFields: z.object({ category: z.literal(true), skuStructure: z.literal(true), price: z.literal(false), stock: z.literal(false), logistics: z.literal(true) }),
  readyForAutofill: z.boolean(),
  factGaps: z.array(z.string()),
});

export type TaobaoDraftSnapshot = z.infer<typeof taobaoDraftSnapshotSchema>;

export function listingStockValue(sourceSkuId: string, stock: number) {
  if (stock <= 100) return Math.max(0, Math.floor(stock));
  let hash = 2166136261;
  for (const char of sourceSkuId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 100 + ((hash >>> 0) % 900);
}

type ChatResponse = { model?: string; choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };

export async function enhanceTaobaoDraft(rawSnapshot: unknown, sourceContext: Record<string, unknown>) {
  const snapshot = taobaoDraftSnapshotSchema.parse(rawSnapshot);
  const apiKey = process.env.VISION_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.VISION_MODEL || process.env.OPENAI_MODEL;
  if (!apiKey || !model) throw new Error("缺少可用的多模态模型配置");
  const baseUrl = (process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const instruction = [
    "你是淘宝上架质检与内容增强助手，不是从零生成发布器。以 TAOBAO_DRAFT 为最高优先级事实源，SOURCE_CONTEXT 只用于补充证据。",
    "类目、SKU结构和物流锁定，不得重建、增删SKU或创建类目不允许的销售属性。价格和库存允许受控更新，但你只负责将淘宝已有SKU映射到SOURCE_CONTEXT.sourceSkus，不得自行生成价格或库存。",
    "skuMappings必须以draftSkuIndex逐条对应TAOBAO_DRAFT.skus；根据SKU图片、已有属性和规格名称匹配sourceSkuId，证据优先级为图片与属性相互验证、属性、名称。无法可靠匹配的SKU不要输出映射。单一淘宝SKU和单一SourceSKU可使用SINGLE_SKU。",
    "允许直接回填的字段只有标题、导购标题和内容文案。标题保留商品核心词并符合淘宝搜索表达，不得增加无证据品牌、材质、尺寸、功效、认证或适用承诺。",
    "图片只可从草稿已有URL中选择；缺图只输出制作brief，不得声称图片已生成。每项内容必须能追溯到输入证据。",
    "lockedFields必须固定为category=true、skuStructure=true、price=false、stock=false、logistics=true。skuUpdates由服务端生成，你必须输出空数组。只输出合法 JSON。",
    '输出结构必须为：{"audit":[{"field":"string","status":"PASS|WARN|BLOCK","detail":"string"}],"editable":{"title":"string","guideTitle":"string","sellingPoints":["恰好5项"],"shortDescription":"string","detailSections":[{"heading":"string","body":"string","evidence":["string"]}]},"corrections":[{"field":"CATEGORY|ATTRIBUTE|SKU_NAME","current":"string","suggested":"string","evidence":"string","confidence":0.8}],"mediaPlan":{"keepImageUrls":[],"missingAssets":[{"type":"SQUARE_MAIN|VERTICAL_MAIN|WHITE_BACKGROUND|DETAIL|VIDEO","brief":"string","requiredFacts":["string"]}]},"skuMappings":[{"draftSkuIndex":0,"draftSkuName":"string","sourceSkuId":"string","matchBasis":"IMAGE|ATTRIBUTE|NAME|SINGLE_SKU"}],"skuUpdates":[],"lockedFields":{"category":true,"skuStructure":true,"price":false,"stock":false,"logistics":true},"readyForAutofill":true,"factGaps":[]}',
  ].join("\n");
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }> = [
    { type: "text", text: `${instruction}\nTAOBAO_DRAFT=${JSON.stringify(snapshot)}\nSOURCE_CONTEXT=${JSON.stringify(sourceContext)}` },
  ];
  const sourceSkus = Array.isArray(sourceContext.sourceSkus) ? sourceContext.sourceSkus.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  let imageCount = 0;
  for (const url of snapshot.imageUrls.slice(0, 10)) {
    content.push({ type: "text", text: `TAOBAO_DRAFT_IMAGE ${imageCount + 1}` });
    content.push({ type: "image_url", image_url: { url, detail: "low" } });
    imageCount += 1;
  }
  for (const sku of sourceSkus) {
    if (imageCount >= 20 || typeof sku.imageUrl !== "string") continue;
    content.push({ type: "text", text: `SOURCE_SKU_IMAGE sourceSkuId=${String(sku.sourceSkuId)} name=${String(sku.name ?? "")}` });
    content.push({ type: "image_url", image_url: { url: sku.imageUrl, detail: "low" } });
    imageCount += 1;
  }
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "user", content }], response_format: { type: "json_object" }, max_tokens: 7000 }), signal: AbortSignal.timeout(300_000) });
  const payload = await response.json() as ChatResponse;
  if (!response.ok) throw new Error(payload.error?.message || `AI增强失败 (${response.status})`);
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("AI未返回增强结果");
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("AI增强结果不是合法JSON"); }
  const parsed = taobaoDraftEnhancementSchema.safeParse(json);
  if (!parsed.success) throw new Error(`AI增强结果校验失败：${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const allowed = new Set(snapshot.imageUrls);
  if (parsed.data.mediaPlan.keepImageUrls.some((url) => !allowed.has(url))) throw new Error("AI引用了淘宝草稿中不存在的图片");
  const sourceSkuById = new Map(sourceSkus.map((sku) => [String(sku.sourceSkuId), sku]));
  const skuUpdates = parsed.data.skuMappings.flatMap((mapping) => {
    const sourceSku = sourceSkuById.get(mapping.sourceSkuId);
    const price = Number(sourceSku?.price), stock = Number(sourceSku?.stock);
    if (!sourceSku || !Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || stock < 0 || mapping.draftSkuIndex >= snapshot.skus.length) return [];
    return [{ ...mapping, draftSkuName: snapshot.skus[mapping.draftSkuIndex]?.name || mapping.draftSkuName, price: price.toFixed(2), stock: listingStockValue(mapping.sourceSkuId, stock) }];
  });
  return { data: { ...parsed.data, skuUpdates }, snapshot, model: payload.model || model };
}
