import { z } from "zod";

export const sourcingSelectionInputSchema = z.object({
  runId: z.uuid(),
  offerIds: z.array(z.uuid()).length(1).optional(),
});

export const sourcingOfferJudgementSchema = z.object({
  offerId: z.uuid(),
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
