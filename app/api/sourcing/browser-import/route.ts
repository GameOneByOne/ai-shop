import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { evaluateProducts } from "@/lib/sourcing/pipeline";

const itemSchema = z.object({
  externalId: z.string().optional(),
  title: z.string().min(2),
  sourceUrl: z.string().url(),
  supplierName: z.string().optional(),
  imageUrl: z.string().url().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  minimumOrderQuantity: z.number().int().optional(),
  salesHint: z.string().optional(),
  location: z.string().optional(),
  rawData: z.record(z.string(), z.unknown()).optional(),
});
const schema = z.object({
  query: z.string().min(2),
  keywords: z.array(z.string().min(1)).min(1),
  targetOfferCount: z.number().int().min(1).max(500),
  extensionVersion: z.string().trim().min(1).max(30).optional(),
  collection: z.object({
    pagesFetched: z.number().int().min(1).max(1500),
    uniqueCount: z.number().int().min(0),
    targetOfferCount: z.number().int().min(1).max(500).optional(),
    typeCount: z.number().int().min(0),
    pageStats: z.array(z.record(z.string(), z.unknown())).max(1500),
    appliedFilters: z.record(z.string(), z.unknown()).optional(),
  }),
  items: z.array(itemSchema).min(1).max(10000),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json({
      error: `采集数据格式无效${issue ? `：${issue.path.join(".") || "请求"} ${issue.message}` : ""}`,
    }, { status: 400 });
  }
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });

  // 搜索结果只按 Offer ID 去重；不在导入阶段进行隐藏的标题相关性过滤。
  // 用户明确选择的 1688 搜索条件已经在扩展端应用，相关性判断仅作为后续决策信息。
  const collected = parsed.data.items;

  const { data: profile } = await db
    .from("store_profiles")
    .select("min_purchase_price,max_purchase_price,target_gross_margin,default_moq_max,min_supplier_repurchase_rate,default_shipping_cost,default_packaging_cost")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const criteria = {
    priceRange: [Number(profile?.min_purchase_price ?? 2), Number(profile?.max_purchase_price ?? 30)],
    maxMoq: Number(profile?.default_moq_max ?? 5),
    minMarginRate: Number(profile?.target_gross_margin ?? .45),
    minUnitProfit: 5,
    minRepurchaseRate: Number(profile?.min_supplier_repurchase_rate ?? 20),
    shippingAssumption: Number(profile?.default_shipping_cost ?? 3),
    packagingAssumption: Number(profile?.default_packaging_cost ?? .5),
    afterSalesReserve: 0.5,
    platformAndPromotionRate: 0.16,
    targetOfferCount: parsed.data.targetOfferCount,
    extensionVersion: parsed.data.extensionVersion ?? null,
    searchFilters: parsed.data.collection.appliedFilters ?? {},
    pipeline: {
      stage1Status: "COMPLETED",
      stage1Version: 1,
      stage1CompletedAt: new Date().toISOString(),
      stage2Status: "NOT_RUN",
      stage2Version: 0,
      attributeStatus: "NOT_RUN",
      stage3Status: "NOT_RUN",
    },
  };
  const rawFetched = parsed.data.collection.pageStats.reduce(
    (sum, page) => sum + Number(page.found || 0),
    0,
  );
  const evaluated = evaluateProducts(collected, {
    minPurchasePrice: criteria.priceRange[0],
    maxPreferredPurchasePrice: criteria.priceRange[1],
    maxPreferredMoq: criteria.maxMoq,
    targetMarginRate: criteria.minMarginRate,
    minUnitProfit: criteria.minUnitProfit,
    preferredRepurchaseRate: criteria.minRepurchaseRate,
    shippingAssumption: criteria.shippingAssumption,
    packagingAssumption: criteria.packagingAssumption,
    afterSalesReserve: criteria.afterSalesReserve,
    platformAndPromotionRate: criteria.platformAndPromotionRate,
  });
  const eligible = evaluated.filter(
    (item) => ["valid", "needs_review"].includes(item.dataStatus) && item.clusterRank === 1,
  );
  const { data: run, error: runError } = await db
    .from("sourcing_runs")
    .insert({
      user_id: auth.user.id,
      provider: "1688-browser",
      query: parsed.data.query,
      keywords: parsed.data.keywords,
      status: "completed",
      criteria,
      fetched_count: rawFetched,
      pages_fetched: parsed.data.collection.pagesFetched,
      unique_count: evaluated.length,
      eligible_count: eligible.length,
      cluster_count: new Set(evaluated.map((item) => item.clusterKey)).size,
      collection_stats: parsed.data.collection,
      shortlisted_count: eligible.length,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runError || !run) {
    return Response.json({ error: runError?.message || "无法创建采集任务" }, { status: 500 });
  }

  const rows = evaluated.map((item) => ({
    user_id: auth.user!.id,
    sourcing_run_id: run.id,
    provider: "1688-browser",
    external_id: item.externalId,
    source_url: item.sourceUrl,
    title: item.title,
    supplier_name: item.supplierName,
    image_url: item.imageUrl,
    price_min: item.priceMin,
    price_max: item.priceMax,
    minimum_order_quantity: item.minimumOrderQuantity,
    sales_hint: item.salesHint,
    location: item.location,
    raw_data: { ...(item.rawData || {}), searchTitle: item.title },
    data_status: item.dataStatus,
    data_issues: item.dataIssues,
    sales_count: item.salesCount,
    repurchase_rate: item.repurchaseRate,
    return_shipping: item.returnShipping,
    pay_later: item.payLater,
    dropshipping: item.dropshipping,
    cluster_key: item.clusterKey,
    cluster_rank: item.clusterRank,
    rough_score: item.score,
    score_breakdown: item.scoreBreakdown,
    rough_reasons: item.reasons,
    rejected_reasons: item.rejectedReasons,
    estimated_sale_price_min: item.estimatedSalePriceMin,
    estimated_sale_price_max: item.estimatedSalePriceMax,
    estimated_unit_profit_min: item.estimatedUnitProfitMin,
    estimated_unit_profit_max: item.estimatedUnitProfitMax,
  }));
  const { data: products, error: writeError } = await db
    .from("source_products")
    .insert(rows)
    .select("*");
  if (writeError) {
    return Response.json({ error: writeError.message }, { status: 500 });
  }
  return Response.json({
    runId: run.id,
    products,
    stats: {
      fetched: rawFetched,
      unique: evaluated.length,
      pages: parsed.data.collection.pagesFetched,
      relevant: evaluated.length,
      dataErrors: evaluated.filter((item) => item.dataStatus === "data_error").length,
      rejected: evaluated.filter((item) => item.dataStatus === "rejected").length,
      clusters: new Set(evaluated.map((item) => item.clusterKey)).size,
      eligible: eligible.length,
    },
  });
}
