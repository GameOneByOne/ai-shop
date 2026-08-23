import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numberValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const booleanValue = (value: unknown) => typeof value === "boolean" ? value : null;

const schema = z.object({
  runId: z.string().uuid(),
  offerId: z.string().uuid(),
  status: z.enum(["CANDIDATE", "PRIMARY", "BACKUP", "REJECTED"]),
  rejectionReason: z.string().trim().min(2).max(300).optional(),
}).superRefine((value, context) => {
  if (value.status === "REJECTED" && !value.rejectionReason) context.addIssue({ code: "custom", path: ["rejectionReason"], message: "人工淘汰必须填写原因" });
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "货源状态参数无效" }, { status: 400 });
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { data: rows, error } = await db
    .from("source_products")
    // Admission fields are not available in every deployed database. Their
    // compatible source of truth is raw_data.offerFacts.
    .select("id,raw_data,title,image_url,supplier_name,source_url,external_id,price_min,minimum_order_quantity,sourcing_run_id")
    .eq("user_id", auth.user.id)
    .eq("sourcing_run_id", parsed.data.runId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!rows?.some((row) => row.id === parsed.data.offerId))
    return Response.json({ error: "当前搜索中找不到该货源" }, { status: 404 });
  const selectedAt = new Date().toISOString();
  const updates = rows.flatMap((row) => {
    const raw = (row.raw_data ?? {}) as Record<string, unknown>;
    const old = (raw.sourcingSelection ?? {}) as Record<string, unknown>;
    if (row.id === parsed.data.offerId)
      return [{ id: row.id, raw_data: { ...raw, sourcingSelection: { ...old, status: parsed.data.status, selectedAt, selectedBy: "HUMAN", ruleOverride: parsed.data.status === "CANDIDATE", rejectionReason: parsed.data.status === "REJECTED" ? parsed.data.rejectionReason : null } } }];
    return [];
  });
  for (const update of updates) {
    const result = await db.from("source_products").update({ raw_data: update.raw_data }).eq("id", update.id);
    if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  }
  let productId: string | null = null;
  if (parsed.data.status === "PRIMARY") {
    const offer = rows.find((row) => row.id === parsed.data.offerId)!;
    const raw = (offer.raw_data ?? {}) as Record<string, unknown>;
    const detail = (raw.detailEnrichment ?? {}) as Record<string, unknown>;
    const recognition = record(raw.productRecognition);
    const facts = record(raw.offerFacts);
    const priceMin = numberValue(facts.price) ?? numberValue(facts.onePiecePrice) ?? (offer.price_min == null ? null : Number(offer.price_min));
    const minimumOrderQuantity = numberValue(facts.minOrderQuantity) ?? offer.minimum_order_quantity;
    const trace = {
      workflowStatus: "DRAFTING",
      sourceOfferId: offer.id,
      externalOfferId: offer.external_id,
      sourceUrl: offer.source_url,
      supplierName: offer.supplier_name,
      title: offer.title,
      imageUrl: offer.image_url,
      detailImages: detail.detailImages ?? detail.detailImageUrls ?? detail.descriptionImages ?? [],
      productAttributes: detail.productAttributes ?? detail.attributes ?? detail.productProperties ?? {},
      sourceProducts: detail.sourceProducts ?? [],
      supply: { priceMin, moq: minimumOrderQuantity },
      fulfillment: {
        onePieceDelivery: booleanValue(facts.onePieceDelivery),
        blindShipping: booleanValue(facts.blindShipping),
        returnShipping: booleanValue(facts.returnShipping),
      },
      selectedAt,
    };
    const marker = `"sourceOfferId":"${offer.id}"`;
    const existing = await db.from("candidate_products").select("id").eq("user_id", auth.user.id).ilike("notes", `%${marker}%`).limit(1).maybeSingle();
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });
    productId = existing.data?.id ?? null;
    if (!productId) {
      const created = await db.from("candidate_products").insert({
        user_id: auth.user.id,
        name: String(recognition.sellingTitle ?? recognition.standardName ?? recognition.productName ?? offer.title ?? `1688 商品 ${offer.external_id ?? ""}`),
        category: String(recognition.categoryChild ?? recognition.categoryParent ?? "待分类"),
        description: "由已选择货源自动建立，进入商品中心继续完成铺货资料。",
        estimated_cost: priceMin,
        status: "approved",
        notes: JSON.stringify(trace),
        is_demo: false,
      }).select("id").single();
      if (created.error || !created.data)
        return Response.json({ error: created.error?.message ?? "创建商品中心记录失败" }, { status: 500 });
      productId = created.data.id;
    }
    const linked = await db.from("source_products").update({ candidate_product_id: productId, decision_status: "candidate" }).eq("id", offer.id);
    if (linked.error) return Response.json({ error: linked.error.message }, { status: 500 });
    const completed = await db
      .from("sourcing_runs")
      .update({ status: "completed", completed_at: selectedAt })
      .eq("id", parsed.data.runId)
      .eq("user_id", auth.user.id);
    if (completed.error)
      return Response.json({ error: completed.error.message }, { status: 500 });
  }
  return Response.json({ ok: true, status: parsed.data.status, selectedAt, productId, productHref: productId ? `/products/manage?product=${productId}` : null });
}
