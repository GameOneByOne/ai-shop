import { importRequestSchema } from "@/lib/csv/daily-metrics";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = importRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "提交的数据未通过服务端校验", details: parsed.error.flatten() }, { status: 400 });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return Response.json({ error: "尚未配置 Supabase，预览可用，但无法确认写入" }, { status: 503 });
  const supabase = await createClient(); const { data: authData } = await supabase.auth.getUser(); const user = authData.user;
  if (!user) return Response.json({ error: "登录已失效，请重新登录后导入" }, { status: 401 });
  const codes = [...new Set(parsed.data.rows.map((row) => row.sku_code))];
  const { data: skuRows, error: skuError } = await supabase.from("skus").select("id,sku_code").in("sku_code", codes);
  if (skuError) return Response.json({ error: `查询 SKU 失败：${skuError.message}` }, { status: 500 });
  const skuMap = new Map((skuRows ?? []).map((sku) => [sku.sku_code as string, sku.id as string])); const missing = codes.filter((code) => !skuMap.has(code));
  if (missing.length > 0) return Response.json({ error: `以下 SKU 不存在：${missing.join("、")}` }, { status: 400 });
  const records = parsed.data.rows.map((row) => ({ user_id: user.id, sku_id: skuMap.get(row.sku_code), date: row.date, impressions: row.impressions, clicks: row.clicks, visitors: row.visitors, favorites: row.favorites, add_to_cart: row.add_to_cart, orders: row.orders, units_sold: row.units_sold, revenue: row.revenue, refund_orders: row.refund_orders, refund_amount: row.refund_amount, ad_spend: row.ad_spend, is_demo: false }));
  const { error } = await supabase.from("sku_daily_metrics").upsert(records, { onConflict: "sku_id,date" });
  if (error) return Response.json({ error: `写入失败：${error.message}` }, { status: 500 });
  return Response.json({ imported: records.length });
}
