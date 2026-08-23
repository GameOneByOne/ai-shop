"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DirectionRecommendation,
  DirectionSourceProduct,
  ProductDirection,
} from "@/lib/sourcing/directions";
import {
  isTrustedPrice,
  type SourceSkuRecord,
} from "@/lib/sourcing/source-products";

interface Item {
  id: string;
  external_id: string;
  source_url: string;
  title: string;
  supplier_name: string | null;
  price_min: number | null;
  sales_count: number | null;
  repurchase_rate: number | null;
  rough_score: number;
  data_status: string;
  raw_data: Record<string, unknown>;
  one_piece_delivery?: boolean | null;
  min_order_quantity?: number | null;
  blind_shipping?: boolean | null;
  return_shipping?: boolean | null;
  no_reason_return?: boolean | null;
  shop_age?: number | null;
  quality_rate?: number | null;
  delivery_rate?: number | null;
  stock?: number | null;
  image_count?: number | null;
  has_video?: boolean | null;
  inspection?: boolean | null;
  offer_status?: "PASS" | "RISK" | "REJECT" | null;
  offer_reasons?: string[] | null;
  offer_facts_captured_at?: string | null;
}

interface Stats {
  fetched: number;
  unique: number;
  pages: number;
  sourceProducts: number;
  sourceSkus: number;
  dataErrors: number;
  rejected: number;
  clusters: number;
  eligible: number;
  primaryDirections?: number;
  adjacentDirections?: number;
}

interface Pipeline {
  stage1Status: string;
  stage1Version: number;
  stage2Status: string;
  stage2Version: number;
  attributeStatus: string;
  stage3Status: string;
}

type CaptureMode = "offers" | "facts" | "details";


function readableCaptureError(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.message !== value) {
      const message = readableCaptureError(record.message);
      if (message !== "未知采集错误") return message;
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {}
  }
  return "未知采集错误";
}

function isReviewDone(direction: ProductDirection) {
  return Boolean(direction.reviewedAt && direction.recommendation);
}

function labelRecommendation(
  value: DirectionRecommendation | null | undefined,
) {
  return {
    PRIORITY_VERIFY: "优先验证",
    VERIFY: "需要验证",
    WATCH: "观察",
    REJECT: "不建议",
  }[value ?? "WATCH"];
}

function formatMoney(value: number | null | undefined) {
  return value == null ? "待核实" : `¥${value.toFixed(2)}`;
}

function directionPriceRange(direction: ProductDirection) {
  const candidatePrices = direction.products
    .flatMap((p) => p.skus)
    .map((s) =>
      isTrustedPrice(s) ? (s.dropshipPrice ?? s.wholesalePrice) : null,
    )
    .filter((value): value is number => value != null);

  if (!candidatePrices.length) return "待核实";

  const min = Math.min(...candidatePrices);
  const max = Math.max(...candidatePrices);
  return min === max
    ? `¥${min.toFixed(2)}`
    : `¥${min.toFixed(2)} ~ ¥${max.toFixed(2)}`;
}

function directionCoverage(direction: ProductDirection) {
  const totalSku = direction.skuCount || 0;
  const trustedSku = direction.products
    .flatMap((product) => product.skus)
    .filter((sku) => isTrustedPrice(sku)).length;
  const verifiedOffer = direction.products.filter(
    (product) =>
      product.supports_dropshipping === true &&
      product.skus.some((sku) => isTrustedPrice(sku)),
  ).length;

  return { totalSku, trustedSku, verifiedOffer };
}

const DEFAULT_SEARCH_FLAGS = ["一件代发", "退货包运费", "7天无理由退货"] as const;
const defaultSearchOptions = () => ({
  sort: "综合",
  priceMin: "",
  priceMax: "",
  minOrder: "",
  shopProductMin: "",
  shopProductMax: "",
  region: "",
  merchantFeature: "",
  businessMode: "",
  encryptedWaybill: "",
  latePickupCompensation: "",
  pickup24Rate: "",
  pickup48Rate: "",
  mergeSuppliers: false,
  flags: [...DEFAULT_SEARCH_FLAGS] as string[],
});

export function SourcingDiscovery({
  compact = false,
  createMode = false,
  initialRunId,
  onDataChange,
}: {
  compact?: boolean;
  createMode?: boolean;
  initialRunId?: string;
  onDataChange?: () => void | Promise<void>;
} = {}) {
  const router = useRouter();
  const [query, setQuery] = useState(createMode ? "" : "猫隧道");
  const [keywordText, setKeywordText] = useState(
    createMode
      ? ""
      : "猫隧道\n猫咪隧道\n宠物隧道\n可折叠猫隧道\n猫玩具隧道",
  );
  const [targetOfferCount, setTargetOfferCount] = useState(20);
  const [searchPrepared, setSearchPrepared] = useState(!createMode);
  const [searchOptions, setSearchOptions] = useState(defaultSearchOptions);
  const [items, setItems] = useState<Item[]>([]);
  const [directions, setDirections] = useState<ProductDirection[]>([]);
  const [runId, setRunId] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [busy, setBusy] = useState<CaptureMode | null>(null);
  const [progress, setProgress] = useState("");
  const [captureStartedAt, setCaptureStartedAt] = useState<number | null>(null);
  const [captureNow, setCaptureNow] = useState(0);
  const [captureProgress, setCaptureProgress] = useState<{
    completed: number;
    total: number;
    succeeded: number;
    failed: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [clustering, setClustering] = useState(false);
  const [parsingAttributes, setParsingAttributes] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [sort, setSort] = useState("score");
  const [requirements, setRequirements] = useState({
    onePiece: false,
    blind: false,
    returns: false,
    stock: false,
    shopAge: false,
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<string | null>(null);
  const modeRef = useRef<CaptureMode>("offers");
  const activeRunRef = useRef(initialRunId ?? "");
  const lastCaptureStageRef = useRef("");
  useEffect(() => {
    if (!busy || captureStartedAt == null) return;
    const interval = window.setInterval(() => setCaptureNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [busy, captureStartedAt]);

  function armCaptureWatchdog(
    requestId: string,
    mode: CaptureMode,
    delay: number,
    waitingForFirstHeartbeat = false,
  ) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (requestRef.current !== requestId) return;
      window.postMessage(
        { type: "AI_SHOP_CANCEL_CAPTURE", requestId },
        location.origin,
      );
      requestRef.current = null;
      setBusy(null);
      setCaptureProgress(null);
      setProgress("");
      const lastStage = lastCaptureStageRef.current;
      setError(
        waitingForFirstHeartbeat
          ? "采集桥未响应。扩展更新后需要刷新当前 AI 店长页面，再重新搜索"
          : `${mode === "offers" ? "Offer 采集" : "详情解析"}在“${lastStage || "启动"}”阶段停止响应，请检查对应的 1688 页面`,
      );
    }, delay);
  }

  function prepareSearch() {
    if (!query.trim()) {
      setError("请先输入要搜索的商品");
      return;
    }
    setSearchPrepared(true);
    setKeywordText(query.trim());
    setError("");
  }

  function cancelCapture() {
    const activeRequestId = requestRef.current;
    requestRef.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (activeRequestId) {
      window.postMessage(
        { type: "AI_SHOP_CANCEL_CAPTURE", requestId: activeRequestId },
        location.origin,
      );
    }
    setBusy(null);
    setCaptureProgress(null);
    setError("");
    setProgress("本轮搜索已取消，可以修改条件后重新搜索。");
  }

  function toggleSearchFlag(value: string) {
    setSearchOptions((current) => ({
      ...current,
      flags: current.flags.includes(value)
        ? current.flags.filter((item) => item !== value)
        : [...current.flags, value],
    }));
  }

  async function post(url: string, data: object) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "操作失败");
    return body;
  }

  async function loadLatest() {
    const url = initialRunId
      ? `/api/sourcing/latest?runId=${encodeURIComponent(initialRunId)}`
      : "/api/sourcing/latest";
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "读取最近任务失败");
    if (!body.runId) return;

    setRunId(body.runId);
    setItems(body.products ?? []);
    setDirections(body.directions ?? []);
    setStats(body.stats);
    setPipeline(body.pipeline ?? null);
    if (body.query) setQuery(body.query);
    if (body.keywords?.length) setKeywordText(body.keywords.join("\n"));
  }

  useEffect(() => {
    if (createMode) return;
    let active = true;
    const url = initialRunId
      ? `/api/sourcing/latest?runId=${encodeURIComponent(initialRunId)}`
      : "/api/sourcing/latest";
    void fetch(url)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "读取最近任务失败");
        if (!active || !body.runId) return;

        setRunId(body.runId);
        setItems(body.products ?? []);
        setDirections(body.directions ?? []);
        setStats(body.stats);
        setPipeline(body.pipeline ?? null);
        if (body.query) setQuery(body.query);
        if (body.keywords?.length) setKeywordText(body.keywords.join("\n"));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });

    return () => {
      active = false;
    };
  }, [createMode, initialRunId]);

  useEffect(() => {
    const resetTask = () => {
      setQuery("");
      setKeywordText("");
      setTargetOfferCount(20);
      setSearchOptions(defaultSearchOptions());
      setRunId("");
      setItems([]);
      setStats(null);
      setPipeline(null);
      setError("");
      setProgress("");
    };
    window.addEventListener("ai-shop:new-sourcing-task", resetTask);
    return () =>
      window.removeEventListener("ai-shop:new-sourcing-task", resetTask);
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.data.requestId !== requestRef.current
      )
        return;
      if (event.data?.type === "AI_SHOP_CAPTURE_PROGRESS") {
        const progressMessage = event.data.message ||
          `已处理 ${event.data.completed}/${event.data.total} 个 Offer（成功 ${event.data.succeeded}，失败 ${event.data.failed}）`;
        lastCaptureStageRef.current = progressMessage;
        armCaptureWatchdog(
          event.data.requestId,
          modeRef.current,
          modeRef.current === "offers" ? 65000 : 125000,
        );
        setCaptureProgress({
          completed: Number(event.data.completed ?? 0),
          total: Number(event.data.total ?? 0),
          succeeded: Number(event.data.succeeded ?? 0),
          failed: Number(event.data.failed ?? 0),
        });
        setProgress(progressMessage);
        return;
      }
      if (event.data?.type !== "AI_SHOP_CAPTURE_RESULT") return;
      if (timer.current) clearTimeout(timer.current);
      requestRef.current = null;
      const completedMode = modeRef.current;
      if (event.data.error) {
        setBusy(null);
        setCaptureProgress(null);
        setProgress("");
        const version = event.data.extensionVersion
          ? `（扩展 v${String(event.data.extensionVersion)}）`
          : "";
        setError(`${readableCaptureError(event.data.error)}${version}`);
        return;
      }
      const keywords = keywordText
        .split(/[\n,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
      const operation =
        completedMode === "offers"
          ? post("/api/sourcing/browser-import", {
              query,
              keywords,
              targetOfferCount,
              collection: event.data.collection,
              items: event.data.items,
            })
          : post("/api/sourcing/enrich", {
              runId,
              details: event.data.details,
              factsOnly: completedMode === "facts",
            });

      void operation
        .then(async (body) => {
          await loadLatest();
          if (completedMode === "offers") {
            // 搜索页是两步中转页：搜索 Offer 后必须继续抓取完整商品详情。
            // facts 模式只会保存资格快照，不包含 rawOptions/SKU，因此结果页会大量显示“待获取”。
            startDetailCapture(body.products ?? [], body.runId, "details");
            return;
          }
          await onDataChange?.();
          const completedRunId = activeRunRef.current || runId;
          if (createMode && completedRunId)
            router.push(`/products/discover/runs/${encodeURIComponent(completedRunId)}`);
          const failedCount = Array.isArray(event.data.failures)
            ? event.data.failures.length
            : 0;
          if (failedCount > 0) {
            setError(
              `${failedCount} 个商家详情未解析成功，请检查1688登录状态后重新解析。`,
            );
            return;
          }
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "同步数据失败");
        })
        .finally(() => {
          if (modeRef.current !== completedMode) return;
          setBusy(null);
          setCaptureProgress(null);
          setProgress("");
        });
    };

    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [createMode, keywordText, onDataChange, query, router, runId, targetOfferCount]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function startDetailCapture(
    sourceItems: Item[],
    targetRunId: string,
    captureMode: "facts" | "details",
  ) {
    const parseCandidates = sourceItems
      // 搜索条件已由 1688 页面应用。此处不能在详情字段尚未解析时
      // 再用空值做一次本地过滤，否则真实 Offer 会在解析前被误删。
      .sort((a, b) => b.rough_score - a.rough_score)
      .slice(0, 50)
      .map((x) => ({
        id: x.id,
        externalId: x.external_id,
        sourceUrl: x.source_url,
        title: x.title,
      }));

    if (!parseCandidates.length) {
      setBusy(null);
      setError(
        captureMode === "facts"
          ? "本次搜索没有可采集资质的 Offer"
          : "本次搜索没有可解析详情的 Offer",
      );
      return;
    }

    const id = crypto.randomUUID();
    requestRef.current = id;
    modeRef.current = captureMode;
    setRunId(targetRunId);
    activeRunRef.current = targetRunId;
    setBusy(captureMode);
    setDirections([]);
    setProgress(
      captureMode === "facts"
        ? `正在获取 ${sourceItems.length} 个 Offer 详情（本轮目标 ${targetOfferCount} 个）…`
        : "正在解析筛选通过的商品与采购 SKU…",
    );
    setCaptureProgress({
      completed: 0,
      total: parseCandidates.length,
      succeeded: 0,
      failed: 0,
    });

    window.postMessage(
      {
        type: "AI_SHOP_ENRICH_1688",
        requestId: id,
        offers: parseCandidates,
        factsOnly: captureMode === "facts",
      },
      location.origin,
    );

    timer.current = setTimeout(() => {
      window.postMessage(
        { type: "AI_SHOP_CANCEL_CAPTURE", requestId: id },
        location.origin,
      );
      requestRef.current = null;
      setBusy(null);
      setCaptureProgress(null);
      setProgress("");
      setError(
        captureMode === "facts"
          ? "店铺资质采集超时，请检查 1688 登录状态后重新搜索"
          : "商品解析超时，请检查采集桥状态后重试",
      );
    }, 420000);
  }

  function begin(mode: CaptureMode) {
    const keywords = (createMode ? query : keywordText)
      .split(/[\n,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (mode === "offers" && !keywords.length) {
      setError("请至少填写一个搜索关键词");
      return;
    }

    const id = crypto.randomUUID();
    requestRef.current = id;
    modeRef.current = mode;
    lastCaptureStageRef.current = "";
    setBusy(mode);
    setCaptureStartedAt(Date.now());
    setCaptureNow(Date.now());
    setCaptureProgress({
      completed: 0,
      total:
        mode === "details"
          ? Math.min(
              50,
              items.filter((x) =>
                ["valid", "needs_review"].includes(x.data_status),
              ).length,
            )
          : keywords.length,
      succeeded: 0,
      failed: 0,
    });

    if (mode === "offers") {
      setDirections([]);
      setStats(null);
      setPipeline(null);
      setProgress("正在创建新的 Sourcing Run 并进行 Offer 粗筛…");
    } else {
      setDirections([]);
      setProgress("正在解析 Offer 的真实商品与 SKU…");
    }
    setError("");

    if (mode === "offers") {
      window.postMessage(
        {
          type: "AI_SHOP_CAPTURE_1688",
          requestId: id,
          query,
          keywords,
          targetOfferCount,
          filters: searchOptions,
          maxPages: 30,
        },
        location.origin,
      );
    } else {
      startDetailCapture(items, runId, "details");
      return;
    }

    armCaptureWatchdog(id, mode, 15000, true);
  }

  async function runAiSelectionDirections() {
    setClustering(true);
    setError("");
    setProgress("正在发送低分辨率商品图片并进行多模态款型聚类…");
    try {
      const analyzeResponse = await fetch("/api/sourcing/v3/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const analyzeBody = await analyzeResponse.json();
      if (!analyzeResponse.ok)
        throw new Error(analyzeBody.error ?? "商品款型聚类失败");
      await loadLatest();
      await onDataChange?.();
      setProgress("多模态商品款型聚类已完成，货源工作区已刷新。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 选款方向失败");
      setProgress("");
    } finally {
      setClustering(false);
    }
  }

  async function runAttributeParsing() {
    setParsingAttributes(true);
    setError("");
    setProgress("DeepSeek 正在根据商品名与 SourceSKU 文字解析商品属性…");
    try {
      await post("/api/sourcing/v3/attributes", { runId });
      await loadLatest();
      await onDataChange?.();
      setProgress("DeepSeek 商品属性解析已完成。");
    } catch (reason) {
      await loadLatest().catch(() => undefined);
      setError(reason instanceof Error ? reason.message : "商品属性解析失败");
      setProgress("");
    } finally {
      setParsingAttributes(false);
    }
  }

  const allPrimary = useMemo(
    () => directions.filter((x) => x.taskRelevance === "PRIMARY"),
    [directions],
  );
  const adjacent = useMemo(
    () => directions.filter((x) => x.taskRelevance === "ADJACENT_OPPORTUNITY"),
    [directions],
  );
  const sortedAudit = useMemo(() => {
    let list = [...items];
    if (filter !== "ALL") list = list.filter((x) => x.offer_status === filter);
    if (requirements.onePiece)
      list = list.filter((x) => x.one_piece_delivery === true);
    if (requirements.blind)
      list = list.filter((x) => x.blind_shipping === true);
    if (requirements.returns)
      list = list.filter(
        (x) => x.return_shipping === true || x.no_reason_return === true,
      );
    if (requirements.stock) list = list.filter((x) => (x.stock ?? 0) > 100);
    if (requirements.shopAge) list = list.filter((x) => (x.shop_age ?? 0) > 1);
    if (sort === "sales") {
      list.sort((a, b) => (b.sales_count ?? 0) - (a.sales_count ?? 0));
    } else if (sort === "price") {
      list.sort(
        (a, b) => (a.price_min ?? Infinity) - (b.price_min ?? Infinity),
      );
    } else {
      list.sort((a, b) => (b.rough_score ?? 0) - (a.rough_score ?? 0));
    }
    return list;
  }, [filter, items, requirements, sort]);

  const admission = useMemo(() => {
    const captured = items.filter((x) => Boolean(x.offer_facts_captured_at));
    return {
      captured: items.length,
      pass: captured.filter((x) => x.offer_status === "PASS").length,
      risk: captured.filter((x) => x.offer_status === "RISK").length,
      reject: captured.filter((x) => x.offer_status === "REJECT").length,
      pending: items.length - captured.length,
    };
  }, [items]);

  return (
    <>
      <section
        className={`sourcing-task-form${compact ? " compact" : ""}`}
        id={compact ? "sourcing-task" : undefined}
      >
        <h2>{createMode ? "搜索 1688" : "货源任务"}</h2>
        <label className={createMode ? "sourcing-search-main" : undefined}>
          {createMode ? <span>在 1688 找货源</span> : "任务名称"}
          <div className={createMode ? "sourcing-search-box" : undefined}>
          <input
            className="input"
            value={query}
            placeholder={createMode ? "例如：猫隧道" : undefined}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              if (searchPrepared) setKeywordText(next.trim());
            }}
            onKeyDown={(event) => {
              if (createMode && event.key === "Enter") {
                event.preventDefault();
                prepareSearch();
                begin("offers");
              }
            }}
          />
          {createMode && <button type="button" disabled={Boolean(busy) || !query.trim()} onClick={() => { if (!searchPrepared) prepareSearch(); begin("offers"); }}>{busy === "offers" ? "正在搜索…" : "搜索1688"}</button>}
          </div>
        </label>
        {createMode && (
          <div className="sourcing-search-filters" aria-label="1688 搜索筛选">
            <div className="sourcing-search-toolbar">
              <div className="sourcing-search-sort" aria-label="排序方式">{(["综合", "销量", "价格"] as const).map((value) => <button type="button" className={searchOptions.sort === value ? "active" : ""} key={value} onClick={() => setSearchOptions((current) => ({...current, sort:value}))}>{value}</button>)}</div>
              <label className="sourcing-check"><input type="checkbox" checked={searchOptions.mergeSuppliers} onChange={(event) => setSearchOptions((current) => ({...current,mergeSuppliers:event.target.checked}))} />合并同款供应商</label>
            </div>
            <div className="sourcing-search-condition-row"><b>采购条件</b><div><label>价格<input className="input" inputMode="decimal" placeholder="最低价" value={searchOptions.priceMin} onChange={(event) => setSearchOptions((current) => ({...current,priceMin:event.target.value}))} /><i>—</i><input className="input" inputMode="decimal" placeholder="最高价" value={searchOptions.priceMax} onChange={(event) => setSearchOptions((current) => ({...current,priceMax:event.target.value}))} /></label><label>起订量<input className="input" type="number" min={1} placeholder="不限" value={searchOptions.minOrder} onChange={(event) => setSearchOptions((current) => ({...current,minOrder:event.target.value}))} /></label><label>店铺商品数<input className="input" inputMode="numeric" placeholder="最低" value={searchOptions.shopProductMin} onChange={(event) => setSearchOptions((current) => ({...current,shopProductMin:event.target.value}))} /><i>—</i><input className="input" inputMode="numeric" placeholder="最高" value={searchOptions.shopProductMax} onChange={(event) => setSearchOptions((current) => ({...current,shopProductMax:event.target.value}))} /></label></div></div>
            <div className="sourcing-search-condition-row"><b>供应商</b><div><label>所在地区<select className="input" value={searchOptions.region} onChange={(event) => setSearchOptions((current) => ({...current,region:event.target.value}))}><option value="">全部地区</option>{["浙江","广东","江苏","山东","河北","河南","福建","安徽","上海","北京"].map((value)=><option key={value}>{value}</option>)}</select></label><label>商家特色<select className="input" value={searchOptions.merchantFeature} onChange={(event) => setSearchOptions((current) => ({...current,merchantFeature:event.target.value}))}><option value="">全部商家</option>{["超级工厂","实力商家","深度验厂","源头工厂","源头旗舰"].map((value)=><option key={value}>{value}</option>)}</select></label><label>经营模式<select className="input" value={searchOptions.businessMode} onChange={(event) => setSearchOptions((current) => ({...current,businessMode:event.target.value}))}><option value="">全部模式</option><option>生产加工</option><option>经销批发</option><option>招商代理</option><option>商业服务</option></select></label></div></div>
            <div className="sourcing-search-condition-row"><b>特色服务</b><div className="sourcing-search-flags">{[...DEFAULT_SEARCH_FLAGS, "极速开票", "新人首单优惠", "新品", "包邮", "1688严选", "分销严选", "48H发货", "官方物流", "铺货素材包"].map((value) => <button type="button" className={searchOptions.flags.includes(value)?"active":""} aria-pressed={searchOptions.flags.includes(value)} key={value} onClick={() => toggleSearchFlag(value)}>{value}</button>)}</div></div>
            <div className="sourcing-search-condition-row"><b>代发履约</b><div><label>密文面单<select className="input" value={searchOptions.encryptedWaybill} onChange={(event) => setSearchOptions((current) => ({...current,encryptedWaybill:event.target.value}))}><option value="">不限</option><option>淘宝密文面单</option><option>抖音密文面单</option><option>拼多多密文面单</option><option>快手密文面单</option></select></label><label>晚揽必赔<select className="input" value={searchOptions.latePickupCompensation} onChange={(event) => setSearchOptions((current) => ({...current,latePickupCompensation:event.target.value}))}><option value="">不限</option><option value="晚揽必赔">支持晚揽必赔</option></select></label><label>24H支揽率<select className="input" value={searchOptions.pickup24Rate} onChange={(event) => setSearchOptions((current) => ({...current,pickup24Rate:event.target.value}))}><option value="">不限</option><option value="80%">≥ 80%</option><option value="90%">≥ 90%</option><option value="95%">≥ 95%</option></select></label><label>48H支揽率<select className="input" value={searchOptions.pickup48Rate} onChange={(event) => setSearchOptions((current) => ({...current,pickup48Rate:event.target.value}))}><option value="">不限</option><option value="80%">≥ 80%</option><option value="90%">≥ 90%</option><option value="95%">≥ 95%</option></select></label></div></div>
            </div>
        )}
        {!createMode && <label>
          搜索关键词（每行一个，数量不限）
          <textarea
            className="input textarea"
            value={keywordText}
            onChange={(e) => setKeywordText(e.target.value)}
          />
        </label>}
        <label>
          本轮目标商品数
          <input
            className="input"
            type="number"
            min={1}
            max={500}
            value={targetOfferCount}
            onChange={(event) => setTargetOfferCount(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
          />
          <small>默认 20。多个关键词累计去重，每个新 Offer 计 1 个，达到数量后停止搜索。</small>
        </label>
        <div className="auth-actions">
          {!createMode && <button
            className={busy === "details" ? "secondary-btn" : "btn"}
            disabled={Boolean(busy) || (createMode && !query.trim())}
            onClick={() => {
              if (!searchPrepared) prepareSearch();
              begin("offers");
            }}
          >
            {busy
              ? busy === "offers"
                ? "正在搜索 1688 货源…"
                : `正在获取详情 ${captureProgress?.completed ?? 0}/${captureProgress?.total ?? 0}${busy === "facts" ? `（目标 ${targetOfferCount}）` : ""}`
              : createMode
                ? "搜索并获取货源详情"
                : "搜索1688货源"}
          </button>}
          {busy && <button
            type="button"
            className="secondary-btn sourcing-cancel-btn"
            onClick={cancelCapture}
          >
            取消搜索
          </button>}
          {!createMode && <button
            className={busy === "details" ? "btn" : "secondary-btn"}
            disabled={!runId || Boolean(busy) || !items.length}
            onClick={() => begin("details")}
          >
            {busy === "details"
              ? `正在解析 ${captureProgress?.completed ?? 0}/${captureProgress?.total ?? 0}`
              : "获取货源详情"}
          </button>}
          {!compact && <button
            className="secondary-btn"
            disabled={
              Boolean(busy) ||
              parsingAttributes ||
              clustering ||
              pipeline?.stage2Status !== "COMPLETED" ||
              !stats?.sourceSkus
            }
            onClick={() => void runAttributeParsing()}
          >
            {parsingAttributes ? "正在解析商品属性…" : "DeepSeek解析商品属性"}
          </button>}
          {!compact && <button
            className="secondary-btn"
            disabled={
              Boolean(busy) ||
              parsingAttributes ||
              clustering ||
              pipeline?.attributeStatus !== "COMPLETED" ||
              !stats?.sourceSkus
            }
            onClick={() => void runAiSelectionDirections()}
          >
            {clustering ? "正在生成选款方向…" : "AI选款方向"}
          </button>}
        </div>

        {busy && captureProgress && (
          <div className="capture-progress" aria-live="polite">
            <div>
              <b>
                正在获取货源
              </b>
              <span>
                {captureProgress.completed} / {captureProgress.total || "—"} · 已运行 {(() => { const seconds = Math.max(0, Math.floor((captureNow - (captureStartedAt ?? captureNow)) / 1000)); const minutes = Math.floor(seconds / 60); return minutes ? `${minutes}分${String(seconds % 60).padStart(2, "0")}秒` : `${seconds}秒`; })()}
              </span>
            </div>
            <progress
              value={captureProgress.completed}
              max={Math.max(1, captureProgress.total)}
            />
            <small>
              已获得有效货源 {captureProgress.succeeded}
            </small>
            {progress && <p className="capture-progress-stage">{progress}</p>}
          </div>
        )}

        {(error || (!busy && progress)) && (
          <div className={`status-box${error ? " error" : ""}`}>
            {error || progress}
          </div>
        )}
      </section>

      {!compact && stats && (
        <section className="sourcing-kpis" aria-label="选品任务数据统计">
          <div>
            <b>{stats.fetched}</b>
            <span>搜索结果</span>
          </div>
          <div>
            <b>{stats.unique}</b>
            <span>有效 1688 货源</span>
          </div>
          <div>
            <b>{stats.sourceProducts}</b>
            <span>解析商品</span>
          </div>
          <div>
            <b>{stats.sourceSkus}</b>
            <span>采购规格</span>
          </div>
        </section>
      )}

      {!compact && items.length > 0 && (
        <section className="card raw-results offer-pool-workbench">
          <div className="offer-admission-summary">
            <div>
              <b>{admission.captured}</b>
              <span>已采集 Offer</span>
            </div>
            <div>
              <b className="pass-text">{admission.pass}</b>
              <span>通过筛选</span>
            </div>
            <div>
              <b className="risk-text">{admission.risk + admission.pending}</b>
              <span>待确认</span>
            </div>
            <div>
              <b className="reject-text">{admission.reject}</b>
              <span>淘汰 Offer</span>
            </div>
            <div>
              <b>
                {admission.captured
                  ? Math.round((admission.pass / admission.captured) * 100)
                  : 0}
                %
              </b>
              <span>筛选通过率</span>
            </div>
          </div>

          <div className="offer-filter-panel">
            <b>筛选条件</b>
            {[
              ["onePiece", "一件代发"],
              ["blind", "无痕发货"],
              ["returns", "退货保障"],
              ["stock", "库存 > 100"],
              ["shopAge", "店铺经营 > 1 年"],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={requirements[key as keyof typeof requirements]}
                  onChange={(e) =>
                    setRequirements((old) => ({
                      ...old,
                      [key]: e.target.checked,
                    }))
                  }
                />
                {label}
              </label>
            ))}
            <button
              className="secondary-btn"
              onClick={() =>
                setRequirements({
                  onePiece: false,
                  blind: false,
                  returns: false,
                  stock: false,
                  shopAge: false,
                })
              }
            >
              重置
            </button>
          </div>

          <div className="raw-toolbar">
            <div className="offer-status-tabs">
              {(["ALL", "PASS", "RISK", "REJECT"] as const).map((status) => (
                <button
                  key={status}
                  className={filter === status ? "active" : ""}
                  onClick={() => setFilter(status)}
                >
                  {
                    {
                      ALL: "全部",
                      PASS: "推荐",
                      RISK: "待确认",
                      REJECT: "淘汰",
                    }[status]
                  }
                </button>
              ))}
            </div>
            <select
              className="input"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="score">综合排序</option>
              <option value="sales">Offer 级销量</option>
              <option value="price">采购价</option>
            </select>
          </div>
          <div className="table-wrap">
            <table className="table offer-admission-table">
              <thead>
                <tr>
                  <th>1688 Offer</th>
                  <th>采购价</th>
                  <th>供应能力</th>
                  <th>店铺质量</th>
                  <th>商品表现</th>
                  <th>准入状态</th>
                </tr>
              </thead>
              <tbody>
                {sortedAudit.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <a href={x.source_url} target="_blank" rel="noreferrer">
                        {x.title}
                      </a>
                      <small className="mapping-arrow">
                        {x.supplier_name ?? "供应商待核实"}
                      </small>
                    </td>
                    <td>
                      {x.price_min == null ? "待核实" : `¥${x.price_min} 起`}
                    </td>
                    <td>
                      <small>
                        一件代发{" "}
                        {x.one_piece_delivery == null
                          ? "待采集"
                          : x.one_piece_delivery
                            ? "✓"
                            : "✕"}
                        <br />
                        无痕发货{" "}
                        {x.blind_shipping == null
                          ? "待采集"
                          : x.blind_shipping
                            ? "✓"
                            : "✕"}
                        <br />
                        退货保障{" "}
                        {(x.return_shipping ?? x.no_reason_return) == null
                          ? "待采集"
                          : x.return_shipping || x.no_reason_return
                            ? "✓"
                            : "✕"}
                      </small>
                    </td>
                    <td>
                      <small>
                        经营{" "}
                        {x.shop_age == null ? "待采集" : `${x.shop_age} 年`}
                        <br />
                        品质{" "}
                        {x.quality_rate == null
                          ? "待采集"
                          : `${x.quality_rate}%`}
                        <br />
                        回头率{" "}
                        {x.repurchase_rate == null
                          ? "待采集"
                          : `${x.repurchase_rate}%`}
                      </small>
                    </td>
                    <td>
                      <small>
                        销量 {x.sales_count ?? "待核实"}
                        <br />
                        库存 {x.stock ?? "待采集"}
                        <br />
                        视频{" "}
                        {x.has_video == null
                          ? "待采集"
                          : x.has_video
                            ? "✓"
                            : "✕"}
                      </small>
                    </td>
                    <td>
                      {!x.offer_facts_captured_at ? (
                        <span className="data-state needs_review">
                          待采集详情
                        </span>
                      ) : (
                        <>
                          <span
                            className={`data-state ${x.offer_status?.toLowerCase()}`}
                          >
                            {
                              { PASS: "推荐", RISK: "待确认", REJECT: "淘汰" }[
                                x.offer_status ?? "RISK"
                              ]
                            }
                          </span>
                          <small className="mapping-arrow">
                            {x.offer_reasons?.join("、") || "事实完整"}
                          </small>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!sortedAudit.length && (
                  <tr>
                    <td colSpan={6}>当前筛选条件下没有货源</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function TopSummaryCard({
  direction,
  rank,
}: {
  direction: ProductDirection;
  rank: number;
}) {
  const reviewed = isReviewDone(direction);
  const product =
    direction.products.find(
      (item) => item.id === direction.representativeProductId,
    ) ?? direction.products[0];
  const bestSku = product?.skus.find((sku) => isTrustedPrice(sku)) ?? null;

  return (
    <article className="card direction-card">
      <div className="direction-card-head">
        <div>
          <span className="eyebrow">
            Top {rank} · {labelRecommendation(direction.recommendation)} · AI
            方向价值
          </span>
          <h2>{direction.name}</h2>
          <p className="muted">
            {direction.productCount} 个货源 · {direction.skuCount} 个规格
          </p>
        </div>
        <div className="direction-score">
          <b>
            {reviewed
              ? (direction.directionScore ?? direction.aiScore ?? "—")
              : "待复核"}
          </b>
          <span>Direction Score</span>
        </div>
      </div>
      <p className="muted">
        {reviewed
          ? (direction.summary ?? direction.marketReason ?? "方向信息待补充")
          : "DeepSeek 复核中"}
      </p>
      {product && bestSku ? (
        <div className="offer-role">
          <b>当前建议</b>
          <span>{product.normalizedName}</span>
          <span>{product.supplier_name ?? "待核实"}</span>
          <span>
            {formatMoney(bestSku.dropshipPrice ?? bestSku.wholesalePrice)}
          </span>
        </div>
      ) : (
        <div className="offer-role">
          <b>当前建议</b>
          <span>{product?.normalizedName ?? "待核实"}</span>
          <span>待核实</span>
          <span>—</span>
        </div>
      )}
      <div className="direction-summary-mini">
        <small>
          核心价值：
          {reviewed
            ? (direction.commercialReadiness ?? 0) + " / 100"
            : "待复核"}
        </small>
      </div>
    </article>
  );
}

function DirectionCard({
  direction,
  runId,
  isStale,
}: {
  direction: ProductDirection;
  runId: string;
  isStale: boolean;
}) {
  const reviewed = isReviewDone(direction);
  const { totalSku, trustedSku, verifiedOffer } = directionCoverage(direction);
  const priceText = directionPriceRange(direction);

  return (
    <article className="card direction-card">
      <div className="direction-card-head">
        <div>
          <span className="eyebrow">
            {labelRecommendation(direction.recommendation)}
          </span>
          <h2>{direction.name}</h2>
          <p className="muted">
            {direction.productCount} 个候选货源 · {direction.skuCount}{" "}
            个可采购规格
          </p>
        </div>
        <div className="direction-score">
          <b>
            {reviewed
              ? (direction.directionScore ?? direction.aiScore ?? "—")
              : "待复核"}
          </b>
          <span>方向价值分</span>
        </div>
      </div>

      <div className="direction-summary">
        <div>
          <span>已确认一件代发</span>
          <b>
            {verifiedOffer} / {direction.productCount}
          </b>
        </div>
        <div>
          <span>可信价格覆盖</span>
          <b>
            {trustedSku} / {totalSku}
          </b>
        </div>
        <div>
          <span>价格区间</span>
          <b>{priceText}</b>
        </div>
        <div>
          <span>AI方向价值</span>
          <b>{isStale ? "待重跑" : reviewed ? "已复核" : "待复核"}</b>
        </div>
      </div>

      <p className="direction-ai">
        <b>说明：</b>
        {reviewed
          ? `${direction.summary ?? direction.marketReason ?? "AI 方向建议已形成"}${direction.nextAction ? `；建议动作：${direction.nextAction}` : ""}`
          : "该方向尚未完成 AI 复核，建议先运行阶段 3"}
      </p>

      <div className="action-buttons">
        <span className="review-state">
          任务状态：{reviewed ? "已进入阶段3" : "待复核"}
        </span>
        <Link
          className="btn"
          href={
            runId
              ? `/products/discover/runs/${runId}/directions/${direction.id}`
              : "/products/discover"
          }
          style={{ textDecoration: "none" }}
        >
          查看货源
        </Link>
      </div>
    </article>
  );
}
