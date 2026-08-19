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
  keywords: z.array(z.string().min(2)).min(1).max(5),
  collection: z.object({
    pagesFetched: z.number().int().min(1).max(15),
    uniqueCount: z.number().int().min(0),
    typeCount: z.number().int().min(0),
    pageStats: z.array(z.record(z.string(), z.unknown())).max(15),
  }),
  items: z.array(itemSchema).min(1).max(400),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "采集数据格式无效" }, { status: 400 });
  }
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });

  const terms = parsed.data.keywords.flatMap((keyword) => {
    const compact = keyword.replace(/\s+/g, "");
    return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2));
  });
  const relevant = parsed.data.items.filter((item) =>
    terms.some((term) => item.title.includes(term)),
  );
  if (!relevant.length) {
    return Response.json(
      { error: "当前页商品与搜索词不相关，请确认搜索结果已加载" },
      { status: 422 },
    );
  }

  const criteria = {
    priceRange: [2, 30],
    maxMoq: 10,
    minMarginRate: 0.4,
    minUnitProfit: 5,
    minRepurchaseRate: 20,
    shippingAssumption: 3,
    packagingAssumption: 0.5,
    afterSalesReserve: 0.5,
    platformAndPromotionRate: 0.16,
  };
  const rawFetched = parsed.data.collection.pageStats.reduce(
    (sum, page) => sum + Number(page.found || 0),
    0,
  );
  const evaluated = evaluateProducts(relevant);
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
    raw_data: item.rawData || {},
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
