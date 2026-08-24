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
  materialMasters: z.array(z.object({
    offerId: z.string().min(1),
    title: z.string().min(1).max(30),
    guideTitle: z.string().max(30),
    sellingPoints: z.array(z.string().min(1).max(40)).length(5),
    shortDescription: z.string().min(1).max(120),
    detailSections: z.array(z.object({ heading: z.string().min(1).max(20), body: z.string().min(1).max(500), evidence: z.array(z.string()) })).min(5).max(10),
    verifiedAttributes: z.array(z.object({ name: z.string().min(1), value: z.string().min(1), evidence: z.string().min(1) })),
    skuContent: z.array(z.object({ sourceSkuId: z.string().min(1), optimizedName: z.string().min(1).max(60), attributes: z.record(z.string(), z.string()), merchantCode: z.string().min(1).max(64) })),
    mediaPlan: z.object({
      squareMainImageUrls: z.array(z.string().url()).max(5),
      verticalMainImageUrls: z.array(z.string().url()).max(5),
      whiteBackgroundSourceUrl: z.string().url().nullable(),
      detailImageUrls: z.array(z.string().url()).max(30),
      videoUrls: z.array(z.string().url()).max(5),
    }),
    factGaps: z.array(z.string()),
    rejectedClaims: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  })),
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
      text: '你是AI选品与淘宝素材母版模型，本次是该商品唯一一次模型调用。只能从提供的商品名、SourceSKU、结构化事实、图片和视频地址中提取直接可见或明确写出的事实，禁止补充常识、推测或虚构品牌、材质、尺寸、功效、认证、库存、售后。一次完成款型聚类、SKU属性解析，并为每个Offer生成后续内容制作可直接复用的materialMaster。标题和导购标题不超过30字；每个标题特征必须有输入证据。mediaPlan只能引用对应Offer输入中真实存在的URL，不生成文件。skuContent必须逐条覆盖该Offer全部sourceSkuId，merchantCode使用稳定SourceSKU标识且不超过64字符。缺失信息写factGaps，风险宣传写rejectedClaims。规格依据优先级为SourceSKU文字、商品名文字、图片；冲突时采用文字并标明来源。只输出JSON：{"models":[{"name":"款型名称","description":"已确认事实","sourceSkuIds":["sourceSkuId"]}],"skuAttributes":[{"sourceSkuId":"sourceSkuId","specifications":[{"name":"规格名","value":"规格值","basis":"SourceSKU|商品名|图片"}],"color":null,"size":null,"dimensions":{}}],"materialMasters":[{"offerId":"offerId","title":"淘宝标题","guideTitle":"导购标题","sellingPoints":["卖点1","卖点2","卖点3","卖点4","卖点5"],"shortDescription":"短描述","detailSections":[{"heading":"标题","body":"正文","evidence":["证据"]}],"verifiedAttributes":[{"name":"属性","value":"值","evidence":"证据"}],"skuContent":[{"sourceSkuId":"原ID","optimizedName":"规格名","attributes":{},"merchantCode":"稳定编码"}],"mediaPlan":{"squareMainImageUrls":[],"verticalMainImageUrls":[],"whiteBackgroundSourceUrl":null,"detailImageUrls":[],"videoUrls":[]},"factGaps":[],"rejectedClaims":[],"confidence":0.8}]}。dimensions仅可包含length_cm、diameter_cm、width_cm、height_cm、thickness_cm；无法确认则省略。',
    },
  ];
  const addedMedia = new Set<string>();
  for (const row of rows) {
    const raw = (row.raw_data ?? {}) as Record<string, unknown>;
    const detail = (raw.detailEnrichment ?? {}) as Record<string, unknown>;
    const urls = [row.image_url, ...(Array.isArray(detail.mainImages) ? detail.mainImages : []), ...(Array.isArray(detail.detailImages) ? detail.detailImages : [])]
      .filter((value): value is string => typeof value === "string" && /^https?:/i.test(value));
    const videoUrls = [detail.videoUrl, ...(Array.isArray(detail.videoUrls) ? detail.videoUrls : [])].filter((value): value is string => typeof value === "string" && /^https?:/i.test(value));
    content.push({ type: "text", text: `Offer素材事实：${JSON.stringify({ offerId: row.id, title: row.title, attributes: detail.productAttributes ?? {}, imageUrls: urls, videoUrls })}` });
    for (const url of urls.slice(0, 5)) {
      if (addedMedia.size >= 20 || addedMedia.has(url)) continue;
      addedMedia.add(url);
      content.push({ type: "image_url", image_url: { url, detail: "low" } });
    }
  }
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
