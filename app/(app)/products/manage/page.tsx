import Link from "next/link";
import { requireUser } from "@/lib/data/auth";
import { createClient } from "@/lib/supabase/server";
import { aiListingIdentity } from "@/lib/sourcing/listing-identity";

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  estimated_cost: number | null;
  notes: string | null;
  updated_at: string;
};

function traceOf(notes: string | null) {
  try {
    const value = JSON.parse(notes ?? "{}");
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const db = await createClient();
  const query = await searchParams;
  const focused = typeof query.product === "string" ? query.product : null;
  const stage = query.stage === "listed" ? "listed" : "draft";
  const result = await db.from("candidate_products")
    .select("id,name,description,estimated_cost,notes,updated_at")
    .eq("user_id", user.id).eq("is_demo", false).eq("status", "approved")
    .order("updated_at", { ascending: false });
  const realProducts = ((result.data ?? []) as ProductRow[]).filter((product) => {
    const trace = traceOf(product.notes);
    return typeof trace.sourceOfferId === "string" && typeof trace.sourceUrl === "string";
  });
  const sourceOfferIds = realProducts.map((product) => traceOf(product.notes).sourceOfferId).filter((id): id is string => typeof id === "string");
  const sourceResult = sourceOfferIds.length
    ? await db.from("source_products").select("id,raw_data").eq("user_id", user.id).in("id", sourceOfferIds)
    : { data: [], error: null };
  const aiIdentityByOffer = new Map((sourceResult.data ?? []).map((source) => [source.id, aiListingIdentity(source.raw_data)]));
  const isTrulyListed = (product: ProductRow) => { const listing = (traceOf(product.notes).listing as Record<string, unknown> | undefined); return listing?.status === "LISTED" && typeof listing.taobaoItemId === "string" && Boolean(listing.taobaoItemId); };
  const listedCount = realProducts.filter(isTrulyListed).length;
  const products = realProducts.filter((product) => isTrulyListed(product) === (stage === "listed"));
  return <>
    <header className="top"><div><div className="eyebrow">商品中心</div><h1>商品管理</h1><p className="muted">选择货源后，商品从这里完成制作、上架和后续经营。</p></div><Link className="secondary-btn button-link" href="/products/discover">继续发现货源</Link></header>
    {result.error && <div className="status-box error">商品读取失败：{result.error.message}</div>}
    <div className="v2-filter-group offer-status-tabs"><Link className={stage === "draft" ? "v2-primary" : "v2-secondary"} href="/products/manage">待铺货 ({realProducts.length - listedCount})</Link><Link className={stage === "listed" ? "v2-primary" : "v2-secondary"} href="/products/manage?stage=listed">已上架 ({listedCount})</Link></div>
    {!products.length ? <section className="v2-workbench-empty"><div className="v2-empty-copy"><div><h2>还没有待制作商品</h2><p>在货源发现中选择一个 Offer，系统会自动在这里建立商品。</p></div></div><Link className="v2-primary" href="/products/discover">前往货源发现</Link></section> : <div className="candidate-pipeline">{products.map((product) => {
      const trace = traceOf(product.notes), image = typeof trace.imageUrl === "string" ? trace.imageUrl : null;
      const supplier = typeof trace.supplierName === "string" ? trace.supplierName : null;
      const offerId = typeof trace.externalOfferId === "string" ? trace.externalOfferId : null;
      const sourceUrl = typeof trace.sourceUrl === "string" ? trace.sourceUrl : null;
      const listing = (trace.listing as Record<string, unknown> | undefined);
      const listed = listing?.status === "LISTED" && typeof listing.taobaoItemId === "string" && Boolean(listing.taobaoItemId);
      const awaitingExternalPublish = listing?.status === "SETTINGS_SAVED" || (listing?.status === "LISTED" && !listed);
      const offerIdentity = typeof trace.sourceOfferId === "string" ? aiIdentityByOffer.get(trace.sourceOfferId) : null;
      const displayName = listed ? product.name : offerIdentity?.name ?? product.name;
      return <article className={`card product-work-card${focused === product.id ? " active" : ""}`} key={product.id}>
        <div className="proposal-head"><div className="offer-product-cell">{image && <img className="v2-mini-img" src={image} alt="" />}<div><span className="eyebrow">{listed ? "已上架" : "待铺货"}</span><h2>{displayName}</h2><p className="muted">{supplier ?? "供应商已随货源保存"}{offerId ? ` · offerId ${offerId}` : ""}</p></div></div><span className={`v2-pill ${listed ? "success" : "reading"}`}>{listed ? "已上架" : "待铺货"}</span></div>
        <div className="candidate-facts"><div><span>已选货源</span><b>{offerId ?? "已绑定"}</b></div><div><span>采购价</span><b>{product.estimated_cost == null ? "—" : `¥${Number(product.estimated_cost).toFixed(2)}`}</b></div><div><span>素材</span><b>{image ? "沿用货源素材" : "货源素材待同步"}</b></div><div><span>状态</span><b>{listed ? "淘宝已上架" : awaitingExternalPublish ? "待1688铺货" : "等待设置"}</b></div></div>
        <div className="action-buttons">{sourceUrl && <a className="secondary-btn" href={sourceUrl} target="_blank" rel="noreferrer">打开1688</a>}<Link className="btn button-link" href={`/content?product=${product.id}`}>{listed ? "查看铺货结果" : "立即铺货"}</Link></div>
      </article>;
    })}</div>}
  </>;
}
