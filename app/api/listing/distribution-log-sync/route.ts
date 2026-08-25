import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const rowSchema = z.object({
  offerId: z.string().regex(/^\d{8,}$/),
  status: z.enum(["SUCCESS", "FAILED", "PROCESSING", "CANCELLED"]),
  message: z.string().max(1000),
  taobaoItemId: z.string().regex(/^\d{8,}$/).nullable(),
  taobaoItemUrl: z.string().url().nullable(),
});
const schema = z.object({ rows: z.array(rowSchema).max(500) });
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function traceOf(notes: string | null) { try { return record(JSON.parse(notes ?? "{}")); } catch { return {}; } }

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "官方铺货日志格式无效" }, { status: 400 });
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const products = await db.from("candidate_products").select("id,notes").eq("user_id", auth.user.id).eq("is_demo", false);
  if (products.error) return Response.json({ error: products.error.message }, { status: 500 });
  const byOffer = new Map(parsed.data.rows.map((row) => [row.offerId, row]));
  let warehoused = 0, failed = 0, processing = 0, ignored = 0;
  for (const product of products.data ?? []) {
    const trace = traceOf(product.notes);
    const offerId = typeof trace.externalOfferId === "string" ? trace.externalOfferId : "";
    const official = byOffer.get(offerId);
    if (!official) { ignored += 1; continue; }
    const listing = record(trace.listing), syncedAt = new Date().toISOString();
    let next: Record<string, unknown>;
    if (official.status === "SUCCESS") {
      warehoused += 1;
      next = { ...listing, status: "WAREHOUSED", channel: "TAOBAO", officialStatus: "SUCCESS", officialSyncedAt: syncedAt, warehousedAt: syncedAt, taobaoItemId: official.taobaoItemId, taobaoItemUrl: official.taobaoItemUrl, error: null };
    } else if (official.status === "FAILED" || official.status === "CANCELLED") {
      failed += 1;
      next = { ...listing, status: "FAILED", officialStatus: official.status, officialSyncedAt: syncedAt, failedAt: syncedAt, error: official.message, taobaoItemId: null, taobaoItemUrl: null };
    } else {
      processing += 1;
      next = { ...listing, status: "SUBMITTED", officialStatus: official.status, officialSyncedAt: syncedAt, error: null, taobaoItemId: null, taobaoItemUrl: null };
    }
    const update = await db.from("candidate_products").update({ notes: JSON.stringify({ ...trace, listing: next }) }).eq("id", product.id).eq("user_id", auth.user.id);
    if (update.error) return Response.json({ error: update.error.message }, { status: 500 });
  }
  return Response.json({ warehoused, failed, processing, ignored });
}
