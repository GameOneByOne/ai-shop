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
  if (run.stages.screened === run.stages.total && run.stages.total > 0 && run.stages.passed === 0) return "无可用货源";
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

function resultSummary(run: Run) {
  const parts = [`搜索结果 ${run.stages.searched}`];
  if (run.stages.detailed < run.stages.total) {
    parts.push(`已解析 ${run.stages.detailed}/${run.stages.total}`);
    return parts.join(" · ");
  }
  if (run.stages.screened < run.stages.total) {
    parts.push("解析完成", "待规则初筛");
    return parts.join(" · ");
  }
  parts.push(`规则通过 ${run.stages.passed}`);
  if (run.stages.aiTotal > 0) parts.push(`AI完成 ${run.stages.aiCompleted}/${run.stages.aiTotal}`);
  else parts.push(run.stages.passed > 0 ? "待AI分析" : "无可分析货源");
  if (run.hasPrimary) parts.push("已选择货源");
  return parts.join(" · ");
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
              <p className="sourcing-task-result">{resultSummary(run)}</p>
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
