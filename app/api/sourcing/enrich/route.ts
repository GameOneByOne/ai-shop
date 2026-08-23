import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  isTrustedPrice,
  parseSourceProducts,
  type PriceSource,
  type SourceNodeType,
} from "@/lib/sourcing/source-products";
import { filterOffer } from "@/lib/sourcing/offer-filter";

const variant = z.object({
  sourceVariantId: z.string().min(3),
  variantName: z.string().min(1),
  specValues: z.array(z.string()),
  rawSpecText: z.string().optional(),
  rawPriceText: z.string().nullable().optional(),
  priceSource: z
    .enum([
      "DROPSHIP_PRICE",
      "SKU_PRICE",
      "WHOLESALE_PRICE",
      "WHOLESALE_STARTING_PRICE",
      "SEARCH_DISPLAY_PRICE",
      "UNKNOWN",
    ])
    .optional(),
  nodeType: z
    .enum(["SKU_SPEC", "SERVICE_INFO", "MARKETING_TEXT", "UNKNOWN"])
    .optional(),
  price: z.number().positive().nullable(),
  stock: z.number().int().nonnegative().nullable(),
  image: z.string().nullable().optional(),
  minOrderQuantity: z.number().int().positive().nullable(),
});
const offerFacts = z.object({
  price: z.number().positive().nullable(),
  onePieceDelivery: z.boolean().nullable(),
  minOrderQuantity: z.number().int().positive().nullable(),
  blindShipping: z.boolean().nullable(),
  returnShipping: z.boolean().nullable(),
  noReasonReturn: z.boolean().nullable(),
  shopAge: z.number().int().nonnegative().nullable(),
  qualityRate: z.number().min(0).max(100).nullable(),
  repurchaseRate: z.number().min(0).max(100).nullable(),
  deliveryRate: z.number().min(0).max(100).nullable(),
  pickup24Rate: z.number().min(0).max(100).nullable().optional(),
  pickup48Rate: z.number().min(0).max(100).nullable().optional(),
  offerPriceMin: z.number().positive().nullable().optional(),
  offerPriceMax: z.number().positive().nullable().optional(),
  offerPriceDisplay: z.string().max(80).nullable().optional(),
  newcomerPrice: z.number().positive().nullable().optional(),
  newcomerPriceDisplay: z.string().max(80).nullable().optional(),
  shippingOrigin: z.string().max(100).nullable().optional(),
  estimatedDelivery: z.string().max(120).nullable().optional(),
  lateDeliveryCompensation: z.boolean().nullable().optional(),
  fastRefund: z.boolean().nullable().optional(),
  dropshipQualityRate: z.number().min(0).max(100).nullable().optional(),
  dropship30DayVolume: z.number().int().nonnegative().nullable().optional(),
  dropship30DayVolumeDisplay: z.string().max(80).nullable().optional(),
  dropship7DayVolume: z.number().int().nonnegative().nullable().optional(),
  dropship7DayVolumeDisplay: z.string().max(80).nullable().optional(),
  downstreamListingCount: z.number().int().nonnegative().nullable().optional(),
  downstreamListingCountDisplay: z.string().max(80).nullable().optional(),
  distributorCount: z.number().int().nonnegative().nullable().optional(),
  distributorCountDisplay: z.string().max(80).nullable().optional(),
  dropshipBuyerRetentionRate: z.number().min(0).max(100).nullable().optional(),
  dropshipHeat: z.string().max(80).nullable().optional(),
  dropshipRank: z.string().max(120).nullable().optional(),
  dropshipPlatforms: z.string().max(120).nullable().optional(),
  onePiecePrice: z.number().positive().nullable().optional(),
  productRating: z.number().min(0).max(5).nullable().optional(),
  aiSelectionIndex: z.number().min(0).max(10).nullable().optional(),
  productRepurchaseRate: z.number().min(0).max(100).nullable().optional(),
  productReviewCount: z.number().int().nonnegative().nullable().optional(),
  productReviewCountDisplay: z.string().max(80).nullable().optional(),
  positiveReviewCount: z.number().int().nonnegative().nullable().optional(),
  positiveReviewCountDisplay: z.string().max(80).nullable().optional(),
  totalReviewCount: z.number().int().nonnegative().nullable().optional(),
  totalReviewCountDisplay: z.string().max(80).nullable().optional(),
  positiveReviewRate: z.number().min(0).max(100).nullable().optional(),
  reviewParseStatus: z.enum(["商品评价解析完成", "商品评价模块不存在", "商品评价加载失败"]).optional(),
  officialInspection: z.boolean().nullable().optional(),
  qualityCompensation: z.boolean().nullable().optional(),
  inventoryStable: z.boolean().nullable().optional(),
  recentStockout: z.boolean().nullable().optional(),
  merchantType: z.string().max(80).nullable().optional(),
  merchantFeatures: z.string().max(160).nullable().optional(),
  hasSelectionTitle: z.boolean().nullable().optional(),
  selectionTitle: z.string().max(40).nullable().optional(),
  merchantLevel: z.string().max(80).nullable().optional(),
  mainCategory: z.string().max(100).nullable().optional(),
  productCategory: z.string().max(120).nullable().optional(),
  productCategoryId: z.string().max(40).nullable().optional(),
  skuTotalCount: z.number().int().nonnegative().nullable().optional(),
  skuKnownStockCount: z.number().int().nonnegative().nullable().optional(),
  skuInStockCount: z.number().int().nonnegative().nullable().optional(),
  skuAvailabilityRate: z.number().min(0).max(100).nullable().optional(),
  shopPickup48Rate: z.number().min(0).max(100).nullable().optional(),
  productFavoriteCount: z.number().int().nonnegative().nullable().optional(),
  shopFavoriteCount: z.number().int().nonnegative().nullable().optional(),
  productValid: z.boolean().nullable().optional(),
  sampleSupported: z.boolean().nullable().optional(),
  newcomerOffer: z.boolean().nullable().optional(),
  firstOrderOffer: z.boolean().nullable().optional(),
  couponText: z.string().max(120).nullable().optional(),
  salesCount: z.number().int().nonnegative().nullable().optional(),
  salesDisplay: z.string().max(80).nullable().optional(),
  stock: z.number().int().nonnegative().nullable(),
  imageCount: z.number().int().nonnegative().nullable(),
  hasVideo: z.boolean().nullable(),
  inspection: z.boolean().nullable(),
});
const detail = z.object({
  offerId: z.string().uuid(),
  externalId: z.string(),
  title: z.string().trim().min(2).max(300).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  supplierName: z.string().trim().min(2).max(200).nullable().optional(),
  parserVersion: z.string().max(30).optional(),
  capabilities: z.object({
    dropshipping: z.boolean().nullable(),
    encryptedDropshipping: z.boolean().nullable(),
    returnShipping: z.boolean().nullable(),
    onePiecePrice: z.boolean().nullable(),
  }),
  pricingContext: z.object({
    shippingFee: z.number().nonnegative().nullable(),
    shippingQuote: z.number().nonnegative().nullable(),
    promotionDiscount: z.number().nonnegative().nullable(),
    promotionText: z.string().nullable(),
    shippingScope: z.string(),
  }),
  offerFacts: offerFacts.optional(),
  detailImages: z.array(z.string().url()).max(300).optional(),
  mainImages: z.array(z.string().url()).max(100).optional(),
  skuImages: z.array(z.string().url()).max(300).optional(),
  productAttributes: z.record(z.string(), z.string()).optional(),
  // A real 1688 color × specification matrix can exceed 50 purchasable SKUs.
  // The browser parser returns only actual skuInfoMap combinations, so keep
  // them intact instead of rejecting the entire detail batch.
  variants: z.array(variant).min(1).max(500),
  capturedAt: z.string(),
});
const schema = z.object({
  runId: z.string().uuid(),
  details: z.array(detail).min(1).max(50),
  factsOnly: z.boolean().optional().default(false),
});

function economics(
  displayPrice: number,
  shippingFee: number | null,
  promotionDiscount: number | null,
  criteria: Record<string, unknown>,
) {
  const shipping = shippingFee ?? Number(criteria.shippingAssumption ?? 3),
    discount = promotionDiscount ?? 0,
    cost = displayPrice + shipping - discount,
    packaging = Number(criteria.packagingAssumption ?? 0.5),
    afterSales = Number(criteria.afterSalesReserve ?? 0.5),
    platform = Number(criteria.platformAndPromotionRate ?? 0.16),
    margin = Number(criteria.minMarginRate ?? 0.45),
    minProfit = Number(criteria.minUnitProfit ?? 5),
    fixed = packaging + afterSales;
  const target =
    Math.ceil(
      Math.max(
        (cost + fixed + minProfit) / (1 - platform),
        (cost + fixed) / Math.max(0.05, 1 - platform - margin),
      ),
    ) - 0.1;
  const profit = (price: number) =>
    Math.round((price * (1 - platform) - cost - fixed) * 100) / 100;
  return {
    landedCost: cost,
    shippingFee: shipping,
    shippingConfidence:
      shippingFee == null
        ? "ESTIMATED_FROM_STORE_SETTINGS"
        : "CONFIRMED_AT_CHECKOUT",
    promotionDiscount,
    discountConfidence: promotionDiscount == null ? "UNKNOWN" : "CONFIRMED",
    targetSalePriceMin: target,
    targetSalePriceMax: target + 3,
    estimatedProfitMin: profit(target),
    estimatedProfitMax: profit(target + 3),
  };
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0], path = issue?.path.join(".");
    return Response.json({
      error: `详情规格数据格式无效${issue ? `：${path || "请求"} ${issue.message}` : ""}`,
      issues: parsed.error.issues.slice(0, 10).map((item) => ({
        path: item.path.join("."),
        message: item.message,
      })),
    }, { status: 400 });
  }
  const db = await createClient(),
    { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: run, error: runError } = await db
    .from("sourcing_runs")
    .select("id,criteria")
    .eq("id", parsed.data.runId)
    .eq("user_id", auth.user.id)
    .single();
  if (runError || !run)
    return Response.json({ error: "选品 Run 不存在" }, { status: 404 });
  const oldCriteria = (run.criteria ?? {}) as Record<string, unknown>,
    oldPipeline = (oldCriteria.pipeline ?? {}) as Record<string, unknown>,
    stage2Version = Number(oldPipeline.stage2Version ?? 0) + 1;
  for (const item of parsed.data.details) {
    const { data: source, error } = await db
      .from("source_products")
      .select("id,title,supplier_name,raw_data")
      .eq("id", item.offerId)
      .eq("sourcing_run_id", run.id)
      .single();
    if (error || !source) continue;
    const rawOptions = item.variants.map((v) => ({
      ...v,
      priceSource: (v.priceSource ?? "UNKNOWN") as PriceSource,
      nodeType: (v.nodeType ?? "UNKNOWN") as SourceNodeType,
      priceLevel: "RAW_OPTION_DISPLAY",
      offerSalesScope: "OFFER_LEVEL",
    }));
    // Offer 横向比较只允许使用页面顶部的 Offer 价格区间。
    // SourceSKU 单价仅进入右侧 SKU 明细，禁止回填为整条 Offer 的采购价。
    const parsedPriceMin = item.offerFacts?.offerPriceMin ?? null;
    const parsedPriceMax = item.offerFacts?.offerPriceMax ?? null;
    const parsedProducts = parsed.data.factsOnly
      ? { products: [], filteredOptions: [], ambiguousOptions: [] }
      : parseSourceProducts({
          sourceOfferId: source.id,
          externalOfferId: item.externalId,
          supportsDropshipping: item.capabilities.dropshipping,
          onePiecePrice: item.capabilities.onePiecePrice,
          options: rawOptions,
        });
    const previousRaw = (source.raw_data ?? {}) as Record<string, unknown>,
      preservedSearchTitle =
        typeof previousRaw.searchTitle === "string" && previousRaw.searchTitle.trim()
          ? previousRaw.searchTitle.trim()
          : source.title,
      previousDetail = (previousRaw.detailEnrichment ?? {}) as Record<
        string,
        unknown
      >,
      manual = Array.isArray(previousDetail.manualVerifications)
        ? (previousDetail.manualVerifications as Array<Record<string, unknown>>)
        : [];
    const validProductTitle = (value: unknown) => {
      const title = typeof value === "string" ? value.trim() : "";
      return Boolean(
        title &&
          title !== item.supplierName &&
          title !== source.supplier_name &&
          !/^(?:限购\s*\d+|新人(?:价|专享|首单)|满\s*\d+|券后|优惠|促销|活动)|(?:超出|超过).{0,12}(?:不享受|无)优惠|\d+\s*(?:件|个|只|套)\s*起批/.test(
            title,
          ),
      );
    };
    const nextTitle = validProductTitle(item.title)
      ? item.title
      : preservedSearchTitle;
    const sourceProducts = parsedProducts.products.map((product) => ({
      ...product,
      sourcingRunId: run.id,
      sourceStageVersion: stage2Version,
      skus: product.skus.map((sku) => {
        const verified = manual.find(
            (entry) =>
              entry.sourceProductId === product.id &&
              entry.sourceSkuId === sku.id,
          ),
          numberOr = (value: unknown, fallback: number | null) =>
            value == null ? fallback : Number(value),
          manualSku = verified
            ? {
                ...sku,
                dropshipPrice: numberOr(
                  verified.dropshipPrice,
                  sku.dropshipPrice,
                ),
                dropshipMoq: numberOr(verified.dropshipMoq, sku.dropshipMoq),
                wholesalePrice: numberOr(
                  verified.wholesalePrice,
                  sku.wholesalePrice,
                ),
                wholesaleMoq: numberOr(verified.wholesaleMoq, sku.wholesaleMoq),
                shippingFee: numberOr(verified.shippingFee, sku.shippingFee),
                priceStatus: "VERIFIED" as const,
                priceSource: "DROPSHIP_PRICE" as const,
                verificationSource: "MANUAL_1688_PAGE",
                verifiedAt: verified.verifiedAt,
                verifiedBy: verified.verifiedBy,
                evidenceNote: verified.evidenceNote,
              }
            : sku,
          versionedSku = {
            ...manualSku,
            sourcingRunId: run.id,
            sourceStageVersion: stage2Version,
          },
          price = versionedSku.dropshipPrice ?? versionedSku.wholesalePrice;
        if (!isTrustedPrice(versionedSku) || price == null) return versionedSku;
        return {
          ...versionedSku,
          ...economics(
            price,
            versionedSku.shippingFee ?? item.pricingContext.shippingFee,
            item.pricingContext.promotionDiscount,
            (run.criteria ?? {}) as Record<string, unknown>,
          ),
        };
      }),
    }));
    const baseFacts = item.offerFacts ?? {
        price:
          rawOptions
            .map((option) => option.price)
            .filter((value): value is number => value != null)
            .sort((a, b) => a - b)[0] ?? null,
        onePieceDelivery:
          item.capabilities.dropshipping ?? item.capabilities.onePiecePrice,
        minOrderQuantity: null,
        blindShipping: item.capabilities.encryptedDropshipping,
        returnShipping: item.capabilities.returnShipping,
        noReasonReturn: null,
        shopAge: null,
        qualityRate: null,
        repurchaseRate: null,
        deliveryRate: null,
        stock: null,
        imageCount: null,
        hasVideo: null,
        inspection: null,
      },
      purchasableSkus = sourceProducts.flatMap((product) => product.skus),
      knownStockSkus = purchasableSkus.filter((sku) => sku.inventory != null),
      inStockSkus = knownStockSkus.filter((sku) => Number(sku.inventory) > 0),
      facts = {
        ...baseFacts,
        skuTotalCount: purchasableSkus.length,
        skuKnownStockCount: knownStockSkus.length,
        skuInStockCount: inStockSkus.length,
        skuAvailabilityRate: knownStockSkus.length ? Math.round(inStockSkus.length / knownStockSkus.length * 1000) / 10 : null,
      },
      admission = filterOffer(facts),
      raw = parsed.data.factsOnly
        ? {
            ...previousRaw,
            offerFacts: facts,
            detailEnrichment: {
              ...previousDetail,
              version: 5,
              parserVersion: item.parserVersion ?? "unknown",
              capturedAt: item.capturedAt,
              detailImages: item.detailImages ?? previousDetail.detailImages ?? [],
              mainImages: item.mainImages ?? previousDetail.mainImages ?? [],
              skuImages: item.skuImages ?? previousDetail.skuImages ?? [],
              productAttributes:
                item.productAttributes ?? previousDetail.productAttributes ?? {},
            },
            offerQualification: { capturedAt: item.capturedAt, parserVersion: item.parserVersion ?? "unknown", ...admission },
          }
        : {
            ...previousRaw,
            offerFacts: facts,
            detailEnrichment: {
              version: 5,
              parserVersion: item.parserVersion ?? "unknown",
              granularity: "SOURCE_PRODUCT_SOURCE_SKU_PRICE_GATE",
              capturedAt: item.capturedAt,
              capabilities: item.capabilities,
              pricingContext: item.pricingContext,
              detailImages: item.detailImages ?? [],
              mainImages: item.mainImages ?? [],
              skuImages: item.skuImages ?? [],
              productAttributes: item.productAttributes ?? {},
              rawOptions,
              sourceProducts,
              filteredOptions: parsedProducts.filteredOptions,
              ambiguousOptions: parsedProducts.ambiguousOptions,
              manualVerifications: manual,
            },
            offerQualification: { capturedAt: item.capturedAt, parserVersion: item.parserVersion ?? "unknown", ...admission },
          };
    const updatePayload = {
      raw_data: raw,
      dropshipping: item.capabilities.dropshipping,
      return_shipping: facts.returnShipping,
      one_piece_delivery: facts.onePieceDelivery,
      minimum_order_quantity: facts.minOrderQuantity,
      blind_shipping: facts.blindShipping,
      no_reason_return: facts.noReasonReturn,
      shop_age: facts.shopAge,
      quality_rate: facts.qualityRate,
      repurchase_rate: facts.repurchaseRate,
      delivery_rate: facts.deliveryRate,
      stock: facts.stock,
      image_count: facts.imageCount,
      has_video: facts.hasVideo,
      inspection: facts.inspection,
      ...(facts.salesCount != null ? { sales_count: facts.salesCount } : {}),
      offer_status: admission.status,
      offer_reasons: admission.reasons,
      offer_facts_captured_at: item.capturedAt,
      ...(parsedPriceMin != null ? { price_min: parsedPriceMin } : {}),
      ...(parsedPriceMax != null ? { price_max: parsedPriceMax } : {}),
      title: nextTitle,
      ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
      ...(item.supplierName ? { supplier_name: item.supplierName } : {}),
    };
    let { error: updateError } = await db
      .from("source_products")
      .update(updatePayload)
      .eq("id", source.id);
    if (updateError && ["PGRST204", "42703"].includes(updateError.code ?? "")) {
      const fallback = await db
        .from("source_products")
        .update({
          raw_data: raw,
          dropshipping: item.capabilities.dropshipping,
          return_shipping: facts.returnShipping,
          minimum_order_quantity: facts.minOrderQuantity,
          repurchase_rate: facts.repurchaseRate,
          title: nextTitle,
          ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
          ...(item.supplierName ? { supplier_name: item.supplierName } : {}),
        })
        .eq("id", source.id);
      updateError = fallback.error;
    }
    if (updateError)
      return Response.json({ error: updateError.message }, { status: 500 });
  }
  if (parsed.data.factsOnly) {
    return Response.json({
      ok: true,
      runId: run.id,
      qualifiedOffers: parsed.data.details.length,
    });
  }
  const oldReview = oldCriteria.directionReview as
      | Record<string, unknown>
      | undefined,
    invalidatedReview = oldReview
      ? {
          ...oldReview,
          status: "STALE",
          invalidatedAt: new Date().toISOString(),
          invalidatedByStage2Version: stage2Version,
        }
      : undefined,
    history = Array.isArray(oldCriteria.directionReviewHistory)
      ? oldCriteria.directionReviewHistory
      : [];
  const criteria = {
    ...oldCriteria,
    detailEnrichment: {
      completedAt: new Date().toISOString(),
      offerCount: parsed.data.details.length,
    },
    pipeline: {
      ...oldPipeline,
      stage1Status: "COMPLETED",
      stage2Status: "COMPLETED",
      stage2Version,
      stage2CompletedAt: new Date().toISOString(),
      attributeStatus: "NOT_RUN",
      stage3Status: oldReview ? "STALE" : "NOT_RUN",
    },
    directionReview: undefined,
    directionReviewHistory: invalidatedReview
      ? [...history, invalidatedReview].slice(-10)
      : history,
  };
  const { error: updateRunError } = await db
    .from("sourcing_runs")
    .update({
      criteria,
      eligible_count: parsed.data.details.length,
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (updateRunError)
    return Response.json({ error: updateRunError.message }, { status: 500 });
  return Response.json({
    ok: true,
    runId: run.id,
    enrichedOffers: parsed.data.details.length,
  });
}
