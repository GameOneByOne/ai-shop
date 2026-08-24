import { requireUser } from "@/lib/data/auth";
import { createClient } from "@/lib/supabase/server";
import { SourcingTaskIndex } from "@/components/sourcing/sourcing-task-index";

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
  const runs = (data ?? []).map((run) => {
    const rows = (products ?? []).filter(
      (product) => product.sourcing_run_id === run.id,
    ) as Record<string, unknown>[];
    const stageRows = rows.map((row) => {
      const raw = (row.raw_data ?? {}) as Record<string, unknown>;
      const rule = (raw.ruleSelection ?? {}) as Record<string, unknown>;
      const selection = (raw.sourcingSelection ?? {}) as Record<string, unknown>;
      const recognition = (raw.productRecognition ?? {}) as Record<string, unknown>;
      const ai = (raw.aiSelection ?? {}) as Record<string, unknown>;
      const detail = (raw.detailEnrichment ?? {}) as Record<string, unknown>;
      const ruleDecision = selection.ruleOverride === true && selection.status !== "REJECTED"
        ? "PASSED"
        : String(rule.decision ?? "");
      const aiEligible = ruleDecision === "PASSED" && selection.status !== "REJECTED";
      const analyzedAt = Date.parse(String(recognition.analyzedAt ?? ""));
      const detailAt = Date.parse(String(detail.capturedAt ?? ""));
      const aiCurrent = recognition.promptVersion === "offer-combined-recognition-evaluation-v4-evidence-naming"
        && Array.isArray(recognition.productGroups)
        && recognition.productGroups.length > 0
        && Boolean(ai.recommendation)
        && (!Number.isFinite(detailAt) || (Number.isFinite(analyzedAt) && analyzedAt >= detailAt));
      return { detail: Boolean(detail.capturedAt), screened: Boolean(rule.screenedAt), ruleDecision, aiEligible, aiCurrent };
    });
    const searched = rows.length || run.fetched_count || 0;
    const detailed = stageRows.filter((row) => row.detail).length;
    const screened = stageRows.filter((row) => row.screened).length;
    const passed = stageRows.filter((row) => row.ruleDecision === "PASSED").length;
    const aiCandidates = stageRows.filter((row) => row.aiEligible);
    const aiCompleted = aiCandidates.filter((row) => row.aiCurrent).length;
    return {
      ...run,
      eligible_count: rows.filter((row) => {
        const raw = (row.raw_data ?? {}) as Record<string, unknown>;
        const detail = (raw.detailEnrichment ?? {}) as Record<string, unknown>;
        return Boolean(row.offer_facts_captured_at && detail.capturedAt);
      }).length,
      hasPrimary: rows.some((row) => {
        const raw = (row.raw_data ?? {}) as Record<string, unknown>;
        const selection = (raw.sourcingSelection ?? {}) as Record<string, unknown>;
        return selection.status === "PRIMARY";
      }),
      stages: { searched, detailed, total: rows.length, screened, passed, aiCompleted, aiTotal: aiCandidates.length },
    };
  });

  return (
    <SourcingTaskIndex
      runs={runs}
      error={error?.message ?? null}
    />
  );
}
