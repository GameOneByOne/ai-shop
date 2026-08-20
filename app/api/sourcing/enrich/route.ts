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
  stock: z.number().int().nonnegative().nullable(),
  imageCount: z.number().int().nonnegative().nullable(),
  hasVideo: z.boolean().nullable(),
  inspection: z.boolean().nullable(),
});
const detail = z.object({
  offerId: z.string().uuid(),
  externalId: z.string(),
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
  variants: z.array(variant).min(1).max(50),
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
  if (!parsed.success)
    return Response.json({ error: "详情规格数据格式无效" }, { status: 400 });
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
      .select("id,raw_data")
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
      previousDetail = (previousRaw.detailEnrichment ?? {}) as Record<
        string,
        unknown
      >,
      manual = Array.isArray(previousDetail.manualVerifications)
        ? (previousDetail.manualVerifications as Array<Record<string, unknown>>)
        : [];
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
    const facts = item.offerFacts ?? {
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
      admission = filterOffer(facts),
      raw = parsed.data.factsOnly
        ? {
            ...previousRaw,
            offerFacts: facts,
            offerQualification: {
              capturedAt: item.capturedAt,
              parserVersion: item.parserVersion ?? "unknown",
              status: admission.status,
              reasons: admission.reasons,
            },
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
              rawOptions,
              sourceProducts,
              filteredOptions: parsedProducts.filteredOptions,
              ambiguousOptions: parsedProducts.ambiguousOptions,
              manualVerifications: manual,
            },
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
      offer_status: admission.status,
      offer_reasons: admission.reasons,
      offer_facts_captured_at: item.capturedAt,
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
      stage3Status: oldReview ? "STALE" : "NOT_RUN",
    },
    directionReview: undefined,
    directionReviewHistory: invalidatedReview
      ? [...history, invalidatedReview].slice(-10)
      : history,
  };
  const { error: updateRunError } = await db
    .from("sourcing_runs")
    .update({ criteria })
    .eq("id", run.id);
  if (updateRunError)
    return Response.json({ error: updateRunError.message }, { status: 500 });
  return Response.json({
    ok: true,
    runId: run.id,
    enrichedOffers: parsed.data.details.length,
  });
}
