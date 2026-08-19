import { formatPercent, formatRatio, type CalculatedMetrics } from "@/lib/analytics/metrics";

export function MetricCards({ metrics }: { metrics: CalculatedMetrics }) {
  const items = [
    ["CTR", formatPercent(metrics.ctr), "点击 / 曝光"],
    ["访客 CVR", formatPercent(metrics.visitorCvr), "订单 / 访客"],
    ["点击 CVR", formatPercent(metrics.clickCvr), "订单 / 点击"],
    ["加购率", formatPercent(metrics.addToCartRate), "加购 / 访客"],
    ["退款率", formatPercent(metrics.refundRate), "退款订单 / 订单"],
    ["ROAS", formatRatio(metrics.roas), "销售额 / 广告花费"],
    ["预估毛利", `¥${metrics.estimatedGrossProfit.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`, "未计平台佣金"],
  ];
  return <div className="metric-grid">{items.map(([label, value, hint]) => <div className="card" key={label}><span className="muted">{label}</span><div className="metric">{value}</div><small className="muted">{hint}</small></div>)}</div>;
}
