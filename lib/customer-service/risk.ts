export type RiskLevel="low"|"medium"|"high";
const highPatterns=[/法律|起诉|律师|人身|受伤|中毒|死亡|触电|火灾|赔偿/];
const mediumPatterns=[/退款|退货|换货|投诉|纠纷|平台|质量|破损|危险|安全|吞咽|缠绕|过敏|承重/];
export function minimumRisk(question:string):RiskLevel{if(highPatterns.some(pattern=>pattern.test(question)))return"high";if(mediumPatterns.some(pattern=>pattern.test(question)))return"medium";return"low"}
export function maxRisk(left:RiskLevel,right:RiskLevel):RiskLevel{const rank={low:0,medium:1,high:2};return rank[left]>=rank[right]?left:right}
