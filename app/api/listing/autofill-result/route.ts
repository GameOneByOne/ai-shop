import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  productId: z.uuid(),
  itemId: z.string().regex(/^\d{8,}$/),
  fields: z.record(z.string(), z.unknown()).default({}),
});
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const traceOf = (notes: string | null) => { try { return record(JSON.parse(notes ?? "{}")); } catch { return {}; } };

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "淘宝回填验证参数无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const product = await db.from("candidate_products").select("id,notes").eq("id", parsed.data.productId).eq("user_id", auth.user.id).eq("is_demo", false).single();
  if (product.error || !product.data) return Response.json({ error: "商品不存在或无权操作" }, { status: 404 });
  const trace = traceOf(product.data.notes), listing = record(trace.listing);
  if (String(listing.taobaoItemId ?? "") !== parsed.data.itemId) return Response.json({ error: "淘宝商品与当前商品不匹配" }, { status: 409 });
  const verifiedAt = new Date().toISOString();
  const update = await db.from("candidate_products").update({ notes: JSON.stringify({ ...trace, listing: { ...listing, autofill: { status: "READBACK_VERIFIED", fields: parsed.data.fields, verifiedAt } } }) }).eq("id", product.data.id).eq("user_id", auth.user.id);
  if (update.error) return Response.json({ error: update.error.message }, { status: 500 });
  return Response.json({ ok: true, status: "READBACK_VERIFIED", verifiedAt });
}
