import Link from "next/link";
import { requireUser } from "@/lib/data/auth";
import { createClient } from "@/lib/supabase/server";
import { DefaultPublishTask } from "@/components/listing/default-publish-task";
import { TaobaoAutofillButton } from "@/components/listing/taobao-autofill-button";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const traceOf = (notes: string | null) => { try { return record(JSON.parse(notes ?? "{}")); } catch { return {}; } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(), db = await createClient(), query = await searchParams;
  const productId = typeof query.product === "string" ? query.product : "";
  const { data: product, error } = productId ? await db.from("candidate_products").select("id,name,category,notes,estimated_cost").eq("id", productId).eq("user_id", user.id).eq("is_demo", false).single() : { data: null, error: null };
  if (!productId || error || !product) return <section className="v2-workbench-empty"><div className="v2-empty-copy"><div><h2>请选择需要铺货的商品</h2><p>从商品中心点击“立即铺货”进入设置。</p></div></div><Link className="v2-primary" href="/products/manage">返回商品中心</Link></section>;
  const trace = traceOf(product.notes), listing = record(trace.listing), image = typeof trace.imageUrl === "string" ? trace.imageUrl : null;
  const materialMaster = record(trace.productMaterialMaster);
  const enhancement = record(listing.enhancement);
  const supplier = typeof trace.supplierName === "string" ? trace.supplierName : "供应商待确认", offerId = typeof trace.externalOfferId === "string" ? trace.externalOfferId : "—";
  const sourceTitle = typeof trace.title === "string" && trace.title.trim() ? trace.title : product.name;
  const isWarehoused = ["WAREHOUSED", "LISTED"].includes(String(listing.status)) && typeof listing.taobaoItemId === "string" && Boolean(listing.taobaoItemId);
  const taskStarted = ["PUBLISHING", "SETTINGS_SAVED"].includes(String(listing.status)) || (["WAREHOUSED", "LISTED"].includes(String(listing.status)) && !isWarehoused);
  return <div className="v2-page listing-settings-page">
    <div className="v2-crumb">商品中心　/　铺货设置</div>
    <header className="v2-page-head"><div><h1>{isWarehoused ? "铺货成功" : "铺货设置"}</h1><p>使用 1688 默认铺货模板；铺货成功后，商品按设置存放到千牛仓库。</p></div><Link className="v2-secondary" href="/products/manage">返回商品中心</Link></header>
    <section className="v2-card listing-source-summary">{image && <img className="v2-mini-img" src={image} alt="" />}<div><span className="eyebrow">真实 1688 货源</span><h2>{sourceTitle}</h2><p>{supplier} · offerId {offerId}{product.estimated_cost == null ? "" : ` · ¥${Number(product.estimated_cost).toFixed(2)}`}</p></div></section>
    {isWarehoused ? <><section className="v2-card listing-complete"><span>✓</span><div><h2>商品已进入千牛仓库</h2><p>商品已经创建，但尚未正式发布出售；铺货过程中未修改默认商品字段。</p><div className="action-buttons"><a className="v2-secondary" href={`https://item.upload.taobao.com/sell/v2/publish.htm?itemId=${listing.taobaoItemId}`} target="_blank" rel="noreferrer">打开千牛仓库商品</a><Link className="v2-secondary" href="/products/manage?stage=warehouse">查看仓库中商品</Link></div></div></section><section className="v2-card material-master-card"><div><span className="eyebrow">上架质检 + 内容增强</span><h2>{String(record(enhancement.editable).title || materialMaster.title || product.name)}</h2><p>以淘宝发布页已经填写的内容为主。AI只优化文案、检查问题和规划缺失素材，不会重建类目、SKU、价格、库存或物流。</p></div><TaobaoAutofillButton productId={product.id} itemId={String(listing.taobaoItemId)} initialEnhancement={Object.keys(enhancement).length ? enhancement : undefined} /></section></> : <>
      <section className="v2-card listing-task-card">
        <div className="pipeline-step-track listing-flow"><div className="done"><i>✓</i><span><b>选择货源</b><small>已完成</small></span></div><div className={taskStarted ? "done" : "active"}><i>{taskStarted ? "✓" : "2"}</i><span><b>默认模板铺货</b><small>{taskStarted ? "进行中" : "等待开始"}</small></span></div><div className={taskStarted ? "active" : ""}><i>3</i><span><b>同步铺货结果</b><small>获取淘宝商品 ID</small></span></div></div>
        <div className="listing-task-body"><DefaultPublishTask productId={product.id} started={taskStarted} /><details className="listing-task-rules"><summary><span><b>默认模板执行规则</b><small>自动铺货不会修改商品内容</small></span><i>查看规则</i></summary><ul><li>使用 1688 默认铺货模板</li><li>不修改商品分类和任何类目属性</li><li>不修改标题、图片、视频、SKU、价格、库存、物流或售后</li><li>只执行选择店铺和确认铺货所需操作</li></ul></details></div>
      </section>
    </>}
  </div>;
}
