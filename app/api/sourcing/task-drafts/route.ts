import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema=z.object({runId:z.string().uuid(),directionId:z.string(),name:z.string().min(2),keywords:z.array(z.string()).min(1).max(5)});
export async function POST(request:Request){
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:"任务草稿参数无效"},{status:400});
 const db=await createClient(),{data:auth}=await db.auth.getUser();if(!auth.user)return Response.json({error:"请先登录"},{status:401});
 const {data:run,error}=await db.from("sourcing_runs").select("id,criteria").eq("id",parsed.data.runId).eq("user_id",auth.user.id).single();if(error||!run)return Response.json({error:"Sourcing Run 不存在"},{status:404});
 const criteria=(run.criteria??{})as Record<string,unknown>,drafts=Array.isArray(criteria.taskDrafts)?criteria.taskDrafts as Array<Record<string,unknown>>:[],existing=drafts.find(item=>item.sourceDirectionId===parsed.data.directionId);if(existing)return Response.json({draft:existing,deduplicated:true});
 const draft={id:randomUUID(),status:"DRAFT",sourceRunId:run.id,sourceDirectionId:parsed.data.directionId,name:parsed.data.name,keywords:parsed.data.keywords,createdAt:new Date().toISOString()},next={...criteria,taskDrafts:[...drafts,draft]};
 const {error:updateError}=await db.from("sourcing_runs").update({criteria:next}).eq("id",run.id).eq("user_id",auth.user.id);if(updateError)return Response.json({error:updateError.message},{status:500});return Response.json({draft,deduplicated:false});
}
