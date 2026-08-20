import Link from "next/link";
import {createClient} from "@/lib/supabase/server";
import {requireUser} from "@/lib/data/auth";
import {buildSourcingV3} from "@/lib/sourcing/v3";

const Icon=({children,tone="purple"}:{children:React.ReactNode;tone?:string})=><span className={`v2-icon ${tone}`}>{children}</span>;

export default async function ProductsOverview(){
 const user=await requireUser(),db=await createClient();
 const {data:run}=await db.from("sourcing_runs").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
 const {data:offers}=run?await db.from("source_products").select("*").eq("sourcing_run_id",run.id):{data:[]};
 const graph=buildSourcingV3((offers??[])as Record<string,unknown>[],String(run?.query??""));
 const {count:candidates}=await db.from("candidate_products").select("id",{head:true,count:"exact"}).eq("user_id",user.id).eq("is_demo",false);
 const stages=[
  {icon:"⌕",label:"搜索货源",detail:`${graph.counts.offers} 个有效 Offer`,done:graph.counts.offers>0},
  {icon:"◇",label:"解析采购 SKU",detail:`${graph.counts.sourceSkus} 个 SourceSKU`,done:graph.counts.sourceSkus>0},
  {icon:"⌑",label:"归并商品款型",detail:`${graph.counts.models} 个 ProductModel`,done:graph.counts.models>0},
  {icon:"!",label:"补全关键规格",detail:graph.counts.unknownDimensions?`${graph.counts.unknownDimensions} 个 SKU 缺尺寸`:"关键规格已完整",done:graph.counts.sourceSkus>0&&graph.counts.unknownDimensions===0},
  {icon:"⇄",label:"比较同规格货源",detail:`${graph.counts.comparableSources} 个可采购 SKU`,done:graph.counts.comparableSources>0},
  {icon:"✓",label:"形成候选商品",detail:candidates?`${candidates} 个候选商品`:"尚未选择",done:Boolean(candidates)},
 ];
 const completedStages=stages.filter(stage=>stage.done).length,currentStage=stages.find(stage=>!stage.done)?.label??"选品已完成";
 return <div className="v2-page"><div className="v2-crumb">选品中心　/　总览</div><header className="v2-page-head"><div><h1>选品中心总览</h1><p>覆盖真实货源采集、商品理解、候选决策、供应商审核与 SKU 映射准备。</p></div><div className="v2-actions"><Link className="v2-primary" href="/products/search">＋ 新建/继续选品任务</Link></div></header>
  <div className="v2-dashboard-grid"><section className="v2-card"><div className="v2-section-head"><h2>当前重点任务</h2><Link href="/products/discover">进入货源分析</Link></div>{run?<><Link className="v2-task-row" href="/products/discover"><div className="v2-thumb">🐈</div><div><b>{run.query}</b><span>当前阶段　{currentStage}</span><small>创建时间　{new Date(run.created_at).toLocaleString("zh-CN")}</small></div><span className={`v2-pill ${run.status==="failed"?"danger":"orange"}`}>{run.status==="failed"?"任务异常":"选品进行中"}</span><div><small>SourceSKU</small><b>{graph.counts.sourceSkus}</b></div><div><small>ProductModel</small><b>{graph.counts.models}</b></div><div><small>阶段进度</small><b>{completedStages} / 6</b></div><em>›</em></Link><div className="v2-task-subprogress"><div className="v2-task-subhead"><span>选品进度</span><b>当前：{currentStage}</b></div><div className="v2-flow">{stages.map((stage,index)=>{const active=stage.label===currentStage;return <div className={`v2-flow-node ${stage.done?"stage-done":active?"stage-active":"stage-pending"}`} key={stage.label}><Icon tone={active?"orange":"purple"}>{stage.done?"✓":stage.icon}</Icon><span>{stage.label}</span><strong>{stage.done?"已完成":active?"进行中":"未开始"}</strong><small>{stage.detail}</small>{index<stages.length-1&&<i>→</i>}</div>})}</div></div></>:<div className="v2-empty"><Icon>⌕</Icon><b>暂无真实选品任务</b><span>请先新建选品任务并搜索真实货源。</span></div>}</section></div>
  <style>{`
   .v2-dashboard-grid:has(.v2-task-subprogress){grid-template-columns:1fr}
   .v2-task-subprogress{margin-top:8px;padding:14px;border-top:1px solid var(--v2-line);background:#fcfcff}
   .v2-task-subhead{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11px;color:#7a8193}
   .v2-task-subhead b{color:#41485b}
   .v2-task-subprogress .v2-flow{padding:0;gap:10px}
   .v2-task-subprogress .v2-flow-node{background:#fff}
   .v2-task-subprogress .stage-done{border-color:#bdebd5;background:#f5fcf8}
   .v2-task-subprogress .stage-active{border-color:#ffc980;background:#fffaf2}
   .v2-task-subprogress .stage-pending{opacity:.68}
   .v2-task-subprogress .v2-flow-node strong{font-size:11px}
  `}</style>
 </div>;
}
