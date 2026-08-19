"use client";
import {useEffect,useState} from "react";

type Tab="strategy"|"procurement"|"permissions";
type Permission="read_data"|"analyze"|"source_search"|"score"|"draft_content"|"create_tasks"|"create_reports"|"publish_product"|"change_price"|"change_ad_budget"|"contact_supplier"|"delist_product"|"purchase_1688";
type Profile={store_name:string;target_customer:string;fulfillment_model:string;human_responsibility:string;stage:"startup"|"growth"|"profit";category:string;monthly_revenue_target:number;target_gross_margin:number;target_sku_min:number;target_sku_max:number;min_purchase_price:number;max_purchase_price:number;max_inventory_days:number;risk_preference:number;new_product_frequency:number;price_strategy:"profit"|"balanced"|"volume";default_moq_max:number;require_dropshipping:boolean;min_supplier_repurchase_rate:number;prefer_factory:boolean;require_return_shipping:boolean;prefer_credit_purchase:boolean;abnormal_price_policy:"manual_review"|"reject"|"conservative";unresolved_data_policy:"manual_review"|"reject";default_shipping_cost:number;default_packaging_cost:number;ai_auto_permissions:Permission[];ai_approval_permissions:Permission[]};
const permissionLabels:Record<Permission,string>={read_data:"读取经营数据",analyze:"分析店铺与 SKU",source_search:"搜索 1688 货源",score:"规则评分与聚类",draft_content:"生成标题、详情和定价草案",create_tasks:"创建任务与实验方案",create_reports:"生成日报、周报和复盘",publish_product:"淘宝正式上架",change_price:"修改线上价格",change_ad_budget:"调整广告预算",contact_supplier:"联系供应商",delist_product:"下架或清仓",purchase_1688:"1688 实际采购下单"};

export function StoreGoals(){
  const[profile,setProfile]=useState<Profile|null>(null),[tab,setTab]=useState<Tab>("strategy"),[message,setMessage]=useState("");
  useEffect(()=>{void fetch("/api/store-profile").then(r=>r.json()).then(x=>setProfile(x.profile))},[]);
  if(!profile)return <div className="card">正在读取店铺策略…</div>;
  const set=<K extends keyof Profile>(key:K,value:Profile[K])=>setProfile(current=>current?{...current,[key]:value}:current);
  const toggle=(key:"ai_auto_permissions"|"ai_approval_permissions",permission:Permission)=>set(key,profile[key].includes(permission)?profile[key].filter(x=>x!==permission):[...profile[key],permission]);
  async function save(){setMessage("保存中…");const response=await fetch("/api/store-profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(profile)}),body=await response.json();setMessage(response.ok?"设置已保存，下一次 AI 店长决策将使用新规则":body.error??"保存失败")}
  return <section className="card goal-card">
    <div className="settings-tabs" role="tablist" aria-label="店铺设置">
      <button type="button" className={tab==="strategy"?"active":""} onClick={()=>setTab("strategy")}>经营策略</button>
      <button type="button" className={tab==="procurement"?"active":""} onClick={()=>setTab("procurement")}>采购策略</button>
      <button type="button" className={tab==="permissions"?"active":""} onClick={()=>setTab("permissions")}>AI 权限</button>
    </div>
    {tab==="strategy"&&<div className="settings-pane"><div><div className="eyebrow">Store Strategy</div><h2>长期经营目标</h2><p className="muted">作为 AI 判断选品、定价、增长和淘汰的全局依据。</p></div><div className="form-grid">
      <label>店铺名称<input className="input" value={profile.store_name} onChange={e=>set("store_name",e.target.value)}/></label>
      <label>店铺阶段<select className="input" value={profile.stage} onChange={e=>set("stage",e.target.value as Profile["stage"])}><option value="startup">起店期</option><option value="growth">增长期</option><option value="profit">盈利期</option></select></label>
      <label>主营类目<input className="input" value={profile.category} onChange={e=>set("category",e.target.value)}/></label>
      <label>核心客群<input className="input" value={profile.target_customer} onChange={e=>set("target_customer",e.target.value)}/></label>
      <label>月销售额目标<input className="input" type="number" value={profile.monthly_revenue_target} onChange={e=>set("monthly_revenue_target",Number(e.target.value))}/><small>用于衡量进度，不作为强制约束。</small></label>
      <label>目标毛利率 %<input className="input" type="number" value={profile.target_gross_margin*100} onChange={e=>set("target_gross_margin",Number(e.target.value)/100)}/></label>
      <label>目标 SKU 数量<div className="range-fields"><input className="input" type="number" value={profile.target_sku_min} onChange={e=>set("target_sku_min",Number(e.target.value))}/><span>至</span><input className="input" type="number" value={profile.target_sku_max} onChange={e=>set("target_sku_max",Number(e.target.value))}/></div><small>软目标，AI 不会为了凑数量降低选品标准。</small></label>
      <label>目标库存周期（天）<input className="input" type="number" value={profile.max_inventory_days} onChange={e=>set("max_inventory_days",Number(e.target.value))}/></label>
      <label>价格策略<select className="input" value={profile.price_strategy} onChange={e=>set("price_strategy",e.target.value as Profile["price_strategy"])}><option value="profit">利润优先</option><option value="balanced">均衡</option><option value="volume">销量优先</option></select></label>
      <label>风险偏好：{profile.risk_preference}/100<input type="range" min="0" max="100" value={profile.risk_preference} onChange={e=>set("risk_preference",Number(e.target.value))}/><small>越低越保守，更重视数据完整与供应稳定。</small></label>
      <label>新品探索强度：{profile.new_product_frequency}/100<input type="range" min="0" max="100" value={profile.new_product_frequency} onChange={e=>set("new_product_frequency",Number(e.target.value))}/><small>越高越频繁寻找和测试新商品方向。</small></label>
    </div></div>}
    {tab==="procurement"&&<div className="settings-pane"><div><div className="eyebrow">Procurement Policy</div><h2>1688 默认采购策略</h2><p className="muted">品类任务可以覆盖这些默认值，但不能违背经营战略。</p></div><div className="form-grid">
      <label>默认采购方式<select className="input" value={profile.fulfillment_model} onChange={e=>set("fulfillment_model",e.target.value)}><option value="1688代采购/一件代发">一件代发</option><option value="1688小批备货">小批备货</option><option value="1688混合采购">混合</option></select></label>
      <label>默认采购成本范围<div className="range-fields"><input className="input" type="number" step="0.01" value={profile.min_purchase_price} onChange={e=>set("min_purchase_price",Number(e.target.value))}/><span>至</span><input className="input" type="number" step="0.01" value={profile.max_purchase_price} onChange={e=>set("max_purchase_price",Number(e.target.value))}/></div></label>
      <label>默认 MOQ 上限<input className="input" type="number" value={profile.default_moq_max} onChange={e=>set("default_moq_max",Number(e.target.value))}/></label>
      <label>供应商最低回头率 %<input className="input" type="number" value={profile.min_supplier_repurchase_rate} onChange={e=>set("min_supplier_repurchase_rate",Number(e.target.value))}/></label>
      <label>默认单单运费<input className="input" type="number" step="0.01" value={profile.default_shipping_cost} onChange={e=>set("default_shipping_cost",Number(e.target.value))}/></label>
      <label>默认包装成本<input className="input" type="number" step="0.01" value={profile.default_packaging_cost} onChange={e=>set("default_packaging_cost",Number(e.target.value))}/></label>
      <label>异常低价处理<select className="input" value={profile.abnormal_price_policy} onChange={e=>set("abnormal_price_policy",e.target.value as Profile["abnormal_price_policy"])}><option value="manual_review">进入人工核价</option><option value="conservative">采用保守成本估计</option><option value="reject">直接淘汰</option></select></label>
      <label>MOQ / SKU 未解析<select className="input" value={profile.unresolved_data_policy} onChange={e=>set("unresolved_data_policy",e.target.value as Profile["unresolved_data_policy"])}><option value="manual_review">进入人工复核</option><option value="reject">直接淘汰</option></select></label>
    </div><div className="policy-checks">
      <label><input type="checkbox" checked={profile.require_dropshipping} onChange={e=>set("require_dropshipping",e.target.checked)}/> 必须支持一件代发</label>
      <label><input type="checkbox" checked={profile.prefer_factory} onChange={e=>set("prefer_factory",e.target.checked)}/> 优先源头工厂</label>
      <label><input type="checkbox" checked={profile.require_return_shipping} onChange={e=>set("require_return_shipping",e.target.checked)}/> 要求退货包运费</label>
      <label><input type="checkbox" checked={profile.prefer_credit_purchase} onChange={e=>set("prefer_credit_purchase",e.target.checked)}/> 优先先采后付</label>
    </div></div>}
    {tab==="permissions"&&<div className="settings-pane"><div><div className="eyebrow">AI Governance</div><h2>AI 权限边界</h2><p className="muted">关闭自动权限后，相关动作将不再自动准备；关键外部动作始终需要你批准。</p></div><div className="permission-columns"><div><h3>AI 可以自动完成</h3>{profile.ai_auto_permissions.map(item=><label className="permission-row" key={item}><input type="checkbox" checked onChange={()=>toggle("ai_auto_permissions",item)}/><span>{permissionLabels[item]}</span><b>自动</b></label>)}</div><div><h3>必须人工审核</h3>{profile.ai_approval_permissions.map(item=><label className="permission-row approval-row" key={item}><input type="checkbox" checked onChange={()=>toggle("ai_approval_permissions",item)}/><span>{permissionLabels[item]}</span><b>审核</b></label>)}</div></div><div className="notice">你的固定职责：{profile.human_responsibility}。AI 只生成包含供应商、规格、数量、可持续到手成本和风险的采购单，不会自行付款。</div></div>}
    <div className="sourcing-actions"><span className="muted">{message}</span><button type="button" className="btn" onClick={()=>void save()}>保存设置</button></div>
  </section>
}
