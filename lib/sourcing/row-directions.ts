import type { DirectionSourceProduct } from "./directions";
import { parseSourceProducts, type RawSourceOption, type SourceProductRecord } from "./source-products";

export function sourceProductsFromRows(rows:Record<string,unknown>[]):DirectionSourceProduct[]{
  return rows.flatMap(row=>{
    const raw=(row.raw_data??{})as Record<string,unknown>,detail=(raw.detailEnrichment??{})as Record<string,unknown>,capabilities=(detail.capabilities??{})as Record<string,unknown>;
    let products=Array.isArray(detail.sourceProducts)?detail.sourceProducts as SourceProductRecord[]:[];
    if(!products.length&&Array.isArray(detail.variants))products=parseSourceProducts({sourceOfferId:String(row.id),externalOfferId:String(row.external_id??row.id),supportsDropshipping:capabilities.dropshipping==null?null:Boolean(capabilities.dropshipping),onePiecePrice:capabilities.onePiecePrice==null?null:Boolean(capabilities.onePiecePrice),options:detail.variants as RawSourceOption[]}).products;
    return products.map(product=>({...product,source_url:String(row.source_url),supplier_name:row.supplier_name?String(row.supplier_name):null,return_shipping:row.return_shipping==null?null:Boolean(row.return_shipping),pay_later:row.pay_later==null?null:Boolean(row.pay_later),supports_dropshipping:capabilities.dropshipping==null?null:Boolean(capabilities.dropshipping),supports_privacy_dropshipping:capabilities.encryptedDropshipping==null?null:Boolean(capabilities.encryptedDropshipping),shipping_quote:((detail.pricingContext??{})as Record<string,unknown>).shippingQuote==null?null:Number(((detail.pricingContext??{})as Record<string,unknown>).shippingQuote),sales_count:row.sales_count==null?null:Number(row.sales_count),repurchase_rate:row.repurchase_rate==null?null:Number(row.repurchase_rate),rough_score:Number(row.rough_score??0),score_breakdown:(row.score_breakdown??{})as Record<string,number>,data_issues:Array.isArray(row.data_issues)?row.data_issues.map(String):[]}));
  });
}
