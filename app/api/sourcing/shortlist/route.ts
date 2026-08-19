import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  runId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(20),
});

const aiOutputSchema = z.object({
  summary: z.string().default(""),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        qualitativeScore: z.number().min(0).max(30),
        reason: z.string(),
        risks: z.array(z.string()).default([]),
        checks: z.array(z.string()).default([]),
      }),
    )
    .max(20),
});

const cleanList = (values: string[]) =>
  values.map((value) => value.trim()).filter((value) => value.length >= 2);

export async function POST(request: Request) {
  const parsedRequest = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsedRequest.success) {
    return Response.json({ error: "细筛参数无效" }, { status: 400 });
  }

  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) {
    return Response.json({ error: "请先登录" }, { status: 401 });
  }

  const { data: products } = await db
    .from("source_products")
    .select(
      "id,title,price_min,minimum_order_quantity,supplier_name,sales_hint,sales_count,repurchase_rate,return_shipping,pay_later,dropshipping,cluster_key,rough_score,score_breakdown,estimated_sale_price_min,estimated_sale_price_max,estimated_unit_profit_min,estimated_unit_profit_max",
    )
    .eq("sourcing_run_id", parsedRequest.data.runId)
    .in("data_status", ["valid", "needs_review"])
    .eq("cluster_rank", 1)
    .order("rough_score", { ascending: false })
    .limit(20);
  if (!products?.length) {
    return Response.json({ error: "没有粗筛结果" }, { status: 422 });
  }

  const prompt = `你是猫咪居家用品店的谨慎选品经理。候选已经完成数据校验、利润计算、硬过滤和同质聚类。请从不同商品类型中最多选 ${parsedRequest.data.limit} 款进入人工复核。

只判断程序难以可靠判断的定性项目，qualitativeScore 为 0～30：
- 猫咪家庭真实需求匹配 0～10
- 视频/图文展示与卖点潜力 0～8
- 相对同类的差异化 0～6
- 材质、误食、耐用性与使用体验风险 0～6
不要重新计算价格、利润、销量、回头率、MOQ 或供应商分。

硬性要求：
1. 不得编造候选数据中没有的信息；标题中的销量、回头率等只能称为“搜索页展示值”。
2. 每款 reason 必须引用至少两个实际字段并说明取舍。
3. 每款 risks 至少 2 项，checks 至少 3 项；食品、药品、电器、易碎、吞咽风险从严。
4. 只输出 JSON：{"summary":"","items":[{"id":"UUID","qualitativeScore":0,"reason":"","risks":[""],"checks":[""]}]}。

候选数据：${JSON.stringify(products)}`;

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.deepseek.com").replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      messages: [
        { role: "system", content: "只输出合法 JSON，严格遵守评分规则。" },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: body.error?.message ?? "AI 请求失败" },
      { status: 502 },
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(body.choices?.[0]?.message?.content ?? "");
  } catch {
    return Response.json({ error: "AI 未返回合法 JSON" }, { status: 502 });
  }
  const parsedOutput = aiOutputSchema.safeParse(value);
  if (!parsedOutput.success) {
    return Response.json({ error: "AI 结果校验失败" }, { status: 502 });
  }

  const allowed = new Set(products.map((product) => product.id));
  const chosen = parsedOutput.data.items
    .filter((item) => allowed.has(item.id))
    .map((item) => {
      const product = products.find((candidate) => candidate.id === item.id)!;
      const ruleScore = Number(product.rough_score || 0);
      return {
        ...item,
        ruleScore,
        score: Math.min(
          100,
          Math.round(ruleScore * 0.7 + item.qualitativeScore),
        ),
        scoreBreakdown: product.score_breakdown,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, parsedRequest.data.limit)
    .map((item) => {
      const risks = cleanList(item.risks);
      const checks = cleanList(item.checks);
      return {
        ...item,
        reason: item.reason.trim() || "需结合详情页完成进一步判断",
        risks:
          risks.length >= 2
            ? risks
            : ["搜索页信息可能与详情页不一致", "材质与售后数据尚未核验"],
        checks:
          checks.length >= 3
            ? checks
            : ["核对阶梯价与起订量", "索取材质及质检证明", "确认退换货与代发条件"],
      };
    });

  await db
    .from("source_products")
    .update({ selected: false, ai_rank: null })
    .eq("sourcing_run_id", parsedRequest.data.runId);
  await Promise.all(
    chosen.map((item, index) =>
      db
        .from("source_products")
        .update({
          ai_score: item.score,
          ai_rank: index + 1,
          ai_reason: item.reason,
          ai_risks: item.risks,
          selected: true,
        })
        .eq("id", item.id),
    ),
  );

  return Response.json({
    summary: parsedOutput.data.summary,
    items: chosen,
    model: body.model,
  });
}
