import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_OFFER_RULE_CONFIG } from "@/lib/sourcing/offer-filter";

const configSchema = z.object({
  requireOnePiece: z.boolean(), require1688Selection: z.boolean(), requireReturnShipping: z.boolean(), requireNoReasonReturn: z.boolean(), rejectNoSellableSku: z.boolean(), requireSingleOrder: z.boolean(), rejectInvalidProduct: z.boolean(), rejectMissingCriticalData: z.boolean(),
  pickup48Min: z.number().min(0).max(100), qualityMin: z.number().min(0).max(100),
  reviewCountMin: z.number().int().min(0).max(100000), productFavoriteMin: z.number().int().min(0).max(100000000), positiveReviewMin: z.number().min(0).max(100),
});
const postSchema = z.object({ runId: z.string().uuid(), config: configSchema });
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return Response.json({ error: "缺少货源任务ID" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data, error } = await db.from("sourcing_runs").select("criteria").eq("id", runId).eq("user_id", auth.user.id).single();
  if (error || !data) return Response.json({ error: "货源任务不存在" }, { status: 404 });
  const saved = record(record(data.criteria).ruleSelectionConfig);
  return Response.json({ config: { ...DEFAULT_OFFER_RULE_CONFIG, ...saved, productFavoriteMin: Number(saved.productFavoriteMin ?? saved.shopFavoriteMin ?? DEFAULT_OFFER_RULE_CONFIG.productFavoriteMin) } });
}

export async function POST(request: Request) {
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "规则配置无效" }, { status: 400 });
  const db = await createClient(), { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data, error } = await db.from("sourcing_runs").select("criteria").eq("id", parsed.data.runId).eq("user_id", auth.user.id).single();
  if (error || !data) return Response.json({ error: "货源任务不存在" }, { status: 404 });
  const criteria = record(data.criteria);
  const updated = await db.from("sourcing_runs").update({ criteria: { ...criteria, ruleSelectionConfig: { ...parsed.data.config, version: "stable-dropship-v3", savedAt: new Date().toISOString() } } }).eq("id", parsed.data.runId).eq("user_id", auth.user.id);
  if (updated.error) return Response.json({ error: updated.error.message }, { status: 500 });
  return Response.json({ ok: true, config: parsed.data.config });
}
