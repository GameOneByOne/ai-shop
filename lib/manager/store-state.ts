import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function buildStoreState(db:SupabaseClient,userId:string){
  const [profileResult,skusResult,suppliersResult,candidatesResult,tasksResult,experimentsResult,metricsResult]=await Promise.all([
    db.from("store_profiles").select("*").eq("user_id",userId).maybeSingle(),
    db.from("skus").select("id,status,cost,sale_price"),
    db.from("suppliers").select("id"),
    db.from("candidate_products").select("id,status"),
    db.from("tasks").select("id,status,priority,title").in("status",["todo","doing"]),
    db.from("experiments").select("id,status"),
    db.from("sku_daily_metrics").select("date,revenue,orders,refund_orders,ad_spend").order("date",{ascending:false}).limit(30),
  ]);
  const profile=profileResult.data??{store_name:"AI 猫咪居家生活用品店",target_customer:"养猫家庭",fulfillment_model:"1688代采购/一件代发",human_responsibility:"审核关键经营动作，并负责在1688完成采购下单",stage:"startup",category:"猫咪玩具与居家生活用品",monthly_revenue_target:10000,target_gross_margin:.45,target_sku_min:15,target_sku_max:25,max_purchase_price:30,max_inventory_days:30,risk_preference:30,new_product_frequency:50,price_strategy:"profit"};
  const skus=skusResult.data??[],metrics=metricsResult.data??[];
  const revenue=metrics.reduce((sum,row)=>sum+Number(row.revenue||0),0),orders=metrics.reduce((sum,row)=>sum+Number(row.orders||0),0),refunds=metrics.reduce((sum,row)=>sum+Number(row.refund_orders||0),0),adSpend=metrics.reduce((sum,row)=>sum+Number(row.ad_spend||0),0);
  const state={generated_at:new Date().toISOString(),store_name:profile.store_name,target_customer:profile.target_customer,fulfillment_model:profile.fulfillment_model,human_responsibility:profile.human_responsibility,stage:profile.stage,category:profile.category,strategy:profile,products:{total:skus.length,active:skus.filter(x=>x.status==="active").length},suppliers:{total:suppliersResult.data?.length??0},candidates:{total:candidatesResult.data?.length??0},open_tasks:{total:tasksResult.data?.length??0,p0:tasksResult.data?.filter(x=>x.priority==="P0").length??0},experiments:{active:experimentsResult.data?.filter(x=>x.status==="active").length??0},performance_30d:{revenue,orders,refund_rate:orders?refunds/orders:0,ad_spend:adSpend}};
  const observations:string[]=[];
  if(state.products.active<Number(profile.target_sku_min))observations.push(`活跃SKU ${state.products.active} 个，低于目标下限 ${profile.target_sku_min} 个`);
  if(revenue<Number(profile.monthly_revenue_target))observations.push(`近30天销售额 ¥${revenue.toFixed(2)}，低于月目标 ¥${Number(profile.monthly_revenue_target).toFixed(2)}`);
  if(state.open_tasks.p0>0)observations.push(`存在 ${state.open_tasks.p0} 个未完成 P0 任务`);
  if(orders&&state.performance_30d.refund_rate>.1)observations.push(`近30天退款率 ${(state.performance_30d.refund_rate*100).toFixed(1)}%，超过10%警戒线`);
  if(!observations.length)observations.push("当前确定性指标未触发警戒线，建议保持观察");
  return{state,observations};
}
