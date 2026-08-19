import"server-only";import{cache}from"react";import{redirect}from"next/navigation";import{createClient}from"@/lib/supabase/server";
export const getCurrentUser=cache(async()=>{const supabase=await createClient();const{data,error}=await supabase.auth.getUser();if(error||!data.user)return null;return{id:data.user.id,email:data.user.email??""}});
export async function requireUser(){const user=await getCurrentUser();if(!user)redirect("/login");return user}
