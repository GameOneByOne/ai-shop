export interface SourcingCriteria{maxItems:number;roughLimit:number;aiLimit:number;maxCost:number;minMarginRate:number;maxMoq:number;excludeElectronics:boolean;excludeFood:boolean;excludeFragile:boolean}
export interface SourceProduct{externalId?:string;sourceUrl:string;title:string;supplierName?:string;imageUrl?:string;priceMin?:number;priceMax?:number;minimumOrderQuantity?:number;salesHint?:string;location?:string;rawData?:Record<string,unknown>}
export interface ScoredSourceProduct extends SourceProduct{roughScore:number;roughReasons:string[];rejectedReasons:string[]}
export interface SourcingProvider{readonly id:string;search(query:string,limit:number):Promise<SourceProduct[]>}
