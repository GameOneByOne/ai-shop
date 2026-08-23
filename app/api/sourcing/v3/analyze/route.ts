import { createClient } from "@/lib/supabase/server";
import { buildSourcingV3 } from "@/lib/sourcing/v3";
import { filterOffer } from "@/lib/sourcing/offer-filter";
import {
  applyAiClusters,
  generateSourcingClusters,
} from "@/lib/ai/sourcing-cluster";
export async function POST(request: Request) {
  const db = await createClient(),
    { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = (await request.json().catch(() => ({}))) as {
    runId?: string;
  };
  let runQuery = db
    .from("sourcing_runs")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("provider", "1688-browser");
  runQuery = payload.runId
    ? runQuery.eq("id", payload.runId)
    : runQuery.order("created_at", { ascending: false }).limit(1);
  const { data: run } = await runQuery.maybeSingle();
  if (!run)
    return Response.json(
      { error: "没有可重新分析的真实 SourcingRun；请先完成详情采集" },
      { status: 404 },
    );
  const oldCriteria = (run.criteria ?? {}) as Record<string, unknown>;
  const pipeline = (oldCriteria.pipeline ?? {}) as Record<string, unknown>;
  const savedAttributes = oldCriteria.sourcingAttributes as
    | Record<string, unknown>
    | undefined;
  if (
    pipeline.attributeStatus !== "COMPLETED" ||
    Number(savedAttributes?.stage2Version ?? -1) !== Number(pipeline.stage2Version ?? 0) ||
    !savedAttributes?.graph
  )
    return Response.json(
      { error: "请先完成 DeepSeek 商品属性解析" },
      { status: 409 },
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
    ruleGraph = savedAttributes.graph as ReturnType<typeof buildSourcingV3>,
    input = {
      analysis_type: "AI_PRODUCT_MODEL_CLUSTERING_V1",
      prompt_version: "doubao-multimodal-product-model-cluster-v1",
      sourcing_run_id: run.id,
      input_references: qualifiedRows.map((x) => x.id),
    };
  const execution = "MULTIMODAL" as const;
  let graph = ruleGraph,
    actualModel = process.env.VISION_MODEL ?? "vision-model-not-configured",
    latencyMs = Date.now() - started,
    inputTokens: number | undefined,
    outputTokens: number | undefined;
  try {
    const generated = await generateSourcingClusters(
      ruleGraph,
      qualifiedRows,
    );
    graph = applyAiClusters(ruleGraph, generated.data);
    actualModel = generated.model;
    latencyMs = generated.latencyMs;
    inputTokens = generated.usage.inputTokens;
    outputTokens = generated.usage.outputTokens;
  } catch (reason) {
    const cause =
      reason instanceof Error
        ? (reason as Error & {
            cause?: { code?: string; message?: string };
          }).cause
        : undefined;
    const message = reason instanceof Error ? reason.message : "多模态聚类失败";
    const detail = [cause?.code, cause?.message].filter(Boolean).join(" · ");
    return Response.json(
      { error: detail ? `${message}（${detail}）` : message },
      { status: 502 },
    );
  }
  const saved = await db
    .from("ai_runs")
    .insert({
      user_id: auth.user.id,
      type: "AI_PRODUCT_MODEL_CLUSTERING_V1",
      model: actualModel,
      input_json: { ...input, requested_model: process.env.VISION_MODEL },
      output_json: { graph, execution, fallbackReason: null },
      status: "success",
      latency_ms: latencyMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      adopted: true,
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
      requestedModel: process.env.VISION_MODEL,
      actualModel,
      fallbackReason: null,
    },
    adopted: false,
  });
  const { error: persistError } = await db
    .from("sourcing_runs")
    .update({
      criteria: {
        ...oldCriteria,
        pipeline: {
          ...pipeline,
          stage3Status: "COMPLETED",
          stage3Version: Number(pipeline.stage3Version ?? 0) + 1,
          stage3CompletedAt: new Date().toISOString(),
          stage3InputStage2Version: Number(pipeline.stage2Version ?? 0),
        },
        sourcingV3: {
          stage2Version: Number(pipeline.stage2Version ?? 0),
          graph,
          execution,
          requestedModel: process.env.VISION_MODEL,
          actualModel,
          fallbackReason: null,
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
      requestedModel: process.env.VISION_MODEL,
      actualModel,
      fallbackReason: null,
      latencyMs,
    },
  });
}
