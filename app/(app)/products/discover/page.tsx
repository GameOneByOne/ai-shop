import { requireUser } from "@/lib/data/auth";
import { createClient } from "@/lib/supabase/server";
import { SourcingTaskIndex } from "@/components/sourcing/sourcing-task-index";
import { buildSourcingV3 } from "@/lib/sourcing/v3";

export default async function Page() {
  const user = await requireUser();
  const db = await createClient();
  const { data, error } = await db
    .from("sourcing_runs")
    .select(
      "id,query,status,fetched_count,eligible_count,created_at,completed_at,criteria",
    )
    .eq("user_id", user.id)
    .eq("provider", "1688-browser")
    .order("created_at", { ascending: false });
  const runIds = (data ?? []).map((run) => run.id);
  const { data: products } = runIds.length
    ? await db.from("source_products").select("*").in("sourcing_run_id", runIds)
    : { data: [] };
  const { count: candidates } = await db
    .from("candidate_products")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.id)
    .eq("is_demo", false);
  const runs = (data ?? []).map((run) => {
    const rows = (products ?? []).filter(
      (product) => product.sourcing_run_id === run.id,
    ) as Record<string, unknown>[];
    const graph = buildSourcingV3(rows, run.query);
    return {
      ...run,
      progress: {
        offers: graph.counts.offers,
        sourceSkus: graph.counts.sourceSkus,
        models: graph.counts.models,
        unknownDimensions: graph.counts.unknownDimensions,
        comparableSources: graph.counts.comparableSources,
        candidates: candidates ?? 0,
      },
    };
  });

  return (
    <SourcingTaskIndex
      runs={runs}
      error={error?.message ?? null}
    />
  );
}
