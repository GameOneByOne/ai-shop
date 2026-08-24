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
  criteria: Record<string, unknown> | null;
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

function runDuration(run: Run) {
  const started = Date.parse(run.created_at);
  const ended = run.completed_at ? Date.parse(run.completed_at) : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return "用时待记录";
  const seconds = Math.max(0, Math.floor((ended - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const value = hours ? `${hours}小时${minutes}分` : minutes ? `${minutes}分${String(remainingSeconds).padStart(2, "0")}秒` : `${remainingSeconds}秒`;
  return `${run.completed_at ? "用时" : "已运行"} ${value}`;
}

function extensionVersion(run: Run) {
  const value = run.criteria?.extensionVersion;
  return typeof value === "string" && value.trim()
    ? `扩展 v${value.trim()}`
    : "扩展版本未记录";
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

function searchConditions(run: Run) {
  const criteria = run.criteria ?? {};
  const filters = criteria.searchFilters && typeof criteria.searchFilters === "object" ? criteria.searchFilters as Record<string, unknown> : {};
  const values: string[] = [`目标 ${Number(criteria.targetOfferCount) || run.stages.searched} 条`];
  if (filters.sort && filters.sort !== "综合") values.push(`${filters.sort}排序`);
  if (filters.priceMin || filters.priceMax) values.push(`价格 ${filters.priceMin || "不限"}–${filters.priceMax || "不限"}`);
  if (filters.minOrder) values.push(`起订量 ≤ ${filters.minOrder}`);
  if (filters.shopProductMin || filters.shopProductMax) values.push(`店铺商品 ${filters.shopProductMin || "不限"}–${filters.shopProductMax || "不限"}`);
  for (const value of [filters.region, filters.merchantFeature, filters.businessMode, filters.encryptedWaybill, filters.latePickupCompensation]) if (value) values.push(String(value));
  for (const [label, value] of [["24H支揽率", filters.pickup24Rate], ["48H支揽率", filters.pickup48Rate]]) if (value) values.push(`${label} ${value}`);
  if (Array.isArray(filters.flags)) values.push(...filters.flags.map(String));
  if (filters.mergeSuppliers) values.push("合并同款供应商");
  return [...new Set(values)];
}

export function SourcingTaskIndex({
  runs,
  error,
  currentPage,
  totalPages,
  totalCount,
}: {
  runs: Run[];
  error: string | null;
  currentPage: number;
  totalPages: number;
  totalCount: number;
}) {
  return (
    <div className="v2-page sourcing-task-index">
      <div className="v2-crumb">选品中心　/　货源发现</div>
      <header className="v2-page-head">
        <div>
          <h1>货源任务</h1>
          <p>搜索真实 1688 Offer，完成规则筛选和第一阶段 AI 货源选择。上架内容在铺货后基于淘宝草稿增强。共 {totalCount} 个任务。</p>
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
              <div className="sourcing-task-conditions" aria-label="本轮搜索条件"><span>搜索条件</span><div>{searchConditions(run).map((condition) => <i key={condition}>{condition}</i>)}</div></div>
              <div className="sourcing-task-foot">
                <div><time dateTime={run.created_at}>{createdAt(run.created_at)}</time><span>{runDuration(run)}</span><span>{extensionVersion(run)}</span></div>
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
      {totalPages > 1 && <nav className="sourcing-pagination" aria-label="货源任务分页">
        <Link className={`v2-secondary${currentPage <= 1 ? " disabled" : ""}`} aria-disabled={currentPage <= 1} href={currentPage <= 1 ? `/products/discover?page=1` : `/products/discover?page=${currentPage - 1}`}>上一页</Link>
        <span>第 {Math.min(currentPage, totalPages)} / {totalPages} 页</span>
        <Link className={`v2-secondary${currentPage >= totalPages ? " disabled" : ""}`} aria-disabled={currentPage >= totalPages} href={currentPage >= totalPages ? `/products/discover?page=${totalPages}` : `/products/discover?page=${currentPage + 1}`}>下一页</Link>
      </nav>}
    </div>
  );
}
