import { createClient } from "@/lib/supabase/server";
import { buildSourcingV3 } from "@/lib/sourcing/v3";
import {
  applySourceSkuAttributes,
  parseSourceSkuAttributes,
} from "@/lib/ai/sourcing-attributes";

export async function POST(request: Request) {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { runId } = (await request.json().catch(() => ({}))) as { runId?: string };
  if (!runId) return Response.json({ error: "缺少货源任务ID" }, { status: 400 });
  const { data: run } = await db
    .from("sourcing_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!run) return Response.json({ error: "货源任务不存在" }, { status: 404 });
  const { data: rows, error } = await db
    .from("source_products")
    .select("*")
    .eq("sourcing_run_id", run.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const sourceRows = (rows ?? []) as Record<string, unknown>[];
  const graph = buildSourcingV3(sourceRows, String(run.query ?? ""));
  if (!graph.sourceSkus.length)
    return Response.json({ error: "当前任务没有可解析的采购SKU" }, { status: 409 });
  const criteria = (run.criteria ?? {}) as Record<string, unknown>;
  const pipeline = (criteria.pipeline ?? {}) as Record<string, unknown>;
  try {
    const generated = await parseSourceSkuAttributes(graph, sourceRows);
    const parsedGraph = applySourceSkuAttributes(graph, generated.data);
    const completedAt = new Date().toISOString();
    const saved = await db
      .from("ai_runs")
      .insert({
        user_id: auth.user.id,
        type: "AI_SOURCE_SKU_ATTRIBUTES_V1",
        model: generated.model,
        input_json: { sourcing_run_id: run.id, source: "PRODUCT_NAME_AND_SOURCE_SKU" },
        output_json: generated.data,
        status: "success",
        latency_ms: generated.latencyMs,
        input_tokens: generated.usage.inputTokens,
        output_tokens: generated.usage.outputTokens,
        adopted: true,
      })
      .select("id")
      .single();
    if (saved.error) throw new Error(saved.error.message);
    const { error: updateError } = await db
      .from("sourcing_runs")
      .update({
        criteria: {
          ...criteria,
          pipeline: {
            ...pipeline,
            attributeStatus: "COMPLETED",
            attributeVersion: Number(pipeline.attributeVersion ?? 0) + 1,
            attributeCompletedAt: completedAt,
            attributeInputStage2Version: Number(pipeline.stage2Version ?? 0),
            stage3Status: "NOT_RUN",
          },
          sourcingAttributes: {
            stage2Version: Number(pipeline.stage2Version ?? 0),
            graph: parsedGraph,
            model: generated.model,
            analyzedAt: completedAt,
            analysisRunId: saved.data.id,
          },
        },
      })
      .eq("id", run.id);
    if (updateError) throw new Error(updateError.message);
    return Response.json({ ok: true, graph: parsedGraph, model: generated.model });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "DeepSeek商品属性解析失败";
    await db
      .from("sourcing_runs")
      .update({
        criteria: {
          ...criteria,
          pipeline: {
            ...pipeline,
            attributeStatus: "FAILED",
            attributeFailedAt: new Date().toISOString(),
            attributeError: message,
          },
        },
      })
      .eq("id", run.id);
    return Response.json(
      { error: message },
      { status: 502 },
    );
  }
}
