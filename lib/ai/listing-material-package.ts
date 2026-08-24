import { z } from "zod";

const nullableNumber = z.number().finite().nullable();

export const listingMaterialInputSchema = z.object({
  product: z.object({
    candidateProductId: z.string().uuid(),
    taobaoItemId: z.string().optional(),
    sourceOfferId: z.string(),
    sourceUrl: z.string().url(),
    sourceTitle: z.string().min(1),
    category: z.string().nullable(),
    supplierName: z.string().nullable(),
  }),
  selection: z.object({
    productModel: z.string().nullable(),
    productVariant: z.string().nullable(),
    recommendation: z.string().nullable(),
    evidence: z.array(z.string()),
    risks: z.array(z.string()),
    targetAudience: z.array(z.string()),
  }),
  verifiedFacts: z.record(z.string(), z.unknown()),
  sourceSkus: z.array(z.object({
    sourceSkuId: z.string(),
    name: z.string(),
    attributes: z.record(z.string(), z.string()),
    purchasePrice: nullableNumber,
    stock: nullableNumber,
    imageUrl: z.string().url().nullable(),
  })),
  taobaoSkuSchema: z.object({
    salesProperties: z.array(z.object({
      propertyId: z.string(),
      name: z.string(),
      supportsImage: z.boolean(),
      values: z.array(z.object({ valueId: z.string(), name: z.string() })),
    })),
    existingSkus: z.array(z.object({
      skuId: z.string().nullable(),
      cspuId: z.string().nullable(),
      propertyValues: z.record(z.string(), z.string()),
      merchantCode: z.string().nullable(),
    })),
  }),
  media: z.object({
    imageUrls: z.array(z.string().url()).max(40),
    videoUrls: z.array(z.string().url()).max(10),
  }),
  constraints: z.object({
    titleMaxChars: z.literal(30),
    guideTitleMaxChars: z.literal(30),
    squareMainImage: z.object({ width: z.literal(1440), height: z.literal(1440), maxCount: z.literal(5) }),
    verticalMainImage: z.object({ width: z.literal(1440), height: z.literal(1920), maxCount: z.literal(5) }),
    whiteBackgroundImage: z.object({ width: z.literal(800), height: z.literal(800), background: z.literal("#FFFFFF") }),
    video: z.object({ minSeconds: z.literal(5), maxSeconds: z.literal(300), maxCount: z.literal(5), allowedRatios: z.tuple([z.literal("1:1"), z.literal("3:4"), z.literal("9:16")]) }),
  }),
});

const sourceAssetInstruction = z.object({
  sourceUrl: z.string().url(),
  purpose: z.string().min(1),
  crop: z.enum(["1:1", "3:4", "9:16", "ORIGINAL"]),
  overlayText: z.string().max(24).nullable(),
  operation: z.enum(["KEEP", "CROP", "REMOVE_BACKGROUND", "COMPOSE", "REJECT"]),
  reason: z.string().min(1),
});

export const listingMaterialPackageSchema = z.object({
  copy: z.object({
    title: z.string().min(1).max(30),
    guideTitle: z.string().max(30),
    sellingPoints: z.array(z.string().min(1).max(40)).length(5),
    shortDescription: z.string().min(1).max(120),
    detailSections: z.array(z.object({ heading: z.string().min(1).max(20), body: z.string().min(1).max(500), evidence: z.array(z.string()) })).min(5).max(12),
  }),
  attributes: z.object({
    categoryAttributes: z.array(z.object({ name: z.string(), value: z.string(), evidence: z.string() })),
    customAttributes: z.array(z.object({ name: z.string(), value: z.string(), evidence: z.string() })).max(5),
    purchaseLocation: z.string().nullable(),
  }),
  salesDimensions: z.array(z.object({
    propertyId: z.string(),
    name: z.string(),
    supportsImage: z.boolean(),
    values: z.array(z.object({ valueId: z.string(), name: z.string(), alias: z.string().nullable(), imageSourceUrl: z.string().url().nullable() })).min(1),
  })),
  skuMappings: z.array(z.object({
    sourceSkuId: z.string(),
    existingSkuId: z.string().nullable(),
    cspuId: z.string().nullable(),
    propertyValues: z.record(z.string(), z.string()),
    taobaoSkuName: z.string().min(1).max(60),
    attributes: z.record(z.string(), z.string()),
    imageSourceUrl: z.string().url().nullable(),
    purchasePrice: nullableNumber,
    stock: nullableNumber,
    merchantCode: z.string().min(1).max(64),
    matrixSignature: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })),
  mediaPlan: z.object({
    squareMainImages: z.array(sourceAssetInstruction).max(5),
    verticalMainImages: z.array(sourceAssetInstruction).max(5),
    whiteBackgroundImage: sourceAssetInstruction.nullable(),
    skuImages: z.array(z.object({ sourceSkuId: z.string(), instruction: sourceAssetInstruction })),
    detailImages: z.array(sourceAssetInstruction).max(30),
    videos: z.array(z.object({ sourceUrl: z.string().url(), ratio: z.enum(["1:1", "3:4", "9:16"]), startSecond: z.number().min(0), endSecond: z.number().positive(), coverSourceUrl: z.string().url(), reason: z.string() })).max(5),
  }),
  publishChecks: z.array(z.object({ key: z.string(), status: z.enum(["PASS", "FAIL", "NEEDS_INPUT"]), detail: z.string() })),
  factGaps: z.array(z.string()),
  rejectedClaims: z.array(z.string()),
  readyForRendering: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type ListingMaterialInput = z.infer<typeof listingMaterialInputSchema>;
export type ListingMaterialPackage = z.infer<typeof listingMaterialPackageSchema>;

type ChatResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export async function generateListingMaterialPackage(rawInput: ListingMaterialInput) {
  const input = listingMaterialInputSchema.parse(rawInput);
  const apiKey = process.env.VISION_API_KEY;
  const model = process.env.VISION_MODEL;
  if (!apiKey) throw new Error("缺少 VISION_API_KEY");
  if (!model) throw new Error("缺少 VISION_MODEL");
  const baseUrl = (process.env.VISION_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
  const system = [
    "你是淘宝商品上架素材总编排模型。一次调用完成事实核验、文案、属性、SKU映射、素材筛选与制作指令。",
    "只能使用输入中的已验证文字事实和可见图片证据；选品推荐理由不是商品事实。禁止虚构品牌、材质、尺寸、功效、认证、库存、售后或使用效果。",
    "不得声称已经生成图片或视频文件。mediaPlan 只输出对输入源素材的可执行处理指令。缺少素材时写入 factGaps，并将相关检查标记 NEEDS_INPUT。",
    "淘宝标题和导购标题均不超过30个字符。必须遵循 taobaoSkuSchema 的销售属性，生成完整笛卡尔积；不得自行创建类目不允许的销售属性。编辑已有SKU时必须保留可匹配的 existingSkuId 和 cspuId。SourceSKU 必须逐条映射，sourceSkuId 不得改写。merchantCode 使用稳定的 SourceSKU 标识且不超过64字符。图片URL只能从输入 media.imageUrls 或 sourceSkus.imageUrl 中选择；视频URL只能从输入 media.videoUrls 中选择。",
    "输出必须是单个JSON对象，且只输出JSON。",
  ].join("\n");
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } }> = [
    { type: "text", text: `${system}\n\nINPUT_JSON:\n${JSON.stringify(input)}` },
  ];
  for (const url of input.media.imageUrls.slice(0, 20)) content.push({ type: "image_url", image_url: { url, detail: "low" } });
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], response_format: { type: "json_object" }, max_tokens: 12000 }),
    signal: AbortSignal.timeout(600_000),
  });
  const payload = await response.json() as ChatResponse;
  if (!response.ok) throw new Error(payload.error?.message || `上架素材模型请求失败 (${response.status})`);
  const responseContent = payload.choices?.[0]?.message?.content;
  if (!responseContent) throw new Error("上架素材模型未返回内容");
  let json: unknown;
  try { json = JSON.parse(responseContent); } catch { throw new Error("上架素材模型返回的不是合法 JSON"); }
  const parsed = listingMaterialPackageSchema.safeParse(json);
  if (!parsed.success) throw new Error(`上架素材包校验失败：${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const allowedImages = new Set([...input.media.imageUrls, ...input.sourceSkus.map((sku) => sku.imageUrl).filter((url): url is string => Boolean(url))]);
  const usedImages = [
    ...parsed.data.mediaPlan.squareMainImages,
    ...parsed.data.mediaPlan.verticalMainImages,
    ...(parsed.data.mediaPlan.whiteBackgroundImage ? [parsed.data.mediaPlan.whiteBackgroundImage] : []),
    ...parsed.data.mediaPlan.skuImages.map((item) => item.instruction),
    ...parsed.data.mediaPlan.detailImages,
  ];
  if (usedImages.some((asset) => !allowedImages.has(asset.sourceUrl))) throw new Error("上架素材包引用了输入中不存在的图片");
  const allowedVideos = new Set(input.media.videoUrls);
  if (parsed.data.mediaPlan.videos.some((video) => !allowedVideos.has(video.sourceUrl))) throw new Error("上架素材包引用了输入中不存在的视频");
  const sourceSkuIds = new Set(input.sourceSkus.map((sku) => sku.sourceSkuId));
  if (parsed.data.skuMappings.length !== sourceSkuIds.size || parsed.data.skuMappings.some((sku) => !sourceSkuIds.has(sku.sourceSkuId))) throw new Error("上架素材包的 SourceSKU 映射不完整");
  const signatures = parsed.data.skuMappings.map((sku) => sku.matrixSignature);
  if (new Set(signatures).size !== signatures.length) throw new Error("上架素材包包含重复的淘宝 SKU 组合");
  const allowedProperties = new Map(input.taobaoSkuSchema.salesProperties.map((property) => [property.propertyId, new Set(property.values.map((value) => value.valueId))]));
  for (const dimension of parsed.data.salesDimensions) {
    const allowedValues = allowedProperties.get(dimension.propertyId);
    if (!allowedValues || dimension.values.some((value) => !allowedValues.has(value.valueId))) throw new Error(`上架素材包使用了类目不允许的销售属性：${dimension.name}`);
  }
  for (const sku of parsed.data.skuMappings) {
    if (Object.entries(sku.propertyValues).some(([propertyId, valueId]) => !allowedProperties.get(propertyId)?.has(valueId))) throw new Error(`SKU ${sku.sourceSkuId} 使用了无效销售属性值`);
  }
  return {
    data: parsed.data,
    model: payload.model || model,
    latencyMs: Math.round(performance.now() - started),
    usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens },
  };
}

export const DEFAULT_LISTING_MATERIAL_CONSTRAINTS: ListingMaterialInput["constraints"] = {
  titleMaxChars: 30,
  guideTitleMaxChars: 30,
  squareMainImage: { width: 1440, height: 1440, maxCount: 5 },
  verticalMainImage: { width: 1440, height: 1920, maxCount: 5 },
  whiteBackgroundImage: { width: 800, height: 800, background: "#FFFFFF" },
  video: { minSeconds: 5, maxSeconds: 300, maxCount: 5, allowedRatios: ["1:1", "3:4", "9:16"] },
};
