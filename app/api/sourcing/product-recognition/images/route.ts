import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { downloadAiImage, readAiImageCache } from "@/lib/sourcing/ai-image-cache";

export const maxDuration = 180;
const schema = z.object({ runId: z.string().uuid(), offerIds: z.array(z.string().uuid()).min(1).max(100) });
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "分析图片准备参数无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data, error } = await db.from("source_products").select("id,image_url,raw_data").eq("user_id", auth.user.id).eq("sourcing_run_id", parsed.data.runId).in("id", parsed.data.offerIds);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []).filter((row) => {
    const raw = record(row.raw_data), rule = record(raw.ruleSelection), selection = record(raw.sourcingSelection);
    return (rule.decision === "PASSED" || selection.ruleOverride === true) && selection.status !== "REJECTED";
  });
  const failures: Array<{ offerId: string; error: string }> = [];
  let prepared = 0, cached = 0;
  for (let offset = 0; offset < rows.length; offset += 5) {
    await Promise.all(rows.slice(offset, offset + 5).map(async (row) => {
      const raw = record(row.raw_data), detail = record(raw.detailEnrichment), mainImages = Array.isArray(detail.mainImages) ? detail.mainImages : [],
        sourceUrl = typeof mainImages[0] === "string" ? mainImages[0] : typeof row.image_url === "string" ? row.image_url : null;
      if (!sourceUrl) { failures.push({ offerId: row.id, error: "没有可用主图" }); return; }
      if (readAiImageCache(raw.aiImageCache, sourceUrl)) { cached += 1; return; }
      try {
        const aiImageCache = await downloadAiImage(sourceUrl);
        const updated = await db.from("source_products").update({ raw_data: { ...raw, aiImageCache } }).eq("id", row.id).eq("user_id", auth.user!.id);
        if (updated.error) throw new Error(updated.error.message);
        prepared += 1;
      } catch (reason) {
        failures.push({ offerId: row.id, error: reason instanceof Error ? reason.message : "主图准备失败" });
      }
    }));
  }
  return Response.json({ ok: true, total: rows.length, prepared, cached, failures });
}
