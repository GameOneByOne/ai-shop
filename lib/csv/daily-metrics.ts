import { z } from "zod";

export const DAILY_METRIC_HEADERS = ["date", "sku_code", "impressions", "clicks", "visitors", "favorites", "add_to_cart", "orders", "units_sold", "revenue", "refund_orders", "refund_amount", "ad_spend"] as const;
const integerFields = ["impressions", "clicks", "visitors", "favorites", "add_to_cart", "orders", "units_sold", "refund_orders"] as const;
const moneyFields = ["revenue", "refund_amount", "ad_spend"] as const;

export type DailyMetricCsvRow = { date: string; sku_code: string; impressions: number; clicks: number; visitors: number; favorites: number; add_to_cart: number; orders: number; units_sold: number; revenue: number; refund_orders: number; refund_amount: number; ad_spend: number };
export interface CsvIssue { row: number; field: string; message: string }
export interface CsvParseResult { rows: DailyMetricCsvRow[]; issues: CsvIssue[]; headers: string[]; totalRows: number }

const rowSchema = z.object({
  date: z.iso.date("日期必须是 YYYY-MM-DD"), sku_code: z.string().trim().min(1, "SKU 编码不能为空").max(80),
  impressions: z.number().int().nonnegative(), clicks: z.number().int().nonnegative(), visitors: z.number().int().nonnegative(), favorites: z.number().int().nonnegative(), add_to_cart: z.number().int().nonnegative(), orders: z.number().int().nonnegative(), units_sold: z.number().int().nonnegative(), revenue: z.number().nonnegative(), refund_orders: z.number().int().nonnegative(), refund_amount: z.number().nonnegative(), ad_spend: z.number().nonnegative(),
}).superRefine((row, context) => {
  if (row.clicks > row.impressions) context.addIssue({ code: "custom", path: ["clicks"], message: "点击数不能大于曝光数" });
  if (row.orders > row.visitors) context.addIssue({ code: "custom", path: ["orders"], message: "订单数不能大于访客数" });
  if (row.refund_orders > row.orders) context.addIssue({ code: "custom", path: ["refund_orders"], message: "退款订单不能大于订单数" });
});

function splitCsvLine(line: string): string[] {
  const cells: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"') { if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; } else if (char === "," && !quoted) { cells.push(cell.trim()); cell = ""; } else cell += char; }
  cells.push(cell.trim()); return cells;
}

export function parseDailyMetricsCsv(text: string): CsvParseResult {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { rows: [], issues: [{ row: 1, field: "file", message: "CSV 文件为空" }], headers: [], totalRows: 0 };
  const headers = splitCsvLine(lines[0]); const issues: CsvIssue[] = [];
  for (const header of DAILY_METRIC_HEADERS) if (!headers.includes(header)) issues.push({ row: 1, field: header, message: "缺少必填列" });
  for (const header of headers) if (!DAILY_METRIC_HEADERS.includes(header as typeof DAILY_METRIC_HEADERS[number])) issues.push({ row: 1, field: header, message: "未知列" });
  if (issues.length > 0) return { rows: [], issues, headers, totalRows: Math.max(0, lines.length - 1) };
  const rows: DailyMetricCsvRow[] = []; const seen = new Set<string>();
  lines.slice(1).forEach((line, lineIndex) => {
    const rowNumber = lineIndex + 2; const cells = splitCsvLine(line);
    if (cells.length !== headers.length) { issues.push({ row: rowNumber, field: "row", message: `字段数量应为 ${headers.length}，实际为 ${cells.length}` }); return; }
    const raw = Object.fromEntries(headers.map((header, index) => [header, cells[index]])); const candidate: Record<string, string | number> = { date: raw.date, sku_code: raw.sku_code };
    for (const field of [...integerFields, ...moneyFields]) { const value = raw[field]; if (value === "" || !Number.isFinite(Number(value))) issues.push({ row: rowNumber, field, message: "必须是有效数字" }); else candidate[field] = Number(value); }
    const parsed = rowSchema.safeParse(candidate);
    if (!parsed.success) { for (const issue of parsed.error.issues) issues.push({ row: rowNumber, field: String(issue.path[0] ?? "row"), message: issue.message }); return; }
    const key = `${parsed.data.date}|${parsed.data.sku_code}`;
    if (seen.has(key)) { issues.push({ row: rowNumber, field: "sku_code", message: "同一日期和 SKU 在文件中重复" }); return; }
    seen.add(key); rows.push(parsed.data);
  });
  return { rows, issues, headers, totalRows: Math.max(0, lines.length - 1) };
}

export const importRequestSchema = z.object({ rows: z.array(rowSchema).min(1).max(5000) });
