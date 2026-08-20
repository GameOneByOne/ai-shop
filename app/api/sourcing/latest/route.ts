import { createClient } from "@/lib/supabase/server";
import {
  buildProductDirections,
  type ProductDirection,
} from "@/lib/sourcing/directions";
import { sourceProductsFromRows } from "@/lib/sourcing/row-directions";
import { buildSourcingV3 } from "@/lib/sourcing/v3";
import { filterOffer } from "@/lib/sourcing/offer-filter";

const priority = {
  PRIORITY_VERIFY: 4,
  VERIFY: 3,
  WATCH: 2,
  REJECT: 1,
} as const;
export async function GET() {
  const db = await createClient(),
    { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: run, error } = await db
    .from("sourcing_runs")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("provider", "1688-browser")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!run)
    return Response.json({
      runId: null,
      products: [],
      directions: [],
      stats: null,
    });
  const { data: products, error: productsError } = await db
    .from("source_products")
    .select("*")
    .eq("sourcing_run_id", run.id)
    .order("rough_score", { ascending: false });
  if (productsError)
    return Response.json({ error: productsError.message }, { status: 500 });
  const rows = ((products ?? []) as Record<string, unknown>[]).map((row) => {
      const raw = (row.raw_data ?? {}) as Record<string, unknown>;
      const facts = raw.offerFacts as Record<string, unknown> | undefined;
      if (!facts) return row;
      const admission = filterOffer({
        price: facts.price == null ? null : Number(facts.price),
        onePieceDelivery: facts.onePieceDelivery as boolean | null,
        minOrderQuantity:
          facts.minOrderQuantity == null
            ? null
            : Number(facts.minOrderQuantity),
        blindShipping: facts.blindShipping as boolean | null,
        returnShipping: facts.returnShipping as boolean | null,
        noReasonReturn: facts.noReasonReturn as boolean | null,
        shopAge: facts.shopAge == null ? null : Number(facts.shopAge),
        qualityRate:
          facts.qualityRate == null ? null : Number(facts.qualityRate),
        repurchaseRate:
          facts.repurchaseRate == null ? null : Number(facts.repurchaseRate),
        deliveryRate:
          facts.deliveryRate == null ? null : Number(facts.deliveryRate),
        stock: facts.stock == null ? null : Number(facts.stock),
        imageCount: facts.imageCount == null ? null : Number(facts.imageCount),
        hasVideo: facts.hasVideo as boolean | null,
        inspection: facts.inspection as boolean | null,
      });
      const detail = raw.detailEnrichment as
        | Record<string, unknown>
        | undefined;
      const qualification = raw.offerQualification as
        | Record<string, unknown>
        | undefined;
      return {
        ...row,
        one_piece_delivery: facts.onePieceDelivery ?? row.one_piece_delivery,
        min_order_quantity: facts.minOrderQuantity ?? row.min_order_quantity,
        blind_shipping: facts.blindShipping ?? row.blind_shipping,
        return_shipping: facts.returnShipping ?? row.return_shipping,
        no_reason_return: facts.noReasonReturn ?? row.no_reason_return,
        shop_age: facts.shopAge ?? row.shop_age,
        quality_rate: facts.qualityRate ?? row.quality_rate,
        repurchase_rate: facts.repurchaseRate ?? row.repurchase_rate,
        delivery_rate: facts.deliveryRate ?? row.delivery_rate,
        stock: facts.stock ?? row.stock,
        image_count: facts.imageCount ?? row.image_count,
        has_video: facts.hasVideo ?? row.has_video,
        inspection: facts.inspection ?? row.inspection,
        offer_status: admission.status,
        offer_reasons: admission.reasons,
        offer_facts_captured_at:
          row.offer_facts_captured_at ??
          qualification?.capturedAt ??
          detail?.capturedAt ??
          new Date().toISOString(),
      };
    }),
    hasAdmissionFacts = rows.some((item) => item.offer_facts_captured_at),
    qualifiedRows = hasAdmissionFacts
      ? rows.filter((item) => item.offer_status === "PASS")
      : rows,
    sourceProducts = sourceProductsFromRows(qualifiedRows),
    keywords = Array.isArray(run.keywords) ? run.keywords.map(String) : [],
    built = buildProductDirections(sourceProducts, {
      taskName: String(run.query ?? ""),
      searchKeywords: keywords,
    }),
    criteria = (run.criteria ?? {}) as Record<string, unknown>,
    pipeline = (criteria.pipeline ?? {}) as Record<string, unknown>,
    review = (criteria.directionReview ?? {}) as Record<string, unknown>,
    currentStage2Version = Number(pipeline.stage2Version ?? 0),
    reviewIsCurrent =
      review.status === "COMPLETED" &&
      review.sourcingRunId === run.id &&
      Number(review.stage2Version ?? -1) === currentStage2Version,
    saved =
      reviewIsCurrent && Array.isArray(review.directions)
        ? (review.directions as Array<
            Partial<ProductDirection> & { id: string }
          >)
        : [],
    byId = new Map(saved.map((item) => [item.id, item]));
  const directions = built
    .map((direction) => {
      const savedDirection = byId.get(direction.id);
      if (!savedDirection) return direction;
      const savedRecommendation = String(
          savedDirection.recommendation ?? "WATCH",
        ),
        recommendation =
          savedRecommendation === "RECOMMEND"
            ? "PRIORITY_VERIFY"
            : savedRecommendation;
      return {
        ...direction,
        ...savedDirection,
        recommendation,
        directionScore: savedDirection.directionScore ?? savedDirection.aiScore,
        aiScore: savedDirection.directionScore ?? savedDirection.aiScore,
        status:
          recommendation === "PRIORITY_VERIFY"
            ? "RECOMMENDED"
            : recommendation === "REJECT"
              ? "REJECTED"
              : "WATCH",
      } as ProductDirection;
    })
    .sort(
      (a, b) =>
        (priority[b.recommendation as keyof typeof priority] ?? 0) -
          (priority[a.recommendation as keyof typeof priority] ?? 0) ||
        (b.directionScore ?? b.aiScore ?? 0) -
          (a.directionScore ?? a.aiScore ?? 0) ||
        b.ruleScore - a.ruleScore,
    );
  const primary = directions.filter((item) => item.taskRelevance === "PRIMARY"),
    adjacent = directions.filter(
      (item) => item.taskRelevance === "ADJACENT_OPPORTUNITY",
    ),
    top = primary
      .filter((item) => item.recommendation === "PRIORITY_VERIFY")
      .slice(0, 3),
    history = Array.isArray(criteria.directionReviewHistory)
      ? criteria.directionReviewHistory
      : [];
  const savedV3 = criteria.sourcingV3 as Record<string, unknown> | undefined;
  const v3 =
    savedV3 &&
    Number(savedV3.stage2Version ?? -1) === currentStage2Version &&
    savedV3.graph
      ? (savedV3.graph as ReturnType<typeof buildSourcingV3>)
      : buildSourcingV3(qualifiedRows, String(run.query ?? ""));
  return Response.json({
    runId: run.id,
    sourcingRunId: run.id,
    query: run.query,
    keywords,
    products: rows,
    v3,
    v3Meta: savedV3
      ? {
          execution: savedV3.execution,
          requestedModel: savedV3.requestedModel,
          actualModel: savedV3.actualModel,
          fallbackReason: savedV3.fallbackReason,
          analyzedAt: savedV3.analyzedAt,
        }
      : null,
    directions,
    primaryDirections: primary,
    adjacentDirections: adjacent,
    top,
    pipeline: {
      stage1Status: pipeline.stage1Status ?? "COMPLETED",
      stage1Version: Number(pipeline.stage1Version ?? 1),
      stage2Status:
        pipeline.stage2Status ??
        (sourceProducts.length ? "COMPLETED" : "NOT_RUN"),
      stage2Version: currentStage2Version,
      stage3Status: reviewIsCurrent
        ? "COMPLETED"
        : (pipeline.stage3Status ?? "NOT_RUN"),
    },
    reviewStatus: reviewIsCurrent
      ? "COMPLETED"
      : pipeline.stage3Status === "STALE"
        ? "STALE"
        : "NOT_RUN",
    reviewSummary: reviewIsCurrent ? (review.summary ?? null) : null,
    reviewedAt: reviewIsCurrent ? (review.reviewedAt ?? null) : null,
    reviewVersion: reviewIsCurrent ? (review.reviewId ?? null) : null,
    reviewHistory: history,
    taskDrafts: Array.isArray(criteria.taskDrafts) ? criteria.taskDrafts : [],
    stats: {
      pages: run.pages_fetched,
      fetched: run.fetched_count,
      unique: run.unique_count,
      relevant: rows.length,
      sourceProducts: v3.models.length,
      sourceSkus: v3.counts.sourceSkus,
      dataErrors: rows.filter((item) => item.data_status === "data_error")
        .length,
      rejected: rows.filter((item) => item.data_status === "rejected").length,
      clusters: v3.models.length,
      eligible: v3.variants.length,
      primaryDirections: primary.length,
      adjacentDirections: adjacent.length,
      unknownDirections: directions.filter(
        (item) => item.taskRelevance === "UNKNOWN",
      ).length,
    },
  });
}
