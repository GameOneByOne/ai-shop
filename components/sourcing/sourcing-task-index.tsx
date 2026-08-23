"use client";

import Link from "next/link";

type Run = {
  id: string;
  query: string;
  status: string;
  fetched_count: number | null;
  eligible_count: number | null;
  created_at: string;
  completed_at: string | null;
  hasPrimary: boolean;
  stages: { searched: number; detailed: number; total: number; screened: number; passed: number; aiCompleted: number; aiTotal: number };
};

function businessStatus(run: Run) {
  if (run.hasPrimary) return "已选择";
  if (run.stages.aiTotal > 0 && run.stages.aiCompleted === run.stages.aiTotal) return "待决定";
  if (run.stages.screened === run.stages.total && run.stages.total > 0) return "待AI分析";
  if (run.stages.detailed === run.stages.total && run.stages.total > 0) return "待规则初筛";
  if (run.stages.searched > 0) return "待解析";
  return "搜索中";
}

function createdAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function SourcingTaskIndex({
  runs,
  error,
}: {
  runs: Run[];
  error: string | null;
}) {
  return (
    <div className="v2-page sourcing-task-index">
      <div className="v2-crumb">选品中心　/　货源发现</div>
      <header className="v2-page-head">
        <div>
          <h1>货源任务</h1>
          <p>搜索真实 1688 Offer，完成解析、规则初筛、AI分析与货源选择。</p>
        </div>
        <Link
          className="v2-primary"
          href="/products/discover/search"
        >
          ＋ 新建货源搜索
        </Link>
      </header>

      {error && <div className="status-box error">任务读取失败：{error}</div>}
      <section className="v2-task-index-grid" aria-label="货源任务列表">
        {runs.map((run) => {
          const state = businessStatus(run);
          return (
            <Link
              className="v2-card v2-run-card"
              href={`/products/discover/runs/${run.id}`}
              key={run.id}
            >
            <div className="v2-run-summary">
              <div className="sourcing-task-title-row">
                <h2>{run.query}</h2>
                <span className={`v2-pill ${state === "已选择" ? "success" : state === "待决定" ? "reading" : ""}`}>{state}</span>
              </div>
              <div className="task-stage-overview" aria-label="阶段总览">
                {[
                  { label: "搜索", value: `${run.stages.searched} 条`, done: run.stages.searched > 0 },
                  { label: "解析", value: `${run.stages.detailed}/${run.stages.total}`, done: run.stages.total > 0 && run.stages.detailed === run.stages.total },
                  { label: "规则", value: run.stages.screened ? `${run.stages.passed} 条通过` : "待运行", done: run.stages.total > 0 && run.stages.screened === run.stages.total },
                  { label: "AI分析", value: run.stages.aiTotal ? `${run.stages.aiCompleted}/${run.stages.aiTotal}` : "待运行", done: run.stages.aiTotal > 0 && run.stages.aiCompleted === run.stages.aiTotal },
                ].map((stage, index) => <div className={stage.done ? "done" : ""} key={stage.label}><i>{stage.done ? "✓" : index + 1}</i><span><b>{stage.label}</b><small>{stage.value}</small></span></div>)}
              </div>
              <div className="sourcing-task-foot">
                <time dateTime={run.created_at}>{createdAt(run.created_at)}</time>
                <b>进入任务 →</b>
              </div>
            </div>
            </Link>
          );
        })}
        {!runs.length && !error && (
          <div className="v2-card v2-empty">
            <b>还没有货源任务</b>
            <span>点击“新建货源搜索”开始搜索 1688。</span>
          </div>
        )}
      </section>
    </div>
  );
}
