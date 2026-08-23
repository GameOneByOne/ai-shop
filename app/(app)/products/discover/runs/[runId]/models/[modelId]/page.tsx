"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { SourcingV3Graph, V3SourceSku } from "@/lib/sourcing/v3";

const money = (value: number | null) =>
  value == null ? "待核实" : `¥${value.toFixed(2)}`;
const labels: Record<string, string> = {
  length_cm: "长",
  diameter_cm: "直径",
  width_cm: "宽",
  height_cm: "高",
  thickness_cm: "厚",
  weight_g: "重量",
};
const dims = (source: V3SourceSku) => {
  const values = Object.entries(source.normalizedDimensions).filter(
    ([key]) => key !== "schemaId",
  );
  return values.length
    ? values
        .map(
          ([key, value]) =>
            `${labels[key] ?? key} ${value}${key === "weight_g" ? "g" : "cm"}`,
        )
        .join(" × ")
    : "未知";
};
const missing = (source: V3SourceSku) =>
  [
    source.dimensionStatus === "UNKNOWN" && "尺寸",
    !source.color && "颜色",
    !source.material && "材质",
  ].filter(Boolean) as string[];

export default function ModelDetail() {
  const params = useParams() as Record<string, string>;
  const modelId = decodeURIComponent(params.modelId);
  const runId = params.runId;
  const [graph, setGraph] = useState<SourcingV3Graph | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch(`/api/sourcing/latest?runId=${encodeURIComponent(runId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "读取失败");
        setGraph(body.v3);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "读取失败"),
      );
  }, [runId]);

  const model = graph?.models.find((item) => item.id === modelId);
  const sources = useMemo(
    () =>
      graph?.sourceSkus.filter((item) => model?.sourceSkuIds.includes(item.id)) ??
      [],
    [graph, model],
  );
  if (error) return <div className="status-box error">{error}</div>;
  if (!graph)
    return <div className="status-box reading">正在加载商品款型…</div>;
  if (!model)
    return (
      <div className="status-box error">
        当前任务中找不到该商品款型，请返回商品款型池重新选择。
        <br />
        <Link href={`/products/discover/runs/${runId}`}>返回商品款型池</Link>
      </div>
    );

  return (
    <div className="v2-page model-decision-page">
      <div className="v2-crumb">选品中心　/　货源发现　/　{model.name}</div>
      <header className="v2-page-head">
        <div>
          <span className="eyebrow">商品款型详情</span>
          <h1>{model.name}</h1>
          <p>核对真实采购 SKU 与供应商，确认商品后进入 SKU 映射。</p>
        </div>
        <Link className="v2-secondary" href={`/products/discover/runs/${runId}`}>
          返回商品款型池
        </Link>
      </header>

      <section className="v2-model-summary">
        <div className="v2-product-img">
          {model.representativeImage ? (
            <img src={model.representativeImage} alt={model.name} />
          ) : (
            "🐈"
          )}
        </div>
        <div>
          <span>商品款型</span>
          <h2>{model.name}</h2>
          <p>
            {model.structure ?? "售卖结构待确认"} · {model.supplierCount} 家供应商 ·{" "}
            {sources.length} 个采购 SKU
          </p>
        </div>
        <dl>
          <dt>采购 SKU</dt>
          <dd>{sources.length} 个</dd>
          <dt>待补充信息</dt>
          <dd>{model.pendingCount} 项（不阻断）</dd>
        </dl>
      </section>

      <section className="v2-card specification-matrix">
        <div className="v2-section-head">
          <div>
            <span className="eyebrow">采购货源</span>
            <h2>1688 货源清单</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th>供应商</th>
                <th>采购 SKU</th>
                <th>颜色</th>
                <th>尺寸</th>
                <th>材质</th>
                <th>价格</th>
                <th>状态</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => {
                const absent = missing(source);
                return (
                  <tr key={source.id}>
                    <td><b>{source.supplierName}</b></td>
                    <td>{source.rawName}</td>
                    <td>{source.color ?? "未知"}</td>
                    <td>{dims(source)}</td>
                    <td>{source.material ?? "未知"}</td>
                    <td>
                      <b>{money(source.price)}</b>
                    </td>
                    <td>
                      <span className="v2-pill success">已采集</span>
                      {absent.length > 0 && <small>待补：{absent.join("、")}</small>}
                    </td>
                    <td>
                      <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                        1688 ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
