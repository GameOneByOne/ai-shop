import { z } from "zod";

export const sourcingSelectionInputSchema = z.object({
  runId: z.uuid(),
  offerIds: z.array(z.uuid()).length(1).optional(),
  force: z.boolean().default(false),
  applyRules: z.boolean().default(true),
});

export const sourcingCategoryTree = {
  玩具互动: ["猫隧道", "逗猫棒", "自嗨玩具", "益智玩具", "猫薄荷木天蓼", "其他互动玩具"],
  抓挠攀爬: ["猫抓板", "猫抓柱", "猫爬架", "抓窝一体"],
  睡眠休息: ["猫窝", "猫垫猫床", "猫吊床", "多功能猫窝"],
  猫砂如厕: ["猫砂盆", "猫砂垫", "猫砂铲", "如厕耗材", "如厕收纳", "猫砂"],
  喂食饮水: ["猫碗食盆", "自动喂食器", "饮水用品", "喂食配件", "储粮用品"],
  美容护理: ["梳毛工具", "洗澡护理", "指甲护理", "口腔护理", "护理辅助"],
  居家清洁: ["毛发清洁", "家具防护", "收纳整理", "防滑防污", "环境清洁"],
  穿戴出行: ["猫包航空箱", "胸背牵引", "项圈身份", "猫咪服饰", "其他出行用品"],
} as const;
const categoryParents = Object.keys(sourcingCategoryTree) as [keyof typeof sourcingCategoryTree, ...(keyof typeof sourcingCategoryTree)[]];
const categoryChildren = Object.values(sourcingCategoryTree).flat() as [string, ...string[]];

export const sourcingModelJudgementSchema = z.object({
  offerId: z.uuid(),
  productRecognition: z.object({
    productStructure: z.enum(["single_product", "multi_product", "integrated_product", "bundle", "uncertain"]),
    standardProductName: z.string().trim().min(2).max(60).nullable(),
    recognitionBasis: z.array(z.string().trim().min(1)).max(8),
    splitRequired: z.boolean(),
    splitReason: z.string().nullable(),
  }),
  contentCategory: z.object({
    categoryParent: z.enum(categoryParents).nullable(),
    categoryChild: z.enum(categoryChildren).nullable(),
    classificationBasis: z.string().trim().min(1),
  }),
  sourceEvaluation: z.object({
    recommendation: z.enum(["recommended", "conditional", "rejected", "manual_review"]),
    dimensions: z.object({
      dropshipFit: z.enum(["优秀", "良好", "一般", "存在障碍", "不适配", "待确认"]),
      supplyStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
      fulfillmentStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
      qualityConfidence: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
      supplierStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
    }).optional(),
    positiveEvidence: z.array(z.string().trim().min(1)).max(10),
    risks: z.array(z.string().trim().min(1)).max(10),
    observations: z.array(z.string().trim().min(1)).max(10),
    missingEvidence: z.array(z.string().trim().min(1)).max(10),
    conclusion: z.string().trim().min(2),
  }),
}).superRefine((value, context) => {
  if ((value.contentCategory.categoryParent == null) !== (value.contentCategory.categoryChild == null))
    context.addIssue({ code: "custom", path: ["contentCategory"], message: "一级和二级分类必须同时为空或同时存在" });
  if (value.contentCategory.categoryParent && value.contentCategory.categoryChild && !sourcingCategoryTree[value.contentCategory.categoryParent].includes(value.contentCategory.categoryChild as never))
    context.addIssue({ code: "custom", path: ["contentCategory", "categoryChild"], message: "二级分类不属于所选一级分类" });
});
export const sourcingModelOutputSchema = z.object({ results: z.array(sourcingModelJudgementSchema).min(1).max(50) }).strict();

export const sourcingOfferJudgementSchema = z.object({
  offerId: z.uuid(),
  standardProductName: z.string().trim().min(2).max(60).nullable(),
  categoryParent: z.enum(categoryParents).nullable(),
  categoryChild: z.enum(categoryChildren).nullable(),
  productStructure: z.enum(["single_product", "multi_product", "integrated_product", "bundle", "uncertain"]).optional(),
  recognitionBasis: z.array(z.string()).optional(),
  splitRequired: z.boolean().optional(),
  splitReason: z.string().nullable().optional(),
  classificationBasis: z.string().optional(),
  observations: z.array(z.string()).optional(),
  sourceRecommendation: z.enum(["recommended", "conditional", "rejected", "manual_review"]).optional(),
  recommendation: z.enum(["RECOMMENDED", "USABLE", "CAUTIOUS", "NOT_RECOMMENDED"]),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  dimensions: z.object({
    dropshipFit: z.enum(["优秀", "良好", "一般", "存在障碍", "不适配", "待确认"]),
    supplyStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
    fulfillmentStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
    qualityConfidence: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
    supplierStability: z.enum(["优秀", "良好", "一般", "风险", "待确认"]),
  }),
  directionKey: z.string().trim().min(2).max(80),
  advantages: z.array(z.string().trim().min(1)).max(8),
  risks: z.array(z.string().trim().min(1)).max(8),
  conflicts: z.array(z.string().trim().min(1)).max(8),
  missingEvidence: z.array(z.string().trim().min(1)).max(8),
  recommendationReason: z.string().trim().min(2),
  finalAdvice: z.string().trim().min(2),
});

export const sourcingSelectionOutputSchema = z.object({ results: z.array(sourcingOfferJudgementSchema).min(1).max(50) }).strict();
export type SourcingOfferJudgement = z.infer<typeof sourcingOfferJudgementSchema>;
