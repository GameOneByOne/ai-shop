import { z } from "zod";
import type {
  SourcingV3Graph,
  V3ProductModel,
  V3SourceSku,
  V3Variant,
} from "@/lib/sourcing/v3";

const MODEL = "deepseek-v4-pro";
const clusterSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        structure: z.string().min(1).max(40),
        sourceSkuIds: z.array(z.string().min(3)).min(1),
        definition: z.string().min(4).max(300),
        evidence: z.array(z.string().min(2).max(160)).min(1).max(8),
        confidence: z.number().min(0).max(100),
      }),
    )
    .min(1),
});

interface ChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export type AiModelClusters = z.infer<typeof clusterSchema>;

export async function generateSourcingClusters(
  graph: SourcingV3Graph,
  taskName: string,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");
  const baseUrl = (
    process.env.OPENAI_BASE_URL || "https://api.deepseek.com"
  ).replace(/\/$/, "");
  const input = graph.sourceSkus.map((sku) => ({
    id: sku.id,
    name: sku.rawName,
    supplier: sku.supplierName,
    image: sku.image,
    rawProperties: sku.rawProperties,
    rawSize: sku.rawSize,
    rawColor: sku.rawColor,
    rawMaterial: sku.rawMaterial,
  }));
  const prompt = `任务：${taskName}\n请把采购 SKU 聚类为消费者能够理解的商品款型。款型按结构/用途区分，不得按颜色、尺寸、材质、供应商或价格拆款。配件、服务、包装不得归入主体商品。只能使用输入中的 sourceSkuId，不得虚构 SKU。每个 SKU 最多属于一个款型。输出 JSON：{"models":[{"name":"","structure":"","sourceSkuIds":[""],"definition":"","evidence":[""],"confidence":0}]}。输入=${JSON.stringify(input)}`;
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "你是电商商品结构归类器。只输出合法 JSON，所有结论必须来自提供的 SourceSKU 证据。",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8000,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await response.json()) as ChatResponse;
  if (!response.ok)
    throw new Error(
      payload.error?.message || `DeepSeek 请求失败 (${response.status})`,
    );
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 未返回聚类内容");
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new Error("DeepSeek 聚类结果不是合法 JSON");
  }
  const parsed = clusterSchema.safeParse(json);
  if (!parsed.success)
    throw new Error(
      `DeepSeek 聚类结果校验失败：${parsed.error.issues[0]?.message ?? "未知错误"}`,
    );
  const normalized = {
    models: parsed.data.models.map((model) => ({
      ...model,
      confidence:
        model.confidence > 0 && model.confidence <= 1
          ? Math.round(model.confidence * 100)
          : Math.round(model.confidence),
    })),
  };
  return {
    data: normalized,
    model: payload.model || MODEL,
    latencyMs: Math.round(performance.now() - started),
    usage: {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
    },
    prompt,
  };
}

const stableKey = (value: string) => {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
};

const variantSignature = (sku: V3SourceSku) =>
  JSON.stringify({
    color: sku.color,
    dimensions: sku.normalizedDimensions,
    material: sku.material,
  });

export function applyAiClusters(
  ruleGraph: SourcingV3Graph,
  ai: AiModelClusters,
): SourcingV3Graph {
  const byId = new Map(ruleGraph.sourceSkus.map((sku) => [sku.id, sku]));
  const assigned = new Set<string>();
  const models: V3ProductModel[] = [];
  const variants: V3Variant[] = [];

  for (const cluster of ai.models) {
    const skus = cluster.sourceSkuIds
      .filter((id) => !assigned.has(id))
      .map((id) => byId.get(id))
      .filter(
        (sku): sku is V3SourceSku =>
          Boolean(sku) && !["ACCESSORY", "IRRELEVANT"].includes(sku!.role),
      );
    if (!skus.length) continue;
    skus.forEach((sku) => assigned.add(sku.id));
    const modelId = `model:ai:${stableKey(
      `${cluster.structure}:${skus
        .map((sku) => sku.id)
        .sort()
        .join("|")}`,
    )}`;
    const groups = new Map<string, V3SourceSku[]>();
    for (const sku of skus) {
      const signature = variantSignature(sku);
      groups.set(signature, [...(groups.get(signature) ?? []), sku]);
    }
    const variantIds: string[] = [];
    for (const [signature, group] of groups) {
      const sample = group[0];
      const variantId = `variant:ai:${stableKey(`${modelId}:${signature}`)}`;
      variantIds.push(variantId);
      variants.push({
        id: variantId,
        modelId,
        name:
          [sample.color, sample.rawSize, sample.material]
            .filter(Boolean)
            .join(" / ") || "规格待确认",
        attributes: {
          structure: cluster.structure,
          color: sample.color,
          dimensions: sample.normalizedDimensions,
          material: sample.material,
        },
        dimensionStatus: sample.dimensionStatus,
        priceStatus: group.some((sku) => sku.price != null)
          ? "VARIANT_MATCHED"
          : "UNVERIFIED",
        strictComparableCount: group.filter(
          (sku) => sku.dimensionStatus !== "UNKNOWN",
        ).length,
        alternativeCount: group.filter(
          (sku) => sku.dimensionStatus === "UNKNOWN",
        ).length,
        matches: group.map((sku) => ({
          sourceSkuId: sku.id,
          status: sku.dimensionStatus === "UNKNOWN" ? "ALTERNATIVE" : "MATCH",
          sizeMatchStatus:
            sku.dimensionStatus === "UNKNOWN" ? "UNKNOWN" : "EXACT",
          confidence: Math.min(sku.confidence, cluster.confidence),
          evidence: [...sku.evidence, ...cluster.evidence],
        })),
      });
    }
    models.push({
      id: modelId,
      name: cluster.name,
      productFamily: ruleGraph.schema.productFamily,
      structure: cluster.structure,
      representativeImage: skus.find((sku) => sku.image)?.image ?? null,
      sourceSkuIds: skus.map((sku) => sku.id),
      supplierCount: new Set(skus.map((sku) => sku.supplierName)).size,
      sizeCompleteness: Math.round(
        (skus.filter((sku) => sku.dimensionStatus !== "UNKNOWN").length /
          skus.length) *
          100,
      ),
      variantIds,
      matchCount: variants
        .filter((variant) => variant.modelId === modelId)
        .reduce((sum, variant) => sum + variant.strictComparableCount, 0),
      pendingCount: skus.filter((sku) => sku.dimensionStatus === "UNKNOWN")
        .length,
      definition: cluster.definition,
      evidence: [
        ...cluster.evidence,
        `DeepSeek 聚类置信度 ${cluster.confidence}%`,
      ],
    });
  }
  if (!models.length) throw new Error("DeepSeek 没有返回可采用的有效款型");
  const unassigned = ruleGraph.sourceSkus
    .filter((sku) => !assigned.has(sku.id))
    .map((sku) => sku.id);
  return {
    ...ruleGraph,
    models: models.sort(
      (a, b) => b.sourceSkuIds.length - a.sourceSkuIds.length,
    ),
    variants,
    unidentifiedSourceSkuIds: unassigned,
    counts: {
      ...ruleGraph.counts,
      models: models.length,
      variants: variants.length,
      comparableSources: variants.reduce(
        (sum, variant) =>
          sum +
          (variant.strictComparableCount > 1
            ? variant.strictComparableCount
            : 0),
        0,
      ),
    },
  };
}
