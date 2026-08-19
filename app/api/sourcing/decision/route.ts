import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  id: z.string().uuid(),
  action: z.enum(["candidate", "ignored"]),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "决策参数无效" }, { status: 400 });
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: source, error } = await db
    .from("source_products")
    .select("*")
    .eq("id", parsed.data.id)
    .single();
  if (error || !source) return Response.json({ error: "货源不存在" }, { status: 404 });

  let candidateId = source.candidate_product_id as string | null;
  if (parsed.data.action === "candidate" && !candidateId) {
    const { data: candidate, error: createError } = await db
      .from("candidate_products")
      .insert({
        user_id: auth.user.id,
        name: source.title,
        category: source.cluster_key || "猫咪居家用品",
        estimated_cost: source.price_min,
        estimated_price: source.estimated_sale_price_min,
        total_score: source.ai_score || source.rough_score,
        status: "candidate",
        notes: `1688货源：${source.source_url}`,
      })
      .select("id")
      .single();
    if (createError || !candidate) {
      return Response.json({ error: createError?.message || "加入选品池失败" }, { status: 500 });
    }
    candidateId = candidate.id;
  }
  const { error: updateError } = await db
    .from("source_products")
    .update({ decision_status: parsed.data.action, candidate_product_id: candidateId })
    .eq("id", parsed.data.id);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
  return Response.json({ ok: true, decisionStatus: parsed.data.action, candidateId });
}
