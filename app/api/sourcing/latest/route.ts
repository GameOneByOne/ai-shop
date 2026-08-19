import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: run, error } = await db
    .from("sourcing_runs")
    .select("*")
    .eq("provider", "1688-browser")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!run) return Response.json({ runId: null, products: [], picks: [], stats: null });
  const { data: products, error: productsError } = await db
    .from("source_products")
    .select("*")
    .eq("sourcing_run_id", run.id)
    .order("rough_score", { ascending: false });
  if (productsError) return Response.json({ error: productsError.message }, { status: 500 });
  const rows = products || [];
  const picks = rows
    .filter((item) => item.selected && item.ai_rank)
    .sort((a, b) => a.ai_rank - b.ai_rank)
    .map((item) => ({
      id: item.id,
      score: Number(item.ai_score || item.rough_score || 0),
      ruleScore: Number(item.rough_score || 0),
      qualitativeScore: Math.max(0, Number(item.ai_score || 0) - Math.round(Number(item.rough_score || 0) * 0.7)),
      reason: item.ai_reason || "",
      risks: item.ai_risks || [],
      checks: [],
      scoreBreakdown: item.score_breakdown || {},
    }));
  return Response.json({
    runId: run.id,
    query: run.query,
    keywords: run.keywords || [],
    products: rows,
    picks,
    stats: {
      pages: run.pages_fetched,
      fetched: run.fetched_count,
      unique: run.unique_count,
      relevant: rows.length,
      dataErrors: rows.filter((item) => item.data_status === "data_error").length,
      rejected: rows.filter((item) => item.data_status === "rejected").length,
      clusters: run.cluster_count,
      eligible: run.eligible_count,
    },
  });
}
