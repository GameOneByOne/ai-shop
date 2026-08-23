import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_OFFER_RULE_CONFIG, filterOffer, type OfferFacts, type OfferRuleConfig } from "@/lib/sourcing/offer-filter";

const schema = z.object({ runId: z.string().uuid() });
type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "规则初筛参数无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: run } = await db.from("sourcing_runs").select("criteria").eq("id", parsed.data.runId).eq("user_id", auth.user.id).single();
  const criteria = record(run?.criteria), savedConfig = record(criteria.ruleSelectionConfig);
  const configuredBoolean = (key: keyof OfferRuleConfig) => typeof savedConfig[key] === "boolean"
    ? Boolean(savedConfig[key])
    : DEFAULT_OFFER_RULE_CONFIG[key] as boolean;
  const ruleConfig: OfferRuleConfig = {
    requireOnePiece: configuredBoolean("requireOnePiece"),
    require1688Selection: configuredBoolean("require1688Selection"),
    requireReturnShipping: configuredBoolean("requireReturnShipping"),
    requireNoReasonReturn: configuredBoolean("requireNoReasonReturn"),
    rejectNoSellableSku: configuredBoolean("rejectNoSellableSku"),
    requireSingleOrder: configuredBoolean("requireSingleOrder"),
    rejectInvalidProduct: configuredBoolean("rejectInvalidProduct"),
    rejectMissingCriticalData: configuredBoolean("rejectMissingCriticalData"),
    pickup48Min: Number(savedConfig.pickup48Min ?? DEFAULT_OFFER_RULE_CONFIG.pickup48Min),
    qualityMin: Number(savedConfig.qualityMin ?? DEFAULT_OFFER_RULE_CONFIG.qualityMin),
    reviewCountMin: Number(savedConfig.reviewCountMin ?? DEFAULT_OFFER_RULE_CONFIG.reviewCountMin),
    productFavoriteMin: Number(savedConfig.productFavoriteMin ?? savedConfig.shopFavoriteMin ?? DEFAULT_OFFER_RULE_CONFIG.productFavoriteMin),
    positiveReviewMin: Number(savedConfig.positiveReviewMin ?? DEFAULT_OFFER_RULE_CONFIG.positiveReviewMin),
  };
  const { data, error } = await db.from("source_products")
    // Admission columns are not present in every deployed database yet. The
    // parser persists the same structured facts in raw_data.offerFacts, which
    // is the compatible source of truth for deterministic screening.
    .select("id,raw_data")
    .eq("user_id", auth.user.id)
    .eq("sourcing_run_id", parsed.data.runId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const screenedAt = new Date().toISOString();
  let rejected = 0, passed = 0, preserved = 0;
  const updates: Array<PromiseLike<{ error: { message: string } | null }>> = [];
  for (const row of data ?? []) {
    const raw = record(row.raw_data), existing = record(raw.sourcingSelection), detail = record(raw.detailEnrichment);
    const sourceSkus = Array.isArray(detail.sourceProducts) ? detail.sourceProducts.flatMap((product) => {
      const value = record(product); return Array.isArray(value.skus) ? value.skus.map(record) : [];
    }) : [];
    const knownStockSkus = sourceSkus.filter((sku) => typeof sku.inventory === "number");
    const inStockSkus = knownStockSkus.filter((sku) => Number(sku.inventory) > 0);
    const qualification = filterOffer({
      ...record(raw.offerFacts),
      skuTotalCount: sourceSkus.length,
      skuKnownStockCount: knownStockSkus.length,
      skuInStockCount: inStockSkus.length,
      skuAvailabilityRate: knownStockSkus.length ? Math.round(inStockSkus.length / knownStockSkus.length * 1000) / 10 : null,
    } as unknown as OfferFacts, ruleConfig);
    const manuallySelected = (["PRIMARY", "BACKUP", "REJECTED"].includes(String(existing.status)) || existing.ruleOverride === true) && existing.selectedBy !== "RULE_SCREENING";
    const decision = qualification.decision;
    if (decision === "REJECTED") rejected += 1;
    else if (decision === "PASSED") passed += 1;
    if (manuallySelected) preserved += 1;
    const sourcingSelection = manuallySelected ? existing : {
      ...existing,
      status: "CANDIDATE",
      selectedAt: screenedAt,
      selectedBy: "RULE_SCREENING",
    };
    updates.push(db.from("source_products").update({ raw_data: {
      ...raw,
      sourcingSelection,
      ruleSelection: {
        decision: qualification.decision,
        hardGate: qualification.hardGate,
        hardFailures: qualification.hardFailures,
        risks: qualification.risks,
        strengths: qualification.strengths,
        missingFields: qualification.missingFields,
        screenedAt,
        version: "stable-dropship-v3",
        config: ruleConfig,
      },
    } }).eq("id", row.id));
  }
  const updateResults = await Promise.all(updates);
  const failedUpdate = updateResults.find((result) => result.error)?.error;
  if (failedUpdate) return Response.json({ error: failedUpdate.message }, { status: 500 });
  return Response.json({ ok: true, total: data?.length ?? 0, rejected, passed, preserved, screenedAt });
}
