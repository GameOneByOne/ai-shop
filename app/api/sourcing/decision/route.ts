import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const product=z.object({id:z.string(),normalizedName:z.string(),supplierName:z.string(),sourceUrl:z.string().url(),directionId:z.string(),ruleScore:z.number(),aiScore:z.number().optional(),dataConfidence:z.number(),verificationNeeded:z.array(z.string()),supportsDropshipping:z.boolean(),supportsPrivacyDropshipping:z.boolean().nullable(),taskRelevance:z.enum(["PRIMARY","ADJACENT_OPPORTUNITY","UNRELATED","UNKNOWN"]).optional(),commercialReadiness:z.number().optional(),reviewId:z.string().optional()});
const sku=z.object({id:z.string(),specName:z.string(),price:z.number().positive(),priceStatus:z.enum(["VERIFIED","HIGH_CONFIDENCE"]),shippingFee:z.number().nonnegative().nullable(),promotionDiscount:z.number().nonnegative().nullable(),dropshipMoq:z.number().int().positive().nullable(),wholesaleMoq:z.number().int().positive().nullable()});
const schema=z.object({sourceOfferId:z.string().uuid(),action:z.enum(["candidate","ignored"]),sourceProduct:product.optional(),sourceSku:sku.optional()});

function semanticAttributes(name:string){
  const structure=name.match(/(?:1|一|6|8|S|Y|T|U)\s*字?型?|直筒|双通|两通|三通|巨型/i)?.[0]??null;
  const rawSize=name.match(/(?:\d+(?:\.\d+)?\s*(?:cm|厘米|米)|小号|中号|大号|加大号|超大号)/i)?.[0]??null;
  const color=name.match(/彩虹|彩色|红色|黄色|蓝色|绿色|橙色|紫色|粉色|灰色|米色|白色|黑色|棕色/i)?.[0]??null;
  const role=/垫子|配件|附件|替换/.test(name)?(/替换/.test(name)?"REPLACEMENT":"ACCESSORY"):"MAIN_PRODUCT";
  return{structure,rawSize,color,role,attributes:{structure,size:rawSize,color}};
}
const signature=(value:Record<string,unknown>)=>Object.entries(value).filter(([,v])=>v!=null&&v!=="").sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}:${String(v).toLowerCase().replace(/\s+/g,"")}`).join("|")||"default";

export async function POST(request:Request){
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"决策参数无效",issues:parsed.error.flatten()},{status:400});
  const db=await createClient(),{data:auth}=await db.auth.getUser();
  if(!auth.user)return Response.json({error:"请先登录"},{status:401});
  const userId=auth.user.id;
  const {data:captured,error}=await db.from("source_products").select("*").eq("id",parsed.data.sourceOfferId).eq("user_id",userId).single();
  if(error||!captured)return Response.json({error:"货源不存在"},{status:404});
  if(parsed.data.action==="ignored"){
    const {error:updateError}=await db.from("source_products").update({decision_status:"ignored"}).eq("id",captured.id);
    return updateError?Response.json({error:updateError.message},{status:500}):Response.json({ok:true,decisionStatus:"ignored"});
  }
  if(!parsed.data.sourceProduct||!parsed.data.sourceSku)return Response.json({error:"必须选择具体 SourceProduct 与 SourceSku"},{status:400});
  const p=parsed.data.sourceProduct,s=parsed.data.sourceSku,semantic=semanticAttributes(s.specName),landedCost=s.price+(s.shippingFee??0)-(s.promotionDiscount??0);

  await db.from("store_profiles").upsert({user_id:userId},{onConflict:"user_id",ignoreDuplicates:true});
  const {data:strategy}=await db.from("store_profiles").select("*").eq("user_id",userId).single();
  const taskLookup=await db.from("sourcing_tasks").select("*").eq("user_id",userId).eq("query",String(captured.title)).eq("status","ACTIVE").order("created_at",{ascending:false}).limit(1).maybeSingle(),taskLookupError=taskLookup.error;let task=taskLookup.data;
  if(taskLookupError){const supplierName=String(captured.supplier_name??p.supplierName),existingSupplier=await db.from("suppliers").select("id").eq("user_id",userId).eq("name",supplierName).limit(1).maybeSingle();let supplierId=existingSupplier.data?.id;if(!supplierId){const createdSupplier=await db.from("suppliers").insert({user_id:userId,name:supplierName,platform:"1688",url:p.sourceUrl,is_demo:false,notes:"由真实 SourceSKU 候选决策建立；等待统一 Sourcing Domain 迁移"}).select("id").single();if(createdSupplier.error)return Response.json({error:createdSupplier.error.message},{status:500});supplierId=createdSupplier.data.id}const legacyTrace={sourcingRunId:captured.sourcing_run_id,sourceOfferId:captured.id,sourceOfferUrl:p.sourceUrl,sourceProductId:p.id,sourceSkuId:s.id,productModel:p.normalizedName,productVariant:s.specName,supplierId,priceStatus:s.priceStatus,dataConfidence:p.dataConfidence,verificationNeeded:p.verificationNeeded,migrationStatus:"PENDING_019"},existingCandidate=await db.from("candidate_products").select("id").eq("user_id",userId).ilike("notes",`%\"sourceSkuId\":\"${s.id}\"%`).limit(1).maybeSingle();let candidateId=existingCandidate.data?.id;if(!candidateId){const createdCandidate=await db.from("candidate_products").insert({user_id:userId,name:`${p.normalizedName} · ${s.specName}`,category:p.directionId.replace("model:",""),estimated_cost:landedCost,estimated_price:captured.estimated_sale_price_min,total_score:p.aiScore??p.ruleScore,status:"candidate",notes:`Unified Sourcing Trace (migration pending): ${JSON.stringify(legacyTrace)}`,is_demo:false}).select("id").single();if(createdCandidate.error)return Response.json({error:createdCandidate.error.message},{status:500});candidateId=createdCandidate.data.id;await db.from("supplier_products").upsert({user_id:userId,supplier_id:supplierId,candidate_product_id:candidateId,supplier_sku:s.id,purchase_price:s.price,minimum_order_quantity:s.dropshipMoq??s.wholesaleMoq,supports_dropshipping:p.supportsDropshipping,url:p.sourceUrl,notes:`ProductVariant: ${s.specName}`},{onConflict:"supplier_id,candidate_product_id"})}await db.from("source_products").update({decision_status:"candidate",candidate_product_id:candidateId}).eq("id",captured.id);return Response.json({ok:true,decisionStatus:"candidate",candidateId,legacyMode:true,trace:legacyTrace});}
  if(!task){const created=await db.from("sourcing_tasks").insert({user_id:userId,store_user_id:userId,name:`${captured.title} 选品任务`,query:String(captured.title),strategy_snapshot:strategy??{},data_mode:"REAL"}).select().single();if(created.error)return Response.json({error:created.error.message},{status:500});task=created.data}
  await db.from("sourcing_runs").update({sourcing_task_id:task.id,data_mode:"REAL"}).eq("id",captured.sourcing_run_id);

  const supplierKey=String(captured.supplier_name??p.supplierName).trim().toLowerCase();
  const supplierResult=await db.from("suppliers").upsert({user_id:userId,name:captured.supplier_name??p.supplierName,platform:"1688",url:p.sourceUrl,external_supplier_key:supplierKey,data_mode:"REAL",is_demo:false},{onConflict:"user_id,external_supplier_key"}).select().single();
  if(supplierResult.error)return Response.json({error:supplierResult.error.message},{status:500});
  const supplier=supplierResult.data;
  await db.from("supplier_reviews").upsert({user_id:userId,supplier_id:supplier.id,status:"PENDING",dropshipping_capabilities:{supportsDropshipping:p.supportsDropshipping,supportsPrivacyDropshipping:p.supportsPrivacyDropshipping},packaging_risks:{status:"UNVERIFIED"}},{onConflict:"user_id,supplier_id"});

  const offerResult=await db.from("source_offers").upsert({user_id:userId,sourcing_run_id:captured.sourcing_run_id,captured_source_product_id:captured.id,supplier_id:supplier.id,provider:"1688",external_offer_id:captured.external_id,source_url:p.sourceUrl,raw_title:captured.title,raw_attributes:captured.raw_data??{},raw_supplier_data:{name:captured.supplier_name},data_mode:"REAL"},{onConflict:"captured_source_product_id"}).select().single();
  if(offerResult.error)return Response.json({error:offerResult.error.message},{status:500});
  const sourceSkuResult=await db.from("source_skus").upsert({user_id:userId,source_offer_id:offerResult.data.id,external_sku_id:s.id,raw_name:s.specName,raw_properties:{sourceProductId:p.id,specName:s.specName,dropshipMoq:s.dropshipMoq,wholesaleMoq:s.wholesaleMoq},raw_price:s.price,status:"ACTIVE",data_mode:"REAL"},{onConflict:"user_id,source_offer_id,external_sku_id"}).select().single();
  if(sourceSkuResult.error)return Response.json({error:sourceSkuResult.error.message},{status:500});
  const sourceSku=sourceSkuResult.data;
  const normalized=await db.from("normalized_source_skus").upsert({user_id:userId,source_sku_id:sourceSku.id,product_family:p.normalizedName,structure:semantic.structure,raw_size:semantic.rawSize,normalized_dimensions:{},color:semantic.color,role:semantic.role,normalized_attributes:semantic.attributes,normalization_status:"RULE_PARSED",confidence:p.dataConfidence},{onConflict:"source_sku_id"}).select().single();
  if(normalized.error)return Response.json({error:normalized.error.message},{status:500});

  const modelResult=await db.from("product_models").upsert({user_id:userId,sourcing_task_id:task.id,name:p.normalizedName,product_family:p.normalizedName,structure:semantic.structure,model_attributes:{directionId:p.directionId},status:"PROPOSED",data_mode:"REAL"},{onConflict:"user_id,sourcing_task_id,name"}).select().single();
  if(modelResult.error)return Response.json({error:modelResult.error.message},{status:500});
  const attributeSignature=signature(semantic.attributes);
  const variantResult=await db.from("product_variants").upsert({user_id:userId,product_model_id:modelResult.data.id,name:s.specName,attribute_signature:attributeSignature,normalized_attributes:semantic.attributes,price_status:"PARTIALLY_VERIFIED",status:"PROPOSED",data_mode:"REAL"},{onConflict:"user_id,product_model_id,attribute_signature"}).select().single();
  if(variantResult.error)return Response.json({error:variantResult.error.message},{status:500});
  const variant=variantResult.data;
  const costResult=await db.from("cost_snapshots").insert({user_id:userId,source_sku_id:sourceSku.id,sku_price:s.price,one_piece_price:s.dropshipMoq===1?s.price:null,dropship_price:s.dropshipMoq===1?s.price:null,promotion_price:s.promotionDiscount?Math.max(0,s.price-s.promotionDiscount):null,shipping_cost:s.shippingFee,landed_cost:landedCost,price_status:"PARTIALLY_VERIFIED",evidence:{priceStatus:s.priceStatus,sourceProductId:p.id}}).select().single();
  if(costResult.error)return Response.json({error:costResult.error.message},{status:500});
  const {count}=await db.from("variant_source_mappings").select("id",{count:"exact",head:true}).eq("product_variant_id",variant.id).eq("mapping_role","PRIMARY").in("status",["PENDING","ACTIVE"]);
  const mappingRole=count?"BACKUP":"PRIMARY";
  const mappingResult=await db.from("variant_source_mappings").upsert({user_id:userId,product_variant_id:variant.id,source_sku_id:sourceSku.id,mapping_role:mappingRole,status:"PENDING",match_evidence:{normalizedSourceSkuId:normalized.data.id,directionId:p.directionId,verificationNeeded:p.verificationNeeded},match_confidence:p.dataConfidence,current_cost_snapshot_id:costResult.data.id,source_url:p.sourceUrl},{onConflict:"user_id,product_variant_id,source_sku_id"}).select().single();
  if(mappingResult.error)return Response.json({error:mappingResult.error.message},{status:500});
  const trace={sourcingTaskId:task.id,sourcingRunId:captured.sourcing_run_id,sourceOfferId:offerResult.data.id,sourceSkuId:sourceSku.id,normalizedSourceSkuId:normalized.data.id,productModelId:modelResult.data.id,productVariantId:variant.id,variantSourceMappingId:mappingResult.data.id,mappingRole};
  const candidateResult=await db.from("candidate_products").upsert({user_id:userId,name:`${p.normalizedName} · ${s.specName}`,category:p.directionId.replace("direction:",""),estimated_cost:landedCost,estimated_price:captured.estimated_sale_price_min,total_score:p.aiScore??p.ruleScore,status:"candidate",notes:`Unified Sourcing Trace: ${JSON.stringify(trace)}`,product_model_id:modelResult.data.id,product_variant_id:variant.id,sourcing_task_id:task.id,data_mode:"REAL",is_demo:false},{onConflict:"user_id,product_variant_id"}).select("id").single();
  if(candidateResult.error)return Response.json({error:candidateResult.error.message},{status:500});
  await db.from("sourcing_decisions").insert({user_id:userId,sourcing_task_id:task.id,product_variant_id:variant.id,decision:"ENTER_CANDIDATE",primary_mapping_id:mappingRole==="PRIMARY"?mappingResult.data.id:null,rationale:"人工从真实 1688 SourceSKU 加入候选池",evidence:trace,decided_by:"HUMAN"});
  const {error:updateError}=await db.from("source_products").update({decision_status:"candidate",candidate_product_id:candidateResult.data.id}).eq("id",captured.id);
  if(updateError)return Response.json({error:updateError.message},{status:500});
  return Response.json({ok:true,decisionStatus:"candidate",candidateId:candidateResult.data.id,...trace});
}
