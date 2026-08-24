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
  lockedFields: z.object({ category: z.literal(true), skuStructure: z.literal(true), price: z.literal(true), stock: z.literal(true), logistics: z.literal(true) }),
  readyForAutofill: z.boolean(),
  factGaps: z.array(z.string()),
});

export type TaobaoDraftSnapshot = z.infer<typeof taobaoDraftSnapshotSchema>;

type ChatResponse = { model?: string; choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };

export async function enhanceTaobaoDraft(rawSnapshot: unknown, sourceContext: Record<string, unknown>) {
  const snapshot = taobaoDraftSnapshotSchema.parse(rawSnapshot);
  const apiKey = process.env.VISION_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.VISION_MODEL || process.env.OPENAI_MODEL;
  if (!apiKey || !model) throw new Error("缺少可用的多模态模型配置");
  const baseUrl = (process.env.VISION_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const instruction = [
    "你是淘宝上架质检与内容增强助手，不是从零生成发布器。以 TAOBAO_DRAFT 为最高优先级事实源，SOURCE_CONTEXT 只用于补充证据。",
    "类目、SKU结构、价格、库存、物流均锁定，绝对禁止直接重建、增删SKU或自由定价；发现问题只能写 corrections 或 audit。",
    "允许直接回填的字段只有标题、导购标题和内容文案。标题保留商品核心词并符合淘宝搜索表达，不得增加无证据品牌、材质、尺寸、功效、认证或适用承诺。",
    "图片只可从草稿已有URL中选择；缺图只输出制作brief，不得声称图片已生成。每项内容必须能追溯到输入证据。",
    "lockedFields 五项必须全部为 true。只输出合法 JSON。",
  ].join("\n");
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }> = [
    { type: "text", text: `${instruction}\nTAOBAO_DRAFT=${JSON.stringify(snapshot)}\nSOURCE_CONTEXT=${JSON.stringify(sourceContext)}` },
  ];
  for (const url of snapshot.imageUrls.slice(0, 12)) content.push({ type: "image_url", image_url: { url, detail: "low" } });
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
  return { data: parsed.data, snapshot, model: payload.model || model };
}
