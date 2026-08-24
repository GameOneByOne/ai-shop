import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START"), productId: z.uuid() }),
  z.object({ action: z.literal("COMPLETE"), productId: z.uuid(), taobaoItemId: z.string().regex(/^\d{8,}$/), taobaoItemUrl: z.url() }),
  z.object({ action: z.literal("FAIL"), productId: z.uuid(), error: z.string().trim().min(1).max(1000) }),
]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function traceOf(notes: string | null) { try { return record(JSON.parse(notes ?? "{}")); } catch { return {}; } }

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "铺货任务参数无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const product = await db.from("candidate_products").select("id,notes").eq("id", parsed.data.productId).eq("user_id", auth.user.id).eq("is_demo", false).single();
  if (product.error || !product.data) return Response.json({ error: "商品不存在或无权操作" }, { status: 404 });
  const trace = traceOf(product.data.notes), listing = record(trace.listing);
  if (parsed.data.action === "FAIL") {
    const update = await db.from("candidate_products").update({ notes: JSON.stringify({ ...trace, listing: { ...listing, status: "FAILED", failedAt: new Date().toISOString(), error: parsed.data.error } }) }).eq("id", parsed.data.productId).eq("user_id", auth.user.id);
    if (update.error) return Response.json({ error: update.error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  if (parsed.data.action === "START") {
    const sourceUrl = typeof trace.sourceUrl === "string" ? trace.sourceUrl : "";
    if (!/^https:\/\/(?:[^/]+\.)?1688\.com\//i.test(sourceUrl)) return Response.json({ error: "未找到有效的 1688 货源地址" }, { status: 400 });
    const update = await db.from("candidate_products").update({ notes: JSON.stringify({ ...trace, listing: { ...listing, status: "PUBLISHING", mode: "DEFAULT_TEMPLATE_UNCHANGED", startedAt: new Date().toISOString() } }) }).eq("id", parsed.data.productId).eq("user_id", auth.user.id);
    if (update.error) return Response.json({ error: update.error.message }, { status: 500 });
    return Response.json({ sourceUrl });
  }
  const update = await db.from("candidate_products").update({ notes: JSON.stringify({ ...trace, listing: { ...listing, status: "WAREHOUSED", mode: "DEFAULT_TEMPLATE_UNCHANGED", channel: "TAOBAO", warehousedAt: new Date().toISOString(), taobaoItemId: parsed.data.taobaoItemId, taobaoItemUrl: parsed.data.taobaoItemUrl } }) }).eq("id", parsed.data.productId).eq("user_id", auth.user.id);
  if (update.error) return Response.json({ error: update.error.message }, { status: 500 });
  return Response.json({ ok: true });
}
