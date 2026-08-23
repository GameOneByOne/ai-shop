import Link from "next/link";
import { requireUser } from "@/lib/data/auth";
import { createClient } from "@/lib/supabase/server";
import { publishListing, saveListingSettings } from "./actions";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const traceOf = (notes: string | null) => { try { return record(JSON.parse(notes ?? "{}")); } catch { return {}; } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(), db = await createClient(), query = await searchParams;
  const productId = typeof query.product === "string" ? query.product : "", saved = query.saved === "1", completed = query.completed === "1";
  const { data: product, error } = productId ? await db.from("candidate_products").select("id,name,category,notes,estimated_cost").eq("id", productId).eq("user_id", user.id).eq("is_demo", false).single() : { data: null, error: null };
  if (!productId || error || !product) return <section className="v2-workbench-empty"><div className="v2-empty-copy"><div><h2>请选择需要铺货的商品</h2><p>从商品中心点击“立即铺货”进入设置。</p></div></div><Link className="v2-primary" href="/products/manage">返回商品中心</Link></section>;
  const trace = traceOf(product.notes), listing = record(trace.listing), image = typeof trace.imageUrl === "string" ? trace.imageUrl : null;
  const supplier = typeof trace.supplierName === "string" ? trace.supplierName : "供应商待确认", offerId = typeof trace.externalOfferId === "string" ? trace.externalOfferId : "—";
  const isListed = listing.status === "LISTED" || completed;
  return <div className="v2-page listing-settings-page">
    <div className="v2-crumb">商品中心　/　铺货设置</div>
    <header className="v2-page-head"><div><h1>{isListed ? "铺货完成" : "铺货设置"}</h1><p>保留原货源素材，只确认商品名称和分类。</p></div><Link className="v2-secondary" href="/products/manage">返回商品中心</Link></header>
    <section className="v2-card listing-source-summary">{image && <img className="v2-mini-img" src={image} alt="" />}<div><span className="eyebrow">真实 1688 货源</span><h2>{product.name}</h2><p>{supplier} · offerId {offerId}{product.estimated_cost == null ? "" : ` · ¥${Number(product.estimated_cost).toFixed(2)}`}</p></div></section>
    {isListed ? <section className="v2-card listing-complete"><span>✓</span><div><h2>商品已完成铺货</h2><p>名称与分类已保存，原货源图片、SKU 和详情素材保持不变。</p><Link className="v2-primary" href="/products/manage?stage=listed">查看已上架商品</Link></div></section> : <>
      <section className="v2-card listing-settings-card">
        <div className="pipeline-step-track listing-flow"><div className="done"><i>✓</i><span><b>选择货源</b><small>已完成</small></span></div><div className={saved ? "done" : "active"}><i>{saved ? "✓" : "2"}</i><span><b>铺货设置</b><small>{saved ? "已保存" : "名称与分类"}</small></span></div><div className={saved ? "active" : ""}><i>3</i><span><b>确认铺货</b><small>等待确认</small></span></div></div>
        <form action={saveListingSettings} className="listing-simple-form"><input type="hidden" name="id" value={product.id} /><label>商品名称<input className="input" name="name" defaultValue={product.name} required maxLength={120} /></label><label>商品分类<input className="input" name="category" defaultValue={product.category} required maxLength={80} placeholder="例如：宠物用品 / 猫抓柱" /></label><p className="muted">主图、SKU图、详情图和商品属性直接沿用已选择货源，本轮不编辑素材。</p><button className="v2-primary" type="submit">保存设置</button></form>
      </section>
      {saved && <section className="v2-card listing-confirm-card"><div><h2>设置已保存</h2><p>确认后商品进入“已上架”，本次不修改任何货源素材。</p></div><form action={publishListing}><input type="hidden" name="id" value={product.id} /><button className="v2-primary" type="submit">确认铺货</button></form></section>}
    </>}
  </div>;
}
