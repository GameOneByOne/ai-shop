import { z } from "zod";
import type {
  SourcingV3Graph,
  V3ProductModel,
  V3SourceSku,
  V3Variant,
} from "@/lib/sourcing/v3";

const clusterSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        description: z.string().min(4).max(500),
        sourceSkuIds: z.array(z.string().min(3)).min(1),
      }),
    )
    .min(1),
  skuAttributes: z.array(
    z.object({
      sourceSkuId: z.string().min(3),
      specifications: z.array(
        z.object({
          name: z.string().min(1).max(40),
          value: z.string().min(1).max(120),
          basis: z.enum(["商品名", "SourceSKU", "图片"]),
        }),
      ),
      color: z.string().nullable().optional(),
      size: z.string().nullable().optional(),
      dimensions: z.object({
        length_cm: z.number().positive().optional(),
        diameter_cm: z.number().positive().optional(),
        width_cm: z.number().positive().optional(),
        height_cm: z.number().positive().optional(),
        thickness_cm: z.number().positive().optional(),
      }),
    }),
  ),
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
  rows: Record<string, unknown>[],
) {
  const apiKey = process.env.VISION_API_KEY;
  const model = process.env.VISION_MODEL;
  if (!apiKey) throw new Error("缺少 VISION_API_KEY");
  if (!model) throw new Error("缺少 VISION_MODEL");
  const baseUrl = (
    process.env.VISION_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"
  ).replace(/\/$/, "");
  const titleByOfferId = new Map(
    rows.map((row) => [String(row.id), productNameFromTitle(String(row.title ?? ""))]),
  );
  const groupedByImage = new Map<string, V3SourceSku[]>();
  const withoutImage: V3SourceSku[] = [];
  for (const sku of graph.sourceSkus) {
    if (!sku.image) {
      withoutImage.push(sku);
      continue;
    }
    groupedByImage.set(sku.image, [
      ...(groupedByImage.get(sku.image) ?? []),
      sku,
    ]);
  }
  const itemText = (sku: V3SourceSku) =>
    `sourceSkuId: ${sku.id}\n商品名: ${titleByOfferId.get(sku.offerId) || "商品名待核实"}\nSourceSKU: ${sku.rawName}`;
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: '只能从下面提供的商品名、SourceSKU和图片中提取直接可见或明确写出的事实，禁止补充常识、推测、联想、改写成营销卖点或虚构任何信息。基于这些材料聚类商品款型。规格依据的优先级为SourceSKU文字、商品名文字、图片：文字中已明确写出的规格必须采用文字值；图片只补充文字未表达的规格；图片与文字冲突时必须采用文字值并标记对应文字来源。款型总体描述只能汇总材料中已确认的共同事实。每条商品规格必须标明依据来自“商品名”“SourceSKU”或“图片”；无法直接确认的规格必须省略。只输出JSON：{"models":[{"name":"款型名称","description":"仅含已确认事实的款型总体描述","sourceSkuIds":["sourceSkuId"]}],"skuAttributes":[{"sourceSkuId":"sourceSkuId","specifications":[{"name":"规格名","value":"规格值","basis":"SourceSKU"}],"color":null,"size":null,"dimensions":{}}]}。dimensions可包含length_cm、diameter_cm、width_cm、height_cm、thickness_cm；无法确认的字段不要输出。',
    },
  ];
  for (const [image, skus] of groupedByImage) {
    content.push({ type: "text", text: skus.map(itemText).join("\n\n") });
    content.push({
      type: "image_url",
      image_url: { url: image, detail: "low" },
    });
  }
  if (withoutImage.length) {
    content.push({
      type: "text",
      text: withoutImage.map(itemText).join("\n\n"),
    });
  }
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8000,
    }),
    signal: AbortSignal.timeout(600_000),
  });
  const payload = (await response.json()) as ChatResponse;
  if (!response.ok)
    throw new Error(
      payload.error?.message || `多模态模型请求失败 (${response.status})`,
    );
  const responseContent = payload.choices?.[0]?.message?.content;
  if (!responseContent) throw new Error("多模态模型未返回聚类内容");
  let json: unknown;
  try {
    json = JSON.parse(responseContent);
  } catch {
    throw new Error("多模态聚类结果不是合法 JSON");
  }
  const parsed = clusterSchema.safeParse(json);
  if (!parsed.success)
    throw new Error(
      `多模态聚类结果校验失败：${parsed.error.issues[0]?.message ?? "未知错误"}`,
    );
  return {
    data: parsed.data,
    model: payload.model || model,
    latencyMs: Math.round(performance.now() - started),
    usage: {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
    },
    prompt: content.filter((item) => item.type === "text").map((item) => item.text).join("\n\n"),
  };
}

function productNameFromTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const commercialInfo =
    /\s*(?:[|｜]\s*)?(?:[¥￥]\s*\d|限时价|新人价|近\s*\d+\s*天|全网\s*\d|\d+\+件|退货包运费|先采后付|回头率\s*\d|商品复购率|下单返)/;
  return normalized.split(commercialInfo, 1)[0]?.trim() || normalized;
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
    specifications: sku.rawProperties.aiSpecifications,
  });

export function applyAiClusters(
  ruleGraph: SourcingV3Graph,
  ai: AiModelClusters,
): SourcingV3Graph {
  const attributes = new Map(
    ai.skuAttributes.map((attribute) => [attribute.sourceSkuId, attribute]),
  );
  const sourceSkus = ruleGraph.sourceSkus.map((sku) => {
    const attribute = attributes.get(sku.id);
    if (!attribute) return sku;
    const dimensions = Object.keys(attribute.dimensions).length
      ? { schemaId: ruleGraph.schema.id, ...attribute.dimensions }
      : sku.normalizedDimensions;
    return {
      ...sku,
      color: attribute.color ?? null,
      rawColor: attribute.color ?? null,
      rawSize: attribute.size ?? null,
      rawProperties: {
        ...sku.rawProperties,
        aiSpecifications: attribute.specifications,
      },
      feature: attribute.specifications.map(
        (specification) =>
          `${specification.name}：${specification.value}（依据：${specification.basis}）`,
      ),
      normalizedDimensions: dimensions,
      dimensionStatus:
        Object.keys(attribute.dimensions).length > 0
          ? ("KNOWN" as const)
          : attribute.size
            ? ("PARTIAL" as const)
            : ("UNKNOWN" as const),
      evidence: ["多模态模型从商品名、SourceSKU 与图片解析颜色和规格尺寸"],
    };
  });
  const byId = new Map(sourceSkus.map((sku) => [sku.id, sku]));
  const assigned = new Set<string>();
  const models: V3ProductModel[] = [];
  const variants: V3Variant[] = [];

  for (const cluster of ai.models) {
    const skus = cluster.sourceSkuIds
      .filter((id) => !assigned.has(id))
      .map((id) => byId.get(id))
      .filter((sku): sku is V3SourceSku => Boolean(sku));
    if (!skus.length) continue;
    skus.forEach((sku) => assigned.add(sku.id));
    const modelId = `model:ai:${stableKey(
      `${cluster.name}:${skus
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
          structure: cluster.name,
          color: sample.color,
          dimensions: sample.normalizedDimensions,
          material: sample.material,
          specifications: sample.rawProperties.aiSpecifications ?? [],
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
          confidence: sku.confidence,
          evidence: ["由商品名、SourceSKU 与商品图片完成多模态聚类"],
        })),
      });
    }
    models.push({
      id: modelId,
      name: cluster.name,
      productFamily: ruleGraph.schema.productFamily,
      structure: cluster.name,
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
      definition: cluster.description,
      evidence: ["多模态图片聚类"],
    });
  }
  if (!models.length) throw new Error("多模态模型没有返回可采用的有效款型");
  const unassigned = sourceSkus
    .filter((sku) => !assigned.has(sku.id))
    .map((sku) => sku.id);
  return {
    ...ruleGraph,
    sourceSkus,
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
