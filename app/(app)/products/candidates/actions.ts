"use server";
import {revalidatePath} from "next/cache";
import {createClient} from "@/lib/supabase/server";
import {requireUser} from "@/lib/data/auth";

export async function saveCandidate(formData:FormData){const user=await requireUser();const supabase=await createClient();const id=String(formData.get("id")??"");const payload={user_id:user.id,name:String(formData.get("name")??"").trim(),category:String(formData.get("category")??"").trim(),total_score:Number(formData.get("score")??0),status:String(formData.get("status")??"candidate"),notes:String(formData.get("notes")??"").trim()||null,is_demo:false};if(!payload.name||!payload.category)throw new Error("商品名称和品类不能为空");const query=id?supabase.from("candidate_products").update(payload).eq("id",id):supabase.from("candidate_products").insert(payload);const{error}=await query;if(error)throw new Error(error.message);revalidatePath("/products/candidates")}
export async function deleteCandidate(formData:FormData){await requireUser();const supabase=await createClient();const{error}=await supabase.from("candidate_products").delete().eq("id",String(formData.get("id")));if(error)throw new Error(error.message);revalidatePath("/products/candidates")}
