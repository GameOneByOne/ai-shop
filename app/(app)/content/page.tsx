import Link from "next/link";
import { requireUser } from "@/lib/data/auth";
import { createClient } from "@/lib/supabase/server";
import { aiListingIdentity } from "@/lib/sourcing/listing-identity";
import { confirmPublishedListing, saveListingSettings } from "./actions";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const traceOf = (notes: string | null) => { try { return record(JSON.parse(notes ?? "{}")); } catch { return {}; } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(), db = await createClient(), query = await searchParams;
  const productId = typeof query.product === "string" ? query.product : "", saved = query.saved === "1", completed = query.completed === "1";
  const { data: product, error } = productId ? await db.from("candidate_products").select("id,name,category,notes,estimated_cost").eq("id", productId).eq("user_id", user.id).eq("is_demo", false).single() : { data: null, error: null };
  if (!productId || error || !product) return <section className="v2-workbench-empty"><div className="v2-empty-copy"><div><h2>请选择需要铺货的商品</h2><p>从商品中心点击“立即铺货”进入设置。</p></div></div><Link className="v2-primary" href="/products/manage">返回商品中心</Link></section>;
  const trace = traceOf(product.notes), listing = record(trace.listing), image = typeof trace.imageUrl === "string" ? trace.imageUrl : null;
  const supplier = typeof trace.supplierName === "string" ? trace.supplierName : "供应商待确认", offerId = typeof trace.externalOfferId === "string" ? trace.externalOfferId : "—";
  const sourceTitle = typeof trace.title === "string" && trace.title.trim() ? trace.title : product.name;
  const isListed = listing.status === "LISTED" && typeof listing.taobaoItemId === "string" && Boolean(listing.taobaoItemId);
  const awaitingExternalPublish = listing.status === "SETTINGS_SAVED" || (listing.status === "LISTED" && !isListed);
  const sourceOfferId = typeof trace.sourceOfferId === "string" ? trace.sourceOfferId : null;
  const source = sourceOfferId ? await db.from("source_products").select("raw_data").eq("id", sourceOfferId).eq("user_id", user.id).maybeSingle() : null;
  const aiIdentity = source?.data ? aiListingIdentity(source.data.raw_data) : { name: null, category: null };
  const hasExplicitListingSettings = listing.settingsSource === "USER";
  const listingName = hasExplicitListingSettings && typeof listing.name === "string"
    ? listing.name
    : aiIdentity.name ?? product.name;
  const listingCategory = hasExplicitListingSettings && typeof listing.category === "string"
    ? listing.category
    : aiIdentity.category ?? product.category;
  return <div className="v2-page listing-settings-page">
    <div className="v2-crumb">商品中心　/　铺货设置</div>
    <header className="v2-page-head"><div><h1>{isListed ? "铺货完成" : "铺货设置"}</h1><p>保留原货源素材，只确认商品名称和分类。</p></div><Link className="v2-secondary" href="/products/manage">返回商品中心</Link></header>
    <section className="v2-card listing-source-summary">{image && <img className="v2-mini-img" src={image} alt="" />}<div><span className="eyebrow">真实 1688 货源</span><h2>{sourceTitle}</h2><p>{supplier} · offerId {offerId}{product.estimated_cost == null ? "" : ` · ¥${Number(product.estimated_cost).toFixed(2)}`}</p></div></section>
    {isListed ? <section className="v2-card listing-complete"><span>✓</span><div><h2>商品已完成铺货</h2><p>名称与分类已保存，原货源图片、SKU 和详情素材保持不变。</p><Link className="v2-primary" href="/products/manage?stage=listed">查看已上架商品</Link></div></section> : <>
      <section className="v2-card listing-settings-card">
        <div className="pipeline-step-track listing-flow"><div className="done"><i>✓</i><span><b>选择货源</b><small>已完成</small></span></div><div className={saved ? "done" : "active"}><i>{saved ? "✓" : "2"}</i><span><b>铺货设置</b><small>{saved ? "已保存" : "名称与分类"}</small></span></div><div className={saved ? "active" : ""}><i>3</i><span><b>确认铺货</b><small>等待确认</small></span></div></div>
        <form action={saveListingSettings} className="listing-simple-form"><input type="hidden" name="id" value={product.id} /><label>上架商品名称<input className="input" name="name" defaultValue={listingName} required maxLength={120} /></label><label>商品分类<input className="input" name="category" defaultValue={listingCategory} required maxLength={80} placeholder="例如：宠物用品 / 猫抓柱" /></label><p className="muted">上架名称默认使用AI售卖名称，分类默认使用AI分类；1688原始标题仅用于标识真实货源。</p><button className="v2-primary" type="submit">保存设置</button></form>
      </section>
      {(saved || awaitingExternalPublish) && <section className="v2-card listing-confirm-card"><div><h2>设置已保存，等待真实铺货</h2><p>先在1688页面完成铺货；发布成功后填写淘宝商品链接或商品ID，系统才会标记为已上架。</p>{typeof trace.sourceUrl === "string" && <a className="v2-primary" href={trace.sourceUrl} target="_blank" rel="noreferrer">打开1688立即铺货</a>}</div><form action={confirmPublishedListing} className="listing-simple-form"><input type="hidden" name="id" value={product.id} /><label>淘宝商品链接或ID<input className="input" name="taobaoReference" required placeholder="例如：https://item.taobao.com/item.htm?id=..." /></label><button className="v2-primary" type="submit">确认发布成功</button></form></section>}
    </>}
  </div>;
}
