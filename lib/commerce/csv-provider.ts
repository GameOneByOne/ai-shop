import { parseDailyMetricsCsv } from "@/lib/csv/daily-metrics";
import type { CommerceProvider, DailyMetric, Order, Product } from "./types";

export class CsvCommerceProvider implements CommerceProvider {
  constructor(private readonly csvText: string) {}
  async getProducts(): Promise<Product[]> { return []; }
  async getDailyMetrics(date: string): Promise<DailyMetric[]> {
    const parsed = parseDailyMetricsCsv(this.csvText);
    if (parsed.issues.length) throw new Error(`CSV 存在 ${parsed.issues.length} 个校验错误`);
    return parsed.rows.filter((row) => row.date === date).map((row) => ({ skuCode: row.sku_code, date: row.date, impressions: row.impressions, clicks: row.clicks, orders: row.orders, revenue: row.revenue }));
  }
  async getOrders(): Promise<Order[]> { return []; }
}
