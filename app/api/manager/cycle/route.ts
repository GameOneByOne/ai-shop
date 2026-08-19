import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildStoreState } from "@/lib/manager/store-state";

const schema = z.object({
  summary: z.string().default("今日经营状态已完成分析"),
  proposals: z.array(z.object({
    type: z.enum(["sourcing","content","analytics","inventory","pricing","experiment","marketing","supplier"]).catch("analytics"),
    title: z.string().min(1), evidence: z.array(z.string()).default([]),
    diagnosis: z.string().default("需要结合经营目标进一步判断"),
    recommended_action: z.string().min(1),
    priority: z.enum(["P0","P1","P2","P3"]).catch("P2"),
    permission_mode: z.enum(["auto","approval","manual_only"]).catch("approval"),
    target_route: z.string().nullable().optional().default(null),
    expected_metric: z.string().optional().default("完成任务并记录结果"),
  })),
});
type Db = Awaited<ReturnType<typeof createClient>>;
async function latest(db:Db){const{data:cycle}=await db.from("manager_cycles").select("*").order("created_at",{ascending:false}).limit(1).maybeSingle();if(!cycle)return{cycle:null,proposals:[]};const{data:proposals}=await db.from("action_proposals").select("*").eq("manager_cycle_id",cycle.id).order("created_at");return{cycle,proposals:proposals??[]}}
export async function GET(){const db=await createClient();const{data:auth}=await db.auth.getUser();if(!auth.user)return Response.json({error:"请先登录"},{status:401});return Response.json(await latest(db))}
export async function POST(){
  const db=await createClient();const{data:auth}=await db.auth.getUser();if(!auth.user)return Response.json({error:"请先登录"},{status:401});
  const{state,observations}=await buildStoreState(db,auth.user.id);
  const{data:cycle,error}=await db.from("manager_cycles").insert({user_id:auth.user.id,state_snapshot:state,observations,status:"running"}).select("id").single();
  if(error||!cycle)return Response.json({error:error?.message??"无法创建决策循环"},{status:500});
  try{
    const prompt=`你是准备在淘宝经营宠物玩具与宠物用品店的经营决策中枢。程序已计算事实，你只负责诊断和行动规划，不得改写数字。根据 StoreState 和 observations 生成最多5个行动建议。自动权限仅限查数据、分析、搜索货源、评分、创建草稿和候选任务；修改线上商品、调价、广告、联系供应商、下单、下架必须 approval 或 manual_only。每项必须有 type,title,recommended_action；其他字段缺失时系统会补默认值。只输出JSON {"summary":"","proposals":[{"type":"sourcing","title":"","evidence":[""],"diagnosis":"","recommended_action":"","priority":"P1","permission_mode":"approval","target_route":"/products/discover","expected_metric":""}]}。StoreState=${JSON.stringify(state)} observations=${JSON.stringify(observations)}`;
    const base=(process.env.OPENAI_BASE_URL||"https://api.deepseek.com").replace(/\/$/,"");
    const response=await fetch(`${base}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL,messages:[{role:"system",content:"只输出合法JSON。事实由程序提供，LLM不得重新计算。"},{role:"user",content:prompt}],response_format:{type:"json_object"},max_tokens:3500,thinking:{type:"disabled"}}),signal:AbortSignal.timeout(120000)});
    const body=await response.json();if(!response.ok)throw new Error(body.error?.message??"AI请求失败");
    const parsed=schema.safeParse(JSON.parse(body.choices?.[0]?.message?.content??""));if(!parsed.success)throw new Error(`AI行动建议未通过校验：${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    const rows=parsed.data.proposals.slice(0,5).map(item=>({user_id:auth.user!.id,manager_cycle_id:cycle.id,...item,evidence:item.evidence.length?item.evidence:observations.slice(0,2)}));
    const{data:proposals,error:writeError}=await db.from("action_proposals").insert(rows).select("*");if(writeError)throw writeError;
    await db.from("manager_cycles").update({summary:parsed.data.summary,status:"completed",model:body.model,completed_at:new Date().toISOString()}).eq("id",cycle.id);
    return Response.json({cycle:{id:cycle.id,summary:parsed.data.summary,state_snapshot:state,observations,status:"completed"},proposals});
  }catch(reason){const message=reason instanceof Error?reason.message:"决策循环失败";await db.from("manager_cycles").update({status:"failed",error:message,completed_at:new Date().toISOString()}).eq("id",cycle.id);return Response.json({error:message},{status:502})}
}
