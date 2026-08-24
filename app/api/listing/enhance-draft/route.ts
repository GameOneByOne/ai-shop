import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enhanceTaobaoDraft, taobaoDraftSnapshotSchema } from "@/lib/ai/taobao-draft-enhancement";

const inputSchema = z.object({ productId: z.uuid(), snapshot: taobaoDraftSnapshotSchema });
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const traceOf = (notes: string | null) => { try { return record(JSON.parse(notes ?? "{}")); } catch { return {}; } };

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "淘宝草稿快照参数无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const product = await db.from("candidate_products").select("id,name,category,notes,estimated_cost").eq("id", parsed.data.productId).eq("user_id", auth.user.id).eq("is_demo", false).single();
  if (product.error || !product.data) return Response.json({ error: "商品不存在或无权操作" }, { status: 404 });
  const trace = traceOf(product.data.notes), listing = record(trace.listing);
  if (String(listing.taobaoItemId || "") !== parsed.data.snapshot.itemId) return Response.json({ error: "淘宝草稿与当前商品ID不匹配" }, { status: 409 });
  try {
    const result = await enhanceTaobaoDraft(parsed.data.snapshot, { name: product.data.name, category: product.data.category, estimatedCost: product.data.estimated_cost, sourceTitle: trace.title, sourceOfferId: trace.externalOfferId, sourceFacts: trace.sourceFacts, sourceSkus: trace.sourceSkus });
    const generatedAt = new Date().toISOString();
    const update = await db.from("candidate_products").update({ notes: JSON.stringify({ ...trace, listing: { ...listing, draftSnapshot: result.snapshot, draftCapturedAt: generatedAt, enhancement: { ...result.data, model: result.model, generatedAt, version: 1 } } }) }).eq("id", product.data.id).eq("user_id", auth.user.id);
    if (update.error) return Response.json({ error: update.error.message }, { status: 500 });
    return Response.json({ enhancement: result.data, model: result.model });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "淘宝草稿增强失败" }, { status: 500 });
  }
}
