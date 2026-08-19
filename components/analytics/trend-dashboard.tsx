"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyMetricPoint } from "@/lib/analytics/trends";

type Range = 7 | 30;
const charts: Array<{ key: keyof DailyMetricPoint; title: string; color: string; suffix?: string }> = [
  { key: "impressions", title: "曝光趋势", color: "#2563eb" },
  { key: "ctr", title: "CTR 趋势", color: "#7c3aed", suffix: "%" },
  { key: "visitors", title: "访客趋势", color: "#0891b2" },
  { key: "orders", title: "订单趋势", color: "#16a34a" },
  { key: "visitorCvr", title: "访客 CVR 趋势", color: "#ca8a04", suffix: "%" },
  { key: "revenue", title: "销售额趋势", color: "#ea580c", suffix: "元" },
  { key: "refundRate", title: "退款率趋势", color: "#dc2626", suffix: "%" },
  { key: "adSpend", title: "广告投入趋势", color: "#475569", suffix: "元" },
];

export function TrendDashboard({ points }: { points: DailyMetricPoint[] }) {
  const [range, setRange] = useState<Range>(7);
  const data = useMemo(() => points.slice(-range), [points, range]);
  return <section>
    <div className="section-heading"><div><h2>经营趋势</h2><p className="muted">来自当前账户已导入的经营数据</p></div><div className="segmented" aria-label="选择统计周期">{([7, 30] as const).map(value => <button key={value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>{value} 天</button>)}</div></div>
    <div className="chart-grid">{charts.map(chart => <article className="card chart-card" key={chart.key}><h3>{chart.title}</h3><ResponsiveContainer width="100%" height={210}><LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}><CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false}/><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}/><Tooltip formatter={(value) => [`${Number(value).toLocaleString()}${chart.suffix ?? ""}`, chart.title]}/><Line type="monotone" dataKey={chart.key} stroke={chart.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }}/></LineChart></ResponsiveContainer></article>)}</div>
  </section>;
}
