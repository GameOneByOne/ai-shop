"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/data/auth";
import { createClient } from "@/lib/supabase/server";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function traceOf(notes: string | null) { try { return record(JSON.parse(notes ?? "{}")); } catch { return {}; } }
async function ownedProduct(id: string) {
  const user = await requireUser(), db = await createClient();
  const { data, error } = await db.from("candidate_products").select("id,notes").eq("id", id).eq("user_id", user.id).eq("is_demo", false).single();
  if (error || !data) throw new Error("商品不存在或无权操作");
  return { db, data };
}

export async function saveListingSettings(formData: FormData) {
  const id = String(formData.get("id") ?? ""), name = String(formData.get("name") ?? "").trim(), category = String(formData.get("category") ?? "").trim();
  if (!id || !name || !category) throw new Error("商品名称和分类不能为空");
  const { db, data } = await ownedProduct(id), trace = traceOf(data.notes), now = new Date().toISOString();
  const { error } = await db.from("candidate_products").update({ name, category, notes: JSON.stringify({ ...trace, listing: { ...record(trace.listing), status: "SETTINGS_SAVED", savedAt: now } }) }).eq("id", id);
  if (error) throw new Error(error.message);
  redirect(`/content?product=${encodeURIComponent(id)}&saved=1`);
}

export async function publishListing(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("铺货参数无效");
  const { db, data } = await ownedProduct(id), trace = traceOf(data.notes), listing = record(trace.listing);
  if (listing.status !== "SETTINGS_SAVED") throw new Error("请先保存铺货设置");
  const { error } = await db.from("candidate_products").update({ notes: JSON.stringify({ ...trace, listing: { ...listing, status: "LISTED", listedAt: new Date().toISOString(), channel: "TAOBAO" } }) }).eq("id", id);
  if (error) throw new Error(error.message);
  redirect(`/content?product=${encodeURIComponent(id)}&completed=1`);
}
