import { z } from "zod";
import type { SourcingV3Graph } from "@/lib/sourcing/v3";

const resultSchema = z.object({
  skus: z.array(
    z.object({
      sourceSkuId: z.string(),
      optimizedName: z.string().nullable().optional(),
      attributes: z.unknown().optional(),
    }),
  ),
});

type Result = {
  skus: Array<{
    sourceSkuId: string;
    optimizedName: string | null;
    attributes: Array<{ name: string; value: string }>;
  }>;
};

function normalizeAttributes(value: unknown) {
  if (Array.isArray(value))
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? "").trim();
      const attributeValue = String(record.value ?? "").trim();
      return name && attributeValue ? [{ name, value: attributeValue }] : [];
    });
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([name, attributeValue]) => {
        const normalized = String(attributeValue ?? "").trim();
        return name.trim() && normalized ? [{ name: name.trim(), value: normalized }] : [];
      },
    );
  return [];
}

export async function parseSourceSkuAttributes(
  graph: SourcingV3Graph,
  rows: Record<string, unknown>[],
) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY");
  if (!model) throw new Error("缺少 OPENAI_MODEL");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.deepseek.com").replace(
    /\/$/,
    "",
  );
  const titleById = new Map(rows.map((row) => [String(row.id), String(row.title ?? "")]));
  const materials = graph.sourceSkus.map((sku) => ({
    sourceSkuId: sku.id,
    productName: titleById.get(sku.offerId) ?? "",
    sourceSku: sku.rawName,
  }));
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "根据给定的商品名和SourceSKU原文提取商品属性，并生成去除属性内容后的简洁SourceSKU名称。只能使用给定文字，不确定的内容留空。只输出JSON。",
        },
        {
          role: "user",
          content: `${JSON.stringify(materials)}\n输出格式：{"skus":[{"sourceSkuId":"原ID","optimizedName":"去掉属性后的SourceSKU名称","attributes":[{"name":"属性名","value":"原文属性值"}]}]}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8000,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(payload.error?.message || `DeepSeek 请求失败 (${response.status})`);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 未返回商品属性");
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new Error("DeepSeek 商品属性结果不是合法 JSON");
  }
  const parsed = resultSchema.safeParse(json);
  if (!parsed.success)
    throw new Error(`DeepSeek 商品属性结果校验失败：${parsed.error.issues[0]?.message}`);
  const normalized: Result = {
    skus: parsed.data.skus.map((item) => ({
      sourceSkuId: item.sourceSkuId,
      optimizedName: item.optimizedName?.trim() || null,
      attributes: normalizeAttributes(item.attributes),
    })),
  };
  return {
    data: normalized,
    model: payload.model ?? model,
    latencyMs: Math.round(performance.now() - started),
    usage: {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
    },
  };
}

export function applySourceSkuAttributes(graph: SourcingV3Graph, result: Result) {
  const byId = new Map(result.skus.map((item) => [item.sourceSkuId, item]));
  return {
    ...graph,
    sourceSkus: graph.sourceSkus.map((sku) => {
      const parsed = byId.get(sku.id);
      const attributes = parsed?.attributes ?? [];
      const find = (...names: string[]) =>
        attributes.find((attribute) => names.includes(attribute.name))?.value ?? null;
      return {
        ...sku,
        rawName: parsed?.optimizedName || sku.rawName,
        color: find("颜色", "色系") ?? sku.color,
        rawColor: find("颜色", "色系") ?? sku.rawColor,
        rawSize: find("尺寸", "规格", "大小", "直径", "长度", "宽度", "高度") ?? sku.rawSize,
        material: find("材质", "面料") ?? sku.material,
        rawMaterial: find("材质", "面料") ?? sku.rawMaterial,
        rawProperties: {
          ...sku.rawProperties,
          originalSourceSkuName: sku.rawName,
          deepseekAttributes: attributes,
          attributeSource: "商品名与SourceSKU文字",
        },
        feature: attributes.map((attribute) => `${attribute.name}：${attribute.value}`),
        evidence: [...sku.evidence, "DeepSeek仅从商品名与SourceSKU原文解析属性"],
      };
    }),
  };
}
