import { createClient } from "@/lib/supabase/server";
import { buildSourcingV3 } from "@/lib/sourcing/v3";
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
  const allRows = (rows ?? []) as Record<string, unknown>[],
    hasAdmissionFacts = allRows.some((item) => item.offer_facts_captured_at),
    qualifiedRows = hasAdmissionFacts
      ? allRows.filter((item) => item.offer_status === "PASS")
      : allRows,
    started = Date.now(),
    graph = buildSourcingV3(
      qualifiedRows,
      String(run.query ?? ""),
    ),
    input = {
      analysis_type: "SKU_UNDERSTANDING_V3",
      prompt_version: "sourcing-v3-rule-1",
      sourcing_run_id: run.id,
      input_references: qualifiedRows.map((x) => x.id),
    };
  const saved = await db
    .from("ai_runs")
    .insert({
      user_id: auth.user.id,
      type: "SKU_UNDERSTANDING_V3",
      model: "parser-rule-v3",
      input_json: input,
      output_json: graph,
      status: "success",
      latency_ms: Date.now() - started,
      adopted: false,
    })
    .select("id")
    .single();
  if (saved.error)
    return Response.json({ error: saved.error.message }, { status: 500 });
  await db
    .from("ai_analyses")
    .insert({
      user_id: auth.user.id,
      ai_run_id: saved.data.id,
      analysis_type: "SKU_UNDERSTANDING_V3",
      result: {
        confidence: graph.sourceSkus.length
          ? Math.round(
              graph.sourceSkus.reduce((n, x) => n + x.confidence, 0) /
                graph.sourceSkus.length,
            ) / 100
          : 0,
        evidence: graph.models.flatMap((x) => x.evidence),
        counts: graph.counts,
      },
      adopted: false,
    });
  return Response.json({ ok: true, analysisRunId: saved.data.id, graph });
}
