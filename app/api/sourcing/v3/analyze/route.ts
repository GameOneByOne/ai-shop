import { createClient } from "@/lib/supabase/server";
import { buildSourcingV3 } from "@/lib/sourcing/v3";
import { filterOffer } from "@/lib/sourcing/offer-filter";
import {
  applyAiClusters,
  generateSourcingClusters,
} from "@/lib/ai/sourcing-cluster";
export async function POST() {
  const db = await createClient(),
    { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: run } = await db
    .from("sourcing_runs")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("provider", "1688-browser")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run)
    return Response.json(
      { error: "没有可重新分析的真实 SourcingRun；请先完成详情采集" },
      { status: 404 },
    );
  const { data: rows, error } = await db
    .from("source_products")
    .select("*")
    .eq("sourcing_run_id", run.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const allRows = ((rows ?? []) as Record<string, unknown>[]).map((row) => {
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
      return {
        ...row,
        offer_status: admission.status,
        offer_facts_captured_at: true,
      };
    }),
    hasAdmissionFacts = allRows.some((item) => item.offer_facts_captured_at),
    qualifiedRows = hasAdmissionFacts
      ? allRows.filter((item) => item.offer_status === "PASS")
      : allRows,
    started = Date.now(),
    ruleGraph = buildSourcingV3(qualifiedRows, String(run.query ?? "")),
    input = {
      analysis_type: "AI_PRODUCT_MODEL_CLUSTERING_V1",
      prompt_version: "deepseek-product-model-cluster-v2-independent",
      sourcing_run_id: run.id,
      input_references: qualifiedRows.map((x) => x.id),
    };
  let graph = ruleGraph,
    execution: "DEEPSEEK" | "RULE_FALLBACK" = "RULE_FALLBACK",
    actualModel = "parser-rule-v3-fallback",
    fallbackReason: string | null = null,
    latencyMs = Date.now() - started,
    inputTokens: number | undefined,
    outputTokens: number | undefined;
  try {
    const generated = await generateSourcingClusters(
      ruleGraph,
      String(run.query ?? ""),
    );
    graph = applyAiClusters(ruleGraph, generated.data);
    execution = "DEEPSEEK";
    actualModel = generated.model;
    latencyMs = generated.latencyMs;
    inputTokens = generated.usage.inputTokens;
    outputTokens = generated.usage.outputTokens;
  } catch (reason) {
    fallbackReason =
      reason instanceof Error ? reason.message : "DeepSeek 聚类失败";
  }
  const saved = await db
    .from("ai_runs")
    .insert({
      user_id: auth.user.id,
      type: "AI_PRODUCT_MODEL_CLUSTERING_V1",
      model: actualModel,
      input_json: { ...input, requested_model: "deepseek-v4-pro" },
      output_json: { graph, execution, fallbackReason },
      status: "success",
      latency_ms: latencyMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      adopted: execution === "DEEPSEEK",
    })
    .select("id")
    .single();
  if (saved.error)
    return Response.json({ error: saved.error.message }, { status: 500 });
  await db.from("ai_analyses").insert({
    user_id: auth.user.id,
    ai_run_id: saved.data.id,
    analysis_type: "AI_PRODUCT_MODEL_CLUSTERING_V1",
    result: {
      confidence: graph.sourceSkus.length
        ? Math.round(
            graph.sourceSkus.reduce((n, x) => n + x.confidence, 0) /
              graph.sourceSkus.length,
          ) / 100
        : 0,
      evidence: graph.models.flatMap((x) => x.evidence),
      counts: graph.counts,
      execution,
      requestedModel: "deepseek-v4-pro",
      actualModel,
      fallbackReason,
    },
    adopted: false,
  });
  const oldCriteria = (run.criteria ?? {}) as Record<string, unknown>;
  const pipeline = (oldCriteria.pipeline ?? {}) as Record<string, unknown>;
  const { error: persistError } = await db
    .from("sourcing_runs")
    .update({
      criteria: {
        ...oldCriteria,
        sourcingV3: {
          stage2Version: Number(pipeline.stage2Version ?? 0),
          graph,
          execution,
          requestedModel: "deepseek-v4-pro",
          actualModel,
          fallbackReason,
          analyzedAt: new Date().toISOString(),
          analysisRunId: saved.data.id,
        },
      },
    })
    .eq("id", run.id);
  if (persistError)
    return Response.json(
      { error: `聚类已完成但保存失败：${persistError.message}` },
      { status: 500 },
    );
  return Response.json({
    ok: true,
    analysisRunId: saved.data.id,
    graph,
    meta: {
      execution,
      requestedModel: "deepseek-v4-pro",
      actualModel,
      fallbackReason,
      latencyMs,
    },
  });
}
