import "server-only";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/data/auth";
type CandidateRow={id:string;name:string;status:string;estimated_cost:number|null;product_models:{name:string}|null;product_variants:{name:string;price_status:string}|null;sourcing_tasks:{name:string}|null};
type ReviewRow={id:string;status:string;packaging_risks:Record<string,unknown>;suppliers:{name:string;url:string|null}|null};
type MappingRow={id:string;mapping_role:string;status:string;source_url:string;product_variants:{name:string;price_status:string;product_models:{name:string}|null}|null;source_skus:{raw_name:string;raw_price:number|null;source_offers:{suppliers:{name:string}|null}|null}|null};

export async function RealCandidates(){
  const user=await requireUser(),db=await createClient();
  const {data:rawData}=await db.from("candidate_products").select("id,name,status,total_score,estimated_cost,product_models(name),product_variants(name,price_status),sourcing_tasks(name)").eq("user_id",user.id).eq("data_mode","REAL").order("created_at",{ascending:false}),data=rawData as unknown as CandidateRow[];
  if(!data?.length)return <div className="empty-state">REAL 选品池为空。请从货源发现选择具体 SourceSKU 后加入候选。</div>;
  return <div className="candidate-pipeline">{data.map((item)=><article className="card" key={item.id}><div className="proposal-head"><div><span className="eyebrow">REAL · Unified Store State</span><h2>{item.name}</h2><p className="muted">{item.sourcing_tasks?.name??"真实选品任务"}</p></div><span className="flow-status COMPLETED">{item.status}</span></div><div className="candidate-facts"><div><span>ProductModel</span><b>{item.product_models?.name??"待确认"}</b></div><div><span>ProductVariant</span><b>{item.product_variants?.name??"待确认"}</b></div><div><span>价格状态</span><b>{item.product_variants?.price_status??"PRICE_UNVERIFIED"}</b></div><div><span>成本快照</span><b>{item.estimated_cost==null?"待核实":`¥${Number(item.estimated_cost).toFixed(2)}`}</b></div></div><div className="action-buttons"><Link className="btn button-link" href="/suppliers">继续供应商审核</Link><Link className="text-link" href="/skus">查看 PRIMARY / BACKUP</Link></div></article>)}</div>;
}

export async function RealSupplierReviews(){
  const user=await requireUser(),db=await createClient();
  const {data:rawData}=await db.from("supplier_reviews").select("id,status,dropshipping_capabilities,packaging_risks,suppliers(name,url,platform)").eq("user_id",user.id).order("created_at",{ascending:false}),data=rawData as unknown as ReviewRow[];
  if(!data?.length)return <div className="empty-state">暂无来自 REAL 选品池的待审核供应商。</div>;
  return <div className="supplier-review-list">{data.map((review)=><article className="card" key={review.id}><div className="proposal-head"><div><span className="eyebrow">REAL · Supplier Repository</span><h2>{review.suppliers?.name??"1688 待审核供应商"}</h2></div><span className={`flow-status ${review.status==="APPROVED"?"COMPLETED":"EXCEPTION"}`}>{review.status}</span></div><p className="muted">代发能力与包装风险独立审核；不会因 Offer 评分自动通过。</p><div className="action-buttons">{review.suppliers?.url&&<a className="btn" href={review.suppliers.url} target="_blank" rel="noreferrer">查看 1688 原页面</a>}<span className="status-box">包装：{String((review.packaging_risks as Record<string,unknown>)?.status??"UNVERIFIED")}</span></div></article>)}</div>;
}

export async function RealVariantMappings(){
  const user=await requireUser(),db=await createClient();
  const {data:rawData}=await db.from("variant_source_mappings").select("id,mapping_role,status,match_confidence,source_url,product_variants(name,price_status,product_models(name)),source_skus(raw_name,raw_price,inventory,source_offers(raw_title,suppliers(name)))").eq("user_id",user.id).order("created_at",{ascending:false}),data=rawData as unknown as MappingRow[];
  if(!data?.length)return <div className="empty-state">暂无 REAL Variant Source Mapping。</div>;
  const groups=Map.groupBy(data,item=>`${item.product_variants?.product_models?.name??"商品"} · ${item.product_variants?.name??"Variant"}`);
  return <div className="mapping-list">{Array.from(groups.entries()).map(([name,mappings])=><article className="card mapping-card" key={name}><div><span className="eyebrow">REAL ProductVariant</span><h2>{name}</h2><p>价格状态：{mappings[0]?.product_variants?.price_status}</p></div>{mappings.map(mapping=><div className="mapping-stats" key={mapping.id}><span><b>{mapping.mapping_role}</b></span><span>{mapping.source_skus?.raw_name}</span><span>{mapping.source_skus?.source_offers?.suppliers?.name??"供应商待核实"}</span><span>采购价 <b>{mapping.source_skus?.raw_price==null?"待核实":`¥${Number(mapping.source_skus.raw_price).toFixed(2)}`}</b></span><span>状态 <b>{mapping.status}</b></span><a className="text-link" href={mapping.source_url} target="_blank" rel="noreferrer">查看 1688 原页面</a></div>)}</article>)}</div>;
}
