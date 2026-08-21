"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SourcingDiscovery } from "@/components/sourcing/sourcing-discovery";

type Run = {
  id: string;
  query: string;
  status: string;
  fetched_count: number | null;
  eligible_count: number | null;
  created_at: string;
  completed_at: string | null;
  criteria: unknown;
  progress: {
    offers: number;
    sourceSkus: number;
    models: number;
    unknownDimensions: number;
    comparableSources: number;
    candidates: number;
  };
};

function stagesFor(run: Run) {
  const progress = run.progress;
  return [
    { icon: "⌕", label: "搜索货源", detail: `${progress.offers} 个有效 Offer`, done: progress.offers > 0 },
    { icon: "◇", label: "解析采购 SKU", detail: `${progress.sourceSkus} 个 SourceSKU`, done: progress.sourceSkus > 0 },
    { icon: "⌑", label: "归并商品款型", detail: `${progress.models} 个 ProductModel`, done: progress.models > 0 },
    { icon: "!", label: "补全关键规格", detail: progress.unknownDimensions ? `${progress.unknownDimensions} 个 SKU 缺尺寸` : "关键规格已完整", done: progress.sourceSkus > 0 && progress.unknownDimensions === 0 },
    { icon: "⇄", label: "比较同规格货源", detail: `${progress.comparableSources} 个可采购 SKU`, done: progress.comparableSources > 0 },
    { icon: "✓", label: "形成候选商品", detail: progress.candidates ? `${progress.candidates} 个候选商品` : "尚未选择", done: progress.candidates > 0 },
  ];
}

export function SourcingTaskIndex({
  runs,
  error,
}: {
  runs: Run[];
  error: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="v2-page sourcing-task-index">
      <div className="v2-crumb">选品中心　/　货源发现</div>
      <header className="v2-page-head">
        <div>
          <h1>货源任务</h1>
          <p>创建或选择一个货源任务，再进入搜索、商品理解、款型与采购比较。</p>
        </div>
        <button
          className="v2-primary"
          type="button"
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? "收起新建任务" : "＋ 新建货源任务"}
        </button>
      </header>

      {creating && (
        <SourcingDiscovery
          compact
          createMode
          onDataChange={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      )}

      {error && <div className="status-box error">任务读取失败：{error}</div>}
      <section className="v2-task-index-grid" aria-label="货源任务列表">
        {runs.map((run) => {
          const stages = stagesFor(run);
          const currentStage = stages.find((stage) => !stage.done)?.label ?? "选品已完成";
          return (
            <Link
              className="v2-card v2-run-card"
              href={`/products/discover/runs/${run.id}`}
              key={run.id}
            >
            <div className="v2-run-summary">
              <span className="eyebrow">货源任务</span>
              <h2>{run.query}</h2>
              <small>
                创建于 {new Date(run.created_at).toLocaleString("zh-CN")}
              </small>
              <div className="v2-task-subprogress" aria-label="选品进度">
                <div className="v2-task-subhead">
                  <span>选品进度</span>
                  <b>当前：{currentStage}</b>
                </div>
                <div className="v2-flow">
                  {stages.map((stage, index) => {
                    const active = stage.label === currentStage;
                    return (
                      <div className={`v2-flow-node ${stage.done ? "stage-done" : active ? "stage-active" : "stage-pending"}`} key={stage.label}>
                        <span className={`v2-icon ${active ? "orange" : "purple"}`}>{stage.done ? "✓" : stage.icon}</span>
                        <span>{stage.label}</span>
                        <strong>{stage.done ? "已完成" : active ? "进行中" : "未开始"}</strong>
                        <small>{stage.detail}</small>
                        {index < stages.length - 1 && <i>→</i>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <dl>
              <dt>搜索结果</dt>
              <dd>{run.fetched_count ?? 0}</dd>
              <dt>可用货源</dt>
              <dd>{run.eligible_count ?? 0}</dd>
            </dl>
            <span
              className={`v2-pill ${run.status === "failed" ? "danger" : "success"}`}
            >
              {run.status === "failed" ? "任务失败" : "进入任务"}
            </span>
            </Link>
          );
        })}
        {!runs.length && !error && (
          <div className="v2-card v2-empty">
            <b>还没有货源任务</b>
            <span>点击“新建货源任务”开始搜索 1688。</span>
          </div>
        )}
      </section>
    </div>
  );
}
