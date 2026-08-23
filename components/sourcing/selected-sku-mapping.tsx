"use client";

import { useEffect, useState } from "react";
import type { SourcingV3Graph } from "@/lib/sourcing/v3";

export function SelectedSkuMapping({
  runId,
  modelId,
  sourceSkuId,
}: {
  runId: string;
  modelId: string;
  sourceSkuId?: string;
}) {
  const [graph, setGraph] = useState<SourcingV3Graph | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch(`/api/sourcing/latest?runId=${encodeURIComponent(runId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "读取失败");
        setGraph(body.v3 ?? null);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "读取失败"),
      );
  }, [runId]);
  if (error) return <div className="status-box error">{error}</div>;
  if (!graph) return <div className="status-box reading">正在载入所选商品…</div>;
  const model = graph.models.find((item) => item.id === modelId);
  const sources = graph.sourceSkus.filter((item) =>
    model?.sourceSkuIds.includes(item.id),
  );
  const selected = sources.find((item) => item.id === sourceSkuId);
  if (!model)
    return <div className="status-box error">所选商品或货源已失效，请返回货源发现重新选择。</div>;
  return (
    <section className="card">
      <div className="proposal-head">
        <div>
          <span className="eyebrow">刚选择的真实商品</span>
          <h2>{model.name}</h2>
          <p>{sources.length} 个可用于 SKU 映射的 1688 SourceSKU</p>
        </div>
        <span className="flow-status COMPLETED">等待建立淘宝 SKU</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>角色</th><th>SourceSKU</th><th>供应商</th><th>采购价</th><th>库存</th><th>来源</th></tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id} className={source.id === selected?.id ? "active" : ""}>
                <td><b>{source.id === selected?.id ? "已选择" : "待选择"}</b></td>
                <td>{source.rawName}</td>
                <td>{source.supplierName}</td>
                <td>{source.price == null ? "待核实" : `¥${source.price.toFixed(2)}`}</td>
                <td>{source.stock ?? "待核实"}</td>
                <td><a href={source.sourceUrl} target="_blank" rel="noreferrer">1688 ↗</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
