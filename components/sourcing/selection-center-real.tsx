"use client";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { SourcingDiscovery } from "@/components/sourcing/sourcing-discovery";
import type {
  SourcingV3Graph,
  V3ProductModel,
  V3SourceSku,
} from "@/lib/sourcing/v3";
type Offer = {
  id: string;
  external_id: string | null;
  source_url: string;
  title: string;
  image_url: string | null;
  supplier_name: string | null;
  price_min: number | null;
  price_max: number | null;
  minimum_order_quantity: number | null;
  sales_count: number | null;
  repurchase_rate: number | null;
  return_shipping: boolean | null;
  one_piece_delivery: boolean | null;
  blind_shipping: boolean | null;
  no_reason_return: boolean | null;
  shop_age: number | null;
  quality_rate: number | null;
  delivery_rate: number | null;
  stock: number | null;
  image_count: number | null;
  has_video: boolean | null;
  inspection: boolean | null;
  candidate_product_id: string | null;
  offer_status: "PASS" | "RISK" | "REJECT" | null;
  offer_reasons: string[] | null;
  raw_data: Record<string, unknown>;
};
type Payload = {
  runId: string | null;
  query?: string;
  stats?: { fetched?: number };
  products?: Offer[];
  v3?: SourcingV3Graph;
  v3Meta?: {
    execution?: "MULTIMODAL" | "DEEPSEEK" | "RULE_FALLBACK";
    requestedModel?: string;
    actualModel?: string;
    fallbackReason?: string | null;
    analyzedAt?: string;
  } | null;
};
type OfferAiSelection = {
  recommendation: "RECOMMENDED" | "USABLE" | "CAUTIOUS" | "NOT_RECOMMENDED"; confidence: "HIGH" | "MEDIUM" | "LOW";
  dimensions: { dropshipFit: string; supplyStability: string; fulfillmentStability: string; qualityConfidence: string; supplierStability: string };
  directionKey: string; advantages: string[]; risks: string[]; conflicts: string[]; missingEvidence: string[];
  recommendationReason: string; finalAdvice: string;
  analyzedAt?: string;
};
type ProductRecognition = { productName: string; sellingTitle?: string; mixedSelling: boolean; mixedSellingType: "NONE" | "VARIANT_ONLY" | "ACCESSORY_MIX" | "MULTI_PRODUCT"; categoryParent: string; categoryChild: string; confidence: "HIGH" | "MEDIUM" | "LOW"; evidence: string[]; risks: string[]; analyzedAt?: string };
const Icon = ({
  children,
  tone = "purple",
}: {
  children: React.ReactNode;
  tone?: string;
}) => <span className={`v2-icon ${tone}`}>{children}</span>;
const Metric = ({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  detail: string;
  tone?: string;
}) => (
  <article className="v2-metric">
    <Icon tone={tone}>{icon}</Icon>
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  </article>
);
const cleanSupplier = (value: string) =>
  value
    .replace(/^(?:严选|精选|实力商家|镇店之宝)\s*/, "")
    .replace(
      /(?:AI?严选指数|\d+(?:\.\d+)?\+人好评|\d(?:\.\d+)?(?=\s*(?:入选|猫咪|商品|跨境|人气))|商品复购率|\d+\+人已加购|新人价|[¥￥]\s*\d)[\s\S]*$/,
      "",
    )
    .trim();
const DEFAULT_PHASH_MERGE_THRESHOLD = 30;
function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60), seconds = totalSeconds % 60;
  return minutes ? `${minutes}分${String(seconds).padStart(2, "0")}秒` : `${seconds}秒`;
}

function phashDistance(left: string, right: string) {
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (bits) {
    distance += Number(bits & BigInt(1));
    bits >>= BigInt(1);
  }
  return distance;
}

function mergeSourceSkuColors(
  rows: V3SourceSku[],
  hashes: Record<string, string>,
  threshold = DEFAULT_PHASH_MERGE_THRESHOLD,
) {
  const groups = new Map<string, V3SourceSku[]>();
  const singles: V3SourceSku[] = [];
  for (const row of rows) {
    if (row.price == null || !hashes[row.id]) {
      singles.push(row);
      continue;
    }
    const key = [row.offerId, row.supplierName, row.price].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const imageClusters = [...groups.values()].flatMap((group) => {
    const clusters: V3SourceSku[][] = [];
    for (const row of group) {
      const target = clusters.find((cluster) =>
        cluster.some(
          (candidate) =>
            phashDistance(hashes[row.id], hashes[candidate.id]) < threshold,
        ),
      );
      if (target) target.push(row);
      else clusters.push([row]);
    }
    return clusters;
  });
  const merged = imageClusters.flatMap((group) => {
    if (group.length < 2) return group;
    const representative = group.find((row) => row.image) ?? group[0];
    return [
      {
        ...representative,
        id: `merged-colors:${group.map((row) => row.id).join("|")}`,
        rawName: group.map((row) => row.rawName).join(" / "),
        stock: group.every((row) => row.stock != null)
          ? group.reduce((total, row) => total + (row.stock ?? 0), 0)
          : null,
        rawProperties: {
          ...representative.rawProperties,
          mergedSourceSkuIds: group.map((row) => row.id),
          mergedSourceSkus: group.map((row) => ({
            id: row.id,
            rawName: row.rawName,
            image: row.image,
            price: row.price,
            stock: row.stock,
            hash: hashes[row.id],
            phashDistance: Math.min(
              ...group
                .filter((candidate) => candidate.id !== row.id)
                .map((candidate) =>
                  phashDistance(hashes[row.id], hashes[candidate.id]),
                ),
            ),
          })),
        },
      },
    ];
  });
  return [...merged, ...singles];
}
export function RealDiscoveryWorkspace({ runId }: { runId?: string } = {}) {
  const [data, setData] = useState<Payload | null>(null),
    [tab, setTab] = useState<"models" | "pending" | "offers">("offers"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0),
    [sourceFilter, setSourceFilter] = useState<"all" | "pending">("all"),
    [mergeColors] = useState(false),
    [phashThreshold] = useState(DEFAULT_PHASH_MERGE_THRESHOLD),
    [imageHashes] = useState<Record<string, string>>({}),
    [rechecking, setRechecking] = useState(false),
    [ruleSelecting, setRuleSelecting] = useState(false),
    [recognizingProducts, setRecognizingProducts] = useState(false),
    [message, setMessage] = useState(""),
    [aiProgress, setAiProgress] = useState({ completed: 0, total: 0 }),
    [aiLastRunFailed, setAiLastRunFailed] = useState(false),
    [aiLastRunSucceeded, setAiLastRunSucceeded] = useState(false),
    [operationClock, setOperationClock] = useState<{ phase: "RULE" | "AI" | "ENRICH"; startedAt: number; endedAt?: number } | null>(null),
    [clockNow, setClockNow] = useState(0);
  useEffect(() => {
    if (!operationClock || operationClock.endedAt) return;
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [operationClock]);
  const refreshData = useCallback(async () => {
    const url = runId
      ? `/api/sourcing/latest?runId=${encodeURIComponent(runId)}`
      : "/api/sourcing/latest";
    await fetch(url)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "读取失败");
        setData(body);
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : "读取失败"));
  }, [runId]);
  useEffect(() => {
    void refreshData();
  }, [refreshData]);
  const graph = data?.v3,
    models = (graph?.models ?? []).filter((x) => x.name.includes(query)),
    model = models[selected] ?? models[0],
    allSourceSkus = graph?.sourceSkus ?? [],
    pending = allSourceSkus.filter((x) => x.price == null || x.stock == null),
    visibleSourceSkus = sourceFilter === "pending" ? pending : allSourceSkus;
  const offers = data?.products ?? [];
  const syncingSelectedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!runId) return;
    const missing = offers.filter((offer) => savedSelection(offer) === "PRIMARY" && !offer.candidate_product_id && !syncingSelectedRef.current.has(offer.id));
    if (!missing.length) return;
    missing.forEach((offer) => syncingSelectedRef.current.add(offer.id));
    void (async () => {
      let completed = 0;
      try {
        for (const offer of missing) {
          const response = await fetch("/api/sourcing/offer-selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, offerId: offer.id, status: "PRIMARY" }) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? `同步 ${offer.external_id ?? offer.id} 失败`);
          completed += 1;
        }
        await refreshData();
        setMessage(`已自动补齐 ${completed} 条已选择货源到商品中心。`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "已选择货源同步失败");
      }
    })();
  }, [offers, refreshData, runId]);
  const recognitionCandidates = offers.filter((offer) => ruleDecisionOf(offer) === "PASSED" && savedSelection(offer) !== "REJECTED");
  const aiCandidates = recognitionCandidates;
  const aiSelectionComplete = aiCandidates.length > 0 && aiCandidates.every((offer) => {
    const ai = rawRecord(offer.raw_data.aiSelection), detail = rawRecord(offer.raw_data.detailEnrichment);
    const analyzedAt = Date.parse(String(ai.analyzedAt ?? "")), detailCapturedAt = Date.parse(String(detail.capturedAt ?? ""));
    return ["offer-source-evaluation-v1", "offer-source-evaluation-v2-combined"].includes(String(ai.promptVersion)) && Boolean(ai.recommendation) && (!Number.isFinite(detailCapturedAt) || (Number.isFinite(analyzedAt) && analyzedAt >= detailCapturedAt));
  });
  const productRecognitionComplete = recognitionCandidates.length > 0 && recognitionCandidates.every((offer) => {
    const recognition = rawRecord(offer.raw_data.productRecognition), detail = rawRecord(offer.raw_data.detailEnrichment);
    const analyzedAt = Date.parse(String(recognition.analyzedAt ?? "")), detailCapturedAt = Date.parse(String(detail.capturedAt ?? ""));
    return recognition.promptVersion === "offer-combined-recognition-evaluation-v4-evidence-naming" && Array.isArray(recognition.productGroups) && recognition.productGroups.length > 0 && (!Number.isFinite(detailCapturedAt) || (Number.isFinite(analyzedAt) && analyzedAt >= detailCapturedAt));
  });
  const headerRulePassed = offers.filter((offer) => ruleDecisionOf(offer) === "PASSED").length;
  const headerAiRecommended = offers.filter((offer) => offerAiSelection(offer)?.recommendation === "RECOMMENDED").length;
  const aiAnalyzedCount = offers.filter((offer) => offerAiSelection(offer)).length;
  const detailedOffers = offers.filter((offer) => Boolean(offer.raw_data.detailEnrichment)).length;
  const hasPrimary = offers.some((offer) => savedSelection(offer) === "PRIMARY");
  const messageTone = /失败|错误|超时/.test(message) ? "error" : /淘汰|缺失|严格/.test(message) ? "warning" : "success";
  const elapsedSeconds = operationClock ? Math.max(0, Math.floor(((operationClock.endedAt ?? clockNow) - operationClock.startedAt) / 1000)) : 0;
  const activePhaseLabel = ruleSelecting ? "解析与规则" : recognizingProducts ? "AI货源选择" : rechecking ? "解析与规则" : "";
  const aiStageComplete = aiSelectionComplete;
  const parseAndRuleComplete = offers.length > 0 && detailedOffers === offers.length && offers.every((offer) => Boolean(ruleSelectionOf(offer).screenedAt));
  const pipelineSteps = [
    { label: "搜索货源", done: offers.length > 0, active: false, detail: offers.length ? `${offers.length} 条` : "待运行" },
    { label: "解析与规则", done: parseAndRuleComplete, active: (operationClock?.phase === "ENRICH" && !operationClock.endedAt) || ruleSelecting || rechecking, detail: parseAndRuleComplete ? `${headerRulePassed} 条通过` : `${detailedOffers}/${offers.length} 已解析` },
    { label: "AI货源选择", done: aiStageComplete, active: recognizingProducts, detail: recognizingProducts ? "一次评估中" : aiStageComplete ? `${aiAnalyzedCount} 条完成` : "待运行" },
    { label: "选择主货源", done: hasPrimary, active: aiStageComplete && !hasPrimary, detail: hasPrimary ? "已完成" : aiStageComplete ? "等待选择" : "待运行" },
  ];
  const supplierCount = new Set(
    offers.map((offer) => offer.supplier_name).filter(Boolean),
  ).size;
  async function recheckPending() {
    if (!data?.runId || !pending.length || rechecking) return;
    const offers = [
      ...new Map(
        pending.map((sku) => [
          sku.offerId,
          {
            id: sku.offerId,
            externalId: sku.externalOfferId,
            sourceUrl: sku.sourceUrl,
            title: sku.rawName,
          },
        ]),
      ).values(),
    ];
    const requestId = crypto.randomUUID();
    setRechecking(true);
    setMessage(`正在重查 ${offers.length} 个待核实 Offer…`);
    try {
      const result = await new Promise<{
        details?: unknown[];
        failures?: unknown[];
        error?: string;
      }>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", receive);
          reject(new Error("待核实货源重查超时，请检查 1688 登录状态"));
        }, 480_000);
        function receive(event: MessageEvent) {
          if (
            event.origin !== location.origin ||
            event.data?.requestId !== requestId ||
            event.data?.type !== "AI_SHOP_CAPTURE_RESULT"
          )
            return;
          window.clearTimeout(timeout);
          window.removeEventListener("message", receive);
          resolve(event.data);
        }
        window.addEventListener("message", receive);
        window.postMessage(
          { type: "AI_SHOP_ENRICH_1688", requestId, offers },
          location.origin,
        );
      });
      if (result.error) throw new Error(result.error);
      const save = await fetch("/api/sourcing/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: data.runId,
          details: result.details ?? [],
        }),
      });
      const saved = await save.json();
      if (!save.ok) throw new Error(saved.error ?? "保存重查结果失败");
      await refreshData();
      const failed = result.failures?.length ?? 0;
      setMessage(
        failed
          ? `重查完成，仍有 ${failed} 个 Offer 的关键规则数据未读取。`
          : `已完成 ${offers.length} 个待核实 Offer 的自动重查。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "待核实货源重查失败");
    } finally {
      setRechecking(false);
    }
  }
  async function runRuleSelection() {
    if (!data?.runId || ruleSelecting) return;
    setRuleSelecting(true); setOperationClock({ phase: "RULE", startedAt: Date.now() }); setMessage("正在执行稳定代发规则初筛…");
    try {
      const response = await fetch("/api/sourcing/rule-selection", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: data.runId }),
      });
      const responseText = await response.text();
      let body: Record<string, unknown> = {};
      if (responseText) try { body = JSON.parse(responseText) as Record<string, unknown>; } catch { body = {}; }
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : responseText || `规则初筛失败（HTTP ${response.status}）`);
      await refreshData();
      setMessage(responseText ? `规则初筛完成：通过 ${body.passed ?? 0}，规则淘汰 ${body.rejected ?? 0}${body.preserved ? `；保留 ${body.preserved} 个人工选择` : ""}。` : "规则初筛已执行并刷新结果；服务未返回统计信息。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "规则初筛失败");
    } finally { setRuleSelecting(false); setOperationClock((current) => current?.phase === "RULE" ? { ...current, endedAt: Date.now() } : current); }
  }
  async function runProductRecognition() {
    if (!data?.runId || recognizingProducts) return;
    setRecognizingProducts(true); setAiLastRunFailed(false); setAiLastRunSucceeded(false); setAiProgress({ completed: 0, total: recognitionCandidates.length }); setOperationClock({ phase: "AI", startedAt: Date.now() }); setMessage("正在逐条识别分类与评估货源…");
    try {
      const ids = recognitionCandidates.map((offer) => offer.id);
      setMessage(`正在准备 ${ids.length} 个未淘汰货源的分析主图…`);
      const imageResponse = await fetch("/api/sourcing/product-recognition/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: data.runId, offerIds: ids }) });
      const imageText = await imageResponse.text();
      let imageBody: Record<string, unknown> = {};
      if (imageText) try { imageBody = JSON.parse(imageText) as Record<string, unknown>; } catch { imageBody = {}; }
      if (!imageResponse.ok) throw new Error(typeof imageBody.error === "string" ? imageBody.error : imageText || "分析主图准备失败");
      const batches = ids.map((id) => [id]);
      let processed = 0;
      const failures: string[] = [];
      const runBatch = async (offerIds: string[], index: number) => {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const response = await fetch("/api/sourcing/product-recognition", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: data.runId, offerIds }) });
          const responseText = await response.text();
          let body: Record<string, unknown> = {};
          if (responseText) try { body = JSON.parse(responseText) as Record<string, unknown>; } catch { body = {}; }
          const errorText = typeof body.error === "string" ? body.error : responseText || `HTTP ${response.status}`;
          if (!response.ok && /超时|timeout|abort/i.test(errorText)) { failures.push(`第${index + 1}条：${errorText}`); return; }
          if (!response.ok && attempt === 1 && response.status >= 500) { setMessage(`第${index + 1}条服务异常，正在重试…`); continue; }
          if (!response.ok) { failures.push(`第${index + 1}条：${errorText}`); return; }
          if (!responseText) { failures.push(`第${index + 1}条未返回结果`); return; }
          processed += Array.isArray(body.results) ? body.results.length : 0;
          return;
        }
      };
      for (let index = 0; index < batches.length; index += 1) {
        setMessage(`正在识别分类与评估 ${index + 1}/${batches.length}…`);
        await runBatch(batches[index], index);
        setAiProgress({ completed: index + 1, total: batches.length });
      }
      await refreshData();
      setAiLastRunFailed(failures.length > 0);
      setAiLastRunSucceeded(failures.length === 0 && processed === ids.length);
      setMessage(failures.length ? `AI逐条判断完成：成功 ${processed} 条，失败 ${failures.length} 条；${failures.slice(0, 3).join("；")}` : `AI逐条判断完成，共处理 ${processed} 个候选货源。`);
    } catch (error) { setAiLastRunFailed(true); setAiLastRunSucceeded(false); setMessage(error instanceof Error ? error.message : "AI商品识别失败"); }
    finally { setRecognizingProducts(false); setOperationClock((current) => current?.phase === "AI" ? { ...current, endedAt: Date.now() } : current); }
  }
  async function retryFailedOfferDetails(targetOffer?: Offer) {
    if (!data?.runId || rechecking) return;
    const failedOffers = offers.filter(reparseRequired);
    const offersToRetry = targetOffer ? [targetOffer] : failedOffers;
    if (!offersToRetry.length) {
      setMessage("当前没有关键规则数据缺失的货源。");
      return;
    }
    const requestId = crypto.randomUUID();
    setRechecking(true); setOperationClock({ phase: "ENRICH", startedAt: Date.now() });
    setMessage(`正在重新解析 ${offersToRetry.length} 个失败项…`);
    try {
      const result = await new Promise<{ details?: unknown[]; failures?: Array<{ error?: string }>; error?: string }>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener("message", receive);
          reject(new Error("失败项重新解析超时，请检查1688登录状态"));
        }, 480_000);
        function receive(event: MessageEvent) {
          if (event.origin !== location.origin || event.data?.requestId !== requestId) return;
          if (event.data?.type === "AI_SHOP_CAPTURE_PROGRESS") {
            setMessage(event.data.message || `正在重新解析 ${offersToRetry.length} 个失败项…`);
            return;
          }
          if (event.data?.type !== "AI_SHOP_CAPTURE_RESULT") return;
          window.clearTimeout(timeout);
          window.removeEventListener("message", receive);
          resolve(event.data);
        }
        window.addEventListener("message", receive);
        window.postMessage({
          type: "AI_SHOP_ENRICH_1688",
          requestId,
          ...(targetOffer
            ? { offers: [{ id: targetOffer.id, externalId: targetOffer.external_id, sourceUrl: targetOffer.source_url, title: targetOffer.title }] }
            : { offers: failedOffers.map((offer) => ({ id: offer.id, externalId: offer.external_id, sourceUrl: offer.source_url, title: offer.title })) }),
        }, location.origin);
      });
      if (result.error) throw new Error(result.error);
      if (result.details?.length) {
        const response = await fetch("/api/sourcing/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: data.runId, details: result.details }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "保存重新解析结果失败");
      }
      const screened = await fetch("/api/sourcing/rule-selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: data.runId }) });
      const screening = await screened.json();
      if (!screened.ok) throw new Error(screening.error ?? "重新执行规则初筛失败");
      await refreshData();
      const succeeded = result.details?.length ?? 0, failed = result.failures?.length ?? 0;
      setMessage(`重新解析完成：成功补全 ${succeeded} 个，仍然缺失 ${failed} 个，重新判断为通过 ${screening.passed ?? 0} 个，因不符合规则继续淘汰 ${screening.rejected ?? 0} 个。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "失败项重新解析失败");
    } finally {
      setRechecking(false); setOperationClock((current) => current?.phase === "ENRICH" ? { ...current, endedAt: Date.now() } : current);
    }
  }
  async function runAiOfferSelection() {
    if (!data?.runId || recognizingProducts) return;
    setRecognizingProducts(true); setOperationClock({ phase: "AI", startedAt: Date.now() }); setMessage("AI正在一次评估全部候选货源，不生成上架文案或素材…");
    try {
      const response = await fetch("/api/sourcing/ai-selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: data.runId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "AI货源选择失败");
      await refreshData();
      setMessage(`AI货源选择完成：已评估 ${Array.isArray(body.results) ? body.results.length : 0} 个候选。商品文案与素材将在铺货后读取淘宝草稿再生成。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI货源选择失败");
    } finally {
      setRecognizingProducts(false); setOperationClock((current) => current?.phase === "AI" ? { ...current, endedAt: Date.now() } : current);
    }
  }
  function retryOfferDetail(offer: Offer) {
    return retryFailedOfferDetails(offer);
  }
  const counts = graph?.counts ?? {
      offers: 0,
      sourceSkus: 0,
      models: 0,
      variants: 0,
      comparableSources: 0,
      accessories: 0,
      unknownDimensions: 0,
    },
    status = !data?.runId
      ? "⚪ 未运行"
      : detailedOffers < offers.length
        ? "🟡 货源详情待获取"
        : "🟢 本次搜索已完成";
  if (runId) {
    return (
      <div className="v2-page discovery sourcing-results-page">
        <div className="v2-crumb">
          选品中心　/　货源发现{data?.query ? `　/　${data.query}` : ""}
        </div>
        <header className="v2-page-head">
          <div>
            <h1>{data?.query || "货源搜索结果"}</h1>
            <p>{offers.length} 条结果 · 规则通过 {headerRulePassed} · AI 推荐 {headerAiRecommended}</p>
          </div>
          <div className="v2-actions sourcing-page-actions">
            <Link className="v2-primary" href="/products/discover/search">新建货源搜索</Link>
            {!parseAndRuleComplete && <button className="v2-primary" disabled={ruleSelecting || rechecking} onClick={() => detailedOffers < offers.length ? void retryFailedOfferDetails() : void runRuleSelection()}>{rechecking ? "解析中…" : ruleSelecting ? "规则筛选中…" : detailedOffers < offers.length ? "继续解析货源" : "执行规则筛选"}</button>}
            {parseAndRuleComplete && !aiStageComplete && <button className="v2-primary" disabled={recognizingProducts || !recognitionCandidates.length} onClick={() => void runAiOfferSelection()}>{recognizingProducts ? "AI货源评估中…" : "AI选择货源"}</button>}
            {hasPrimary && <Link className="v2-primary" href="/products/manage">进入商品管理</Link>}
            <details className="sourcing-more-actions"><summary>更多操作</summary><div><button type="button" onClick={() => window.dispatchEvent(new Event("open-sourcing-rule-editor"))}>编辑规则</button><button type="button" disabled={ruleSelecting} onClick={() => void runRuleSelection()}>重新运行规则</button><button type="button" disabled={rechecking || !offers.some(reparseRequired)} onClick={() => void retryFailedOfferDetails()}>重新解析缺失项</button><Link href="/products/discover">返回任务列表</Link></div></details>
          </div>
        </header>
        <section className="sourcing-pipeline-progress" aria-label="货源处理进度">
          <div className="pipeline-progress-head"><div><b>{activePhaseLabel ? `正在${activePhaseLabel}` : pipelineSteps.every((step) => step.done) ? "本轮处理已完成" : "货源处理进度"}</b><span>{operationClock ? `${operationClock.endedAt ? "本次耗时" : "已运行"} ${formatDuration(elapsedSeconds)}` : "完成当前步骤后自动保留结果"}</span></div><strong>{Math.round((pipelineSteps.filter((step) => step.done).length / pipelineSteps.length) * 100)}%</strong></div>
          <div className="pipeline-step-track">{pipelineSteps.map((step, index) => <div key={step.label} className={`${step.done ? "done" : ""}${step.active ? " active" : ""}`}><i>{step.done ? "✓" : index + 1}</i><span><b>{step.label}</b><small>{step.detail}</small></span></div>)}</div>
        </section>
        {aiStageComplete && <div className="ai-run-summary"><div><b>第一阶段 AI 货源选择已完成</b><span>已评估 {aiAnalyzedCount} 个候选；本阶段不会生成或修改淘宝商品内容。</span></div></div>}
        {message && <div className={`status-box ${messageTone}`}>{message}</div>}
        {!data && !message ? (
          <div className="status-box">正在加载本轮货源…</div>
        ) : offers.length ? (
          <section className="v2-card sourcing-result-workspace">
            <OfferTable offers={offers} runId={data?.runId ?? runId} onRefresh={refreshData} onRetryOffer={retryOfferDetail} rechecking={rechecking} />
          </section>
        ) : (
          <div className="v2-card v2-empty">
            <b>本轮暂时没有可显示的货源</b>
            <span>返回搜索页重新搜索，或确认 1688 采集已完成。</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="v2-page discovery">
      <div className="v2-crumb">
        选品中心　/　货源发现{data?.query ? `　/　${data.query}` : ""}
      </div>
      <header className="v2-page-head">
        <div>
          <h1>1688 货源筛选{data?.query ? ` · ${data.query}` : ""}</h1>
          <p>从 1688 搜索开始，在同一次搜索中查看并筛选真实 Offer 与供应商。</p>
        </div>
        <div className="v2-actions">
          <Link
            className="v2-secondary"
            href="/products/discover"
          >
            返回任务总页
          </Link>
        </div>
      </header>
      <SourcingDiscovery
        compact
        initialRunId={runId}
        onDataChange={refreshData}
      />
      <section className="v2-metrics">
        <Metric
          icon="⌕"
          label="搜索发现"
          value={data?.stats?.fetched ?? 0}
          detail="搜索结果"
        />
        <Metric
          icon="▱"
          label="1688 Offer"
          value={offers.length}
          detail="本次搜索货源"
          tone="blue"
        />
        <Metric
          icon="◇"
          label="已获取详情"
          value={detailedOffers}
          detail="商品与履约事实"
          tone="green"
        />
        <Metric
          icon="⌑"
          label="供应商"
          value={supplierCount}
          detail="搜索结果中的商家"
          tone="orange"
        />
      </section>
      <section className="v2-decision-banner">
        <Icon tone="orange">!</Icon>
        <div>
          <span>本次搜索状态</span>
          <h2>{data?.query ?? "当前商品"}</h2>
          <b>{status}</b>
        </div>
        <dl>
          <dt>原因</dt>
          <dd>
            {detailedOffers < offers.length
              ? `${offers.length - detailedOffers} 个 Offer 尚未获取详情`
              : `${offers.length} 个 Offer 已进入同批次筛选`}
          </dd>
          <dt>影响</dt>
          <dd>
            {detailedOffers < offers.length
              ? "可先查看搜索结果，获取详情后补充供应与履约数据"
              : "可以直接按供应商和货源事实进行筛选"}
          </dd>
        </dl>
        <button
          className="v2-warn"
          onClick={() => setTab("offers")}
        >
          查看本次货源
        </button>
      </section>
      {message && (
        <div className="v2-blocker">
          <Icon tone="orange">!</Icon>
          <div>
            <b>{message}</b>
            <span>真实数据未就绪时页面保持空状态，不填充 Demo 商品。</span>
          </div>
        </div>
      )}
      <div className="v2-tabs"><button className="active">本次搜索货源 ({offers.length})</button></div>
      {false && tab === "models" && (
        <>
          <div className="v2-toolbar">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(0);
              }}
              placeholder="搜索商品款型"
            />
            <select>
              <option>按货源数量排序</option>
            </select>
          </div>
          <div className="v2-split">
            <section className="v2-card table-card">
              <ModelTable
                models={models}
                runId={data?.runId}
                selected={model?.id}
                onSelect={setSelected}
              />
            </section>
            <ModelDrawer model={model} graph={graph} runId={data?.runId} />
          </div>
        </>
      )}
      {false && tab === "pending" && (
        <section className="v2-card table-card">
          <div className="v2-toolbar">
            <div className="v2-filter-group">
              <button
                className={
                  sourceFilter === "all" ? "v2-primary" : "v2-secondary"
                }
                onClick={() => setSourceFilter("all")}
              >
                全部货源 ({allSourceSkus.length})
              </button>
              <button
                className={
                  sourceFilter === "pending" ? "v2-primary" : "v2-secondary"
                }
                onClick={() => setSourceFilter("pending")}
              >
                待核实 ({pending.length})
              </button>
            </div>
            <button
              className="v2-secondary"
              disabled={!pending.length || rechecking}
              onClick={() => void recheckPending()}
            >
              {rechecking
                ? "正在自动重查…"
                : `↻ 一键重查待核实 (${pending.length})`}
            </button>
          </div>
          <PendingTable
            rows={
              mergeColors
                ? mergeSourceSkuColors(
                    visibleSourceSkus,
                    imageHashes,
                    phashThreshold,
                  )
                : visibleSourceSkus
            }
            offers={data?.products ?? []}
            phashThreshold={phashThreshold}
            onAction={setMessage}
          />
        </section>
      )}
      {tab === "offers" && (
        <section className="v2-card table-card">
          <OfferTable offers={offers} runId={data?.runId ?? null} onRefresh={refreshData} onRetryOffer={retryOfferDetail} rechecking={rechecking} />
        </section>
      )}
      {!data?.runId && (
        <section className="v2-card" style={{ marginTop: 14 }}>
          <div className="v2-empty">
            <Icon>⌕</Icon>
            <b>当前账号没有可用的真实货源任务</b>
            <span>请在下方采集工具运行搜索，并抓取 Offer 详情。</span>
          </div>
        </section>
      )}
    </div>
  );
}
function ModelTable({
  models,
  runId,
  selected,
  onSelect,
}: {
  models: V3ProductModel[];
  runId?: string | null;
  selected?: string;
  onSelect: (i: number) => void;
}) {
  return (
    <table className="v2-table">
      <thead>
        <tr>
          <th>商品款型</th>
          <th>图片</th>
          <th>供应商</th>
          <th>采购 SKU</th>
          <th>数据状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {models.map((m, i) => {
          return (
            <tr
              className={selected === m.id ? "active" : ""}
              key={m.id}
              onClick={() => onSelect(i)}
            >
              <td>
                <b>{m.name}</b>
                <small>{m.productFamily}</small>
              </td>
              <td>
                {m.representativeImage ? (
                  <img
                    className="v2-mini-img"
                    src={m.representativeImage}
                    alt=""
                  />
                ) : (
                  <span className="v2-mini-img">🐈</span>
                )}
              </td>
              <td>
                <b>{m.supplierCount}</b>
                <small>货源数量</small>
              </td>
              <td>{m.sourceSkuIds.length}</td>
              <td>
                <span className="v2-pill success">已识别</span>
                {m.pendingCount > 0 && <small>{m.pendingCount} 项信息待补充</small>}
              </td>
              <td>
                <Link
                  href={
                    runId
                      ? `/products/discover/runs/${runId}/models/${m.id}`
                      : `/products/discover/models/${m.id}`
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  查看详情
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
function ModelDrawer({
  model,
  graph,
  runId,
}: {
  model?: V3ProductModel;
  graph?: SourcingV3Graph;
  runId?: string | null;
}) {
  if (!model)
    return (
      <aside className="v2-drawer">
        <div className="v2-empty">
          <Icon>◇</Icon>
          <b>暂无已识别商品款型</b>
          <span>待识别采购 SKU 不会生成虚假款型。</span>
        </div>
      </aside>
    );
  const sources =
    graph?.sourceSkus.filter((x) => model.sourceSkuIds.includes(x.id)) ?? [];
  return (
    <aside className="v2-drawer">
      <div className="v2-drawer-head">
        <div>
          <h2>{model.name}</h2>
          <span className="v2-pill success">🟢 已识别</span>
        </div>
      </div>
      <div className="v2-model-hero">
        <div className="v2-product-img">
          {model.representativeImage ? (
            <img src={model.representativeImage} alt={model.name} />
          ) : (
            "🐈"
          )}
        </div>
        <dl>
          <dt>供应商数</dt>
          <dd>{model.supplierCount} 家</dd>
          <dt>采购 SKU</dt>
          <dd>{model.sourceSkuIds.length} 个</dd>
          <dt>待补充信息</dt>
          <dd>{model.pendingCount} 项（不阻断）</dd>
        </dl>
      </div>
      <section className="v2-drawer-section v2-decision-summary">
        <h3>当前商品状态</h3>
        <dl>
          <dt>状态</dt>
          <dd><b>🟢 可选择</b></dd>
          <dt>货源数据</dt>
          <dd>{sources.length} 个 SourceSKU · {model.supplierCount} 家供应商</dd>
          <dt>下一步</dt>
          <dd>查看详情并选择商品</dd>
        </dl>
      </section>
      <section className="v2-drawer-section">
        <h3>商品概述</h3>
        <p>
          <b>售卖结构：</b>
          {model.structure ?? "待确认"}
          <br />
          {model.evidence.join("；")}
        </p>
      </section>
      <div className="v2-drawer-footer">
        <Link
          className="v2-primary"
          href={
            runId
              ? `/products/discover/runs/${runId}/models/${encodeURIComponent(model.id)}`
              : `/products/discover/models/${encodeURIComponent(model.id)}`
          }
        >
          查看详情
        </Link>
      </div>
    </aside>
  );
}
function PendingTable({
  rows,
  offers,
  phashThreshold,
  onAction,
}: {
  rows: V3SourceSku[];
  offers: Offer[];
  phashThreshold: number;
  onAction: (v: string) => void;
}) {
  const [preview, setPreview] = useState<V3SourceSku | null>(null);
  const [expandedMerge, setExpandedMerge] = useState<string | null>(null);
  const offerTitles = new Map(
    offers.map((offer) => [offer.id, productNameFromTitle(offer.title)]),
  );
  return (
    <>
      <table className="v2-table">
        <thead>
          <tr>
            <th>图片</th>
            <th>商品名</th>
            <th>SourceSKU</th>
            <th>1688原始SKU</th>
            <th>供应商</th>
            <th>采购价</th>
            <th>库存</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const mergedSourceSkus = Array.isArray(
              x.rawProperties.mergedSourceSkus,
            )
              ? (x.rawProperties.mergedSourceSkus as Array<{
                  id: string;
                  rawName: string;
                  image: string | null;
                  price: number | null;
                  stock: number | null;
                  hash: string;
                  phashDistance: number;
                }>)
              : [];
            const isMerged = mergedSourceSkus.length > 1;
            const isExpanded = expandedMerge === x.id;
            return (
              <Fragment key={x.id}>
            <tr
              onClick={
                isMerged
                  ? () => setExpandedMerge(isExpanded ? null : x.id)
                  : undefined
              }
              style={isMerged ? { cursor: "pointer" } : undefined}
            >
              <td>
                {x.image ? (
                  <button
                    className="v2-image-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPreview(x);
                    }}
                    aria-label={`放大查看 ${x.rawName}`}
                  >
                    <img className="v2-mini-img" src={x.image} alt="" />
                  </button>
                ) : (
                  <span className="v2-mini-img">暂无</span>
                )}
              </td>
              <td className="v2-product-name-cell">
                <b>{offerTitles.get(x.offerId) ?? "商品名待核实"}</b>
              </td>
              <td>
                <b>{x.rawName}</b>
                {isMerged && (
                  <small>
                    {isExpanded ? "▾" : "▸"} 已合并 {mergedSourceSkus.length} 个颜色 SKU，点击
                    {isExpanded ? "收起" : "展开核对"}
                  </small>
                )}
                {formatAiSpecifications(x) && (
                  <small>{formatAiSpecifications(x)}</small>
                )}
                <small>{x.externalOfferId}</small>
              </td>
              <td>
                <b>
                  {typeof x.rawProperties.originalSourceSkuName === "string"
                    ? x.rawProperties.originalSourceSkuName
                    : "需重新运行属性解析"}
                </b>
              </td>
              <td>{cleanSupplier(x.supplierName)}</td>
              <td>
                {x.price == null ? (
                  <a
                    href={x.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="打开 1688 核实采购价"
                  >
                    待核实 ↗
                  </a>
                ) : (
                  money(x.price)
                )}
              </td>
              <td>
                {x.stock == null ? (
                  <a
                    href={x.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="打开 1688 核实库存"
                  >
                    待核实 ↗
                  </a>
                ) : (
                  inventory(x.stock)
                )}
              </td>
              <td>
                <div className="v2-row-actions">
                  <a
                    href={x.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                  >
                    跳转 1688 ↗
                  </a>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onAction(`已将「${x.rawName}」加入人工确认队列。`)
                    }}
                  >
                    人工确认
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onAction(
                        `已在当前视图忽略「${x.rawName}」；原始数据未删除。`,
                      )
                    }}
                  >
                    忽略
                  </button>
                </div>
              </td>
            </tr>
            {isMerged && isExpanded && (
              <tr>
                <td colSpan={8} style={{ background: "#f8fafc", padding: 16 }}>
                  <table className="v2-table compact">
                    <thead>
                      <tr>
                        <th>原始图片</th>
                        <th>原始 SourceSKU</th>
                        <th>采购价</th>
                        <th>库存</th>
                        <th>组内最小 pHash 距离</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mergedSourceSkus.map((sourceSku) => (
                        <tr key={sourceSku.id}>
                          <td>
                            {sourceSku.image ? (
                              <img className="v2-mini-img" src={sourceSku.image} alt="" />
                            ) : (
                              "暂无"
                            )}
                          </td>
                          <td><b>{sourceSku.rawName}</b></td>
                          <td>{sourceSku.price == null ? "待核实" : money(sourceSku.price)}</td>
                          <td>{sourceSku.stock == null ? "待核实" : inventory(sourceSku.stock)}</td>
                          <td>
                            {sourceSku.phashDistance}
                              <small>当前阈值 &lt; {phashThreshold}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {preview?.image && (
        <div
          className="v2-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={preview.rawName}
          onClick={() => setPreview(null)}
        >
          <div onClick={(event) => event.stopPropagation()}>
            <button onClick={() => setPreview(null)} aria-label="关闭图片预览">
              ×
            </button>
            <img src={preview.image} alt="" />
            <b>{preview.rawName}</b>
          </div>
        </div>
      )}
    </>
  );
}
function formatAiSpecifications(sku: V3SourceSku) {
  const specifications = Array.isArray(sku.rawProperties.deepseekAttributes)
    ? sku.rawProperties.deepseekAttributes
    : sku.rawProperties.aiSpecifications;
  if (!Array.isArray(specifications)) return "";
  return specifications
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      return record.name && record.value
        ? [
            `${String(record.name)}：${String(record.value)}${record.basis ? `（${String(record.basis)}）` : ""}`,
          ]
        : [];
    })
    .join(" · ");
}
function productNameFromTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const commercialInfo =
    /\s*(?:[|｜]\s*)?(?:[¥￥]\s*\d|限时价|新人价|近\s*\d+\s*天|全网\s*\d|\d+\+件|退货包运费|先采后付|回头率\s*\d|商品复购率|下单返)/;
  const productName = normalized.split(commercialInfo, 1)[0]?.trim();
  return productName || normalized;
}
type OfferSelection = "CANDIDATE" | "PRIMARY" | "BACKUP" | "REJECTED";
type OfferFilter = "ALL" | "RULE_PASSED" | "DATA_PENDING" | "RULE_REJECTED" | "AI_RECOMMENDED" | "UNDECIDED" | "SELECTED" | "MANUAL_REJECTED";
const savedSelection = (offer: Offer): OfferSelection => {
  const value = ((offer.raw_data.sourcingSelection ?? {}) as Record<string, unknown>).status;
  return ["PRIMARY", "BACKUP", "REJECTED"].includes(String(value))
    ? (value as OfferSelection)
    : "CANDIDATE";
};
const selectionLabel: Record<OfferSelection, string> = {
  CANDIDATE: "未决定",
  PRIMARY: "已选择",
  BACKUP: "已选择",
  REJECTED: "人工淘汰",
};
function detailPairs(value: unknown) {
  if (Array.isArray(value)) return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = row.name ?? row.key ?? row.label;
    const content = row.value ?? row.text;
    return name != null && content != null ? [[String(name), String(content)] as const] : [];
  });
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>)
    .filter(([, content]) => ["string", "number", "boolean"].includes(typeof content))
    .map(([name, content]) => [name, String(content)] as const);
  return [];
}
function optionAttribute(option: Record<string, unknown>, pattern: RegExp) {
  const direct = Object.entries(option).find(([key, value]) => pattern.test(key) && typeof value === "string")?.[1];
  if (direct) return String(direct);
  const properties = option.properties ?? option.attributes ?? option.specifications;
  return detailPairs(properties).find(([name]) => pattern.test(name))?.[1] ?? "—";
}
function rawRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringArray(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
function offerAiSelection(offer: Offer): OfferAiSelection | null {
  const value = rawRecord(offer.raw_data.aiSelection);
  if (!["offer-source-evaluation-v1", "offer-source-evaluation-v2-combined"].includes(String(value.promptVersion)) || !value.recommendation || !value.dimensions) return null;
  return value as unknown as OfferAiSelection;
}
function productRecognitionOf(offer: Offer): ProductRecognition | null {
  const value = rawRecord(offer.raw_data.productRecognition);
  return ["offer-combined-recognition-evaluation-v1", "offer-combined-recognition-evaluation-v2-selling-name", "offer-combined-recognition-evaluation-v3-standard-selling-title", "offer-combined-recognition-evaluation-v4-evidence-naming"].includes(String(value.promptVersion)) && Array.isArray(value.productGroups) && value.productGroups.length > 0 && value.productName && value.categoryChild ? value as unknown as ProductRecognition : null;
}
function aiRecommendationLabel(value: OfferAiSelection["recommendation"]) {
  return value === "RECOMMENDED" ? "推荐" : value === "USABLE" ? "可用" : value === "CAUTIOUS" ? "谨慎" : "不推荐";
}
function ruleSelectionOf(offer: Offer) { return rawRecord(offer.raw_data.ruleSelection); }
function ruleDecisionOf(offer: Offer) {
  if (rawRecord(offer.raw_data.sourcingSelection).ruleOverride === true) return "PASSED";
  const value = String(ruleSelectionOf(offer).decision ?? "");
  return value === "PRIMARY" || value === "BACKUP" ? "PASSED" : value;
}
function offerFactsOf(offer: Offer) {
  return rawRecord(offer.raw_data.offerFacts);
}
function numberFact(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function stringFact(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function booleanFact(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "boolean" ? (record[key] as boolean) : null;
}
function priceRange(min: number | null, max: number | null) {
  if (min == null) return "待确认";
  if (max != null && Math.abs(max - min) >= 0.01)
    return `${money(min)}～${money(max)}`;
  return money(min);
}
function sourceSkusOf(detail: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(detail.sourceProducts)) return [];
  return detail.sourceProducts.flatMap((product) => {
    if (!product || typeof product !== "object") return [];
    const record = product as Record<string, unknown>;
    if (!Array.isArray(record.skus)) return [];
    return record.skus
      .filter((sku): sku is Record<string, unknown> => Boolean(sku) && typeof sku === "object")
      .map((sku) => ({ ...sku, sourceProductName: record.normalizedName }) as Record<string, unknown>);
  });
}
function compactSkuId(value: string) {
  const parts = value.split(":");
  const leaf = parts.at(-1) || value;
  return leaf.length > 12 ? `${leaf.slice(0, 6)}…${leaf.slice(-4)}` : leaf;
}
function skuIdentity(sku: Record<string, unknown>) {
  return String(sku.skuId ?? sku.sourceVariantId ?? sku.id ?? "");
}
function skuReadableName(sku: Record<string, unknown>, index: number) {
  const values = Array.isArray(sku.specValues) ? sku.specValues.map(String).filter(Boolean).join(" / ") : "";
  return String(sku.rawSpecText || sku.specName || values || `规格 ${index + 1}`);
}
function RelatedSkuList({ ids, skus }: { ids: string[]; skus: Array<Record<string, unknown>> }) {
  const rows = ids.map((id, index) => {
    const matched = skus.find((sku) => skuIdentity(sku) === id || String(sku.id ?? "") === id);
    return { id, label: matched ? skuReadableName(matched, index) : `规格 ${index + 1}` };
  });
  if (!rows.length) return <span className="decision-empty">未明确关联</span>;
  return <details className="related-sku-list" open={rows.length <= 4}>
    <summary>已关联 {rows.length} 个 SKU <span>{rows.length > 4 ? "展开查看" : ""}</span></summary>
    <ul>{rows.map((row) => <li key={row.id}><b>{row.label}</b><code title={row.id}>{compactSkuId(row.id)}</code></li>)}</ul>
  </details>;
}
function detailCompletenessIssues(offer: Offer) {
  const detail = rawRecord(offer.raw_data.detailEnrichment),
    rawOptions = Array.isArray(detail.rawOptions) ? detail.rawOptions.map(rawRecord) : [],
    usableOptions = rawOptions.filter((option) =>
      option.nodeType === "SKU_SPEC" &&
      option.variantName !== "规格待解析" &&
      (typeof option.price === "number" || typeof option.stock === "number")),
    issues: string[] = [];
  if (!stringFact(detail, "capturedAt")) issues.push("详情未获取");
  if (!usableOptions.length && !sourceSkusOf(detail).length) issues.push("SourceSKU未完整解析");
  if (!offer.supplier_name) issues.push("供应商未解析");
  if (!offer.image_url && !(Array.isArray(detail.mainImages) && detail.mainImages.length)) issues.push("商品主图未解析");
  return issues;
}
const detailParseFailed = (offer: Offer) => detailCompletenessIssues(offer).length > 0;
const reparseRequired = (offer: Offer) => detailParseFailed(offer) || stringArray(ruleSelectionOf(offer).missingFields).length > 0;
function OfferTable({ offers, runId, onRefresh, onRetryOffer, rechecking }: { offers: Offer[]; runId: string | null; onRefresh: () => Promise<void>; onRetryOffer: (offer: Offer) => Promise<void>; rechecking: boolean }) {
  const [status, setStatus] = useState<OfferFilter>("ALL"),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [detailTab, setDetailTab] = useState<"SKU" | "PRODUCT" | "SUPPLIER" | "DROPSHIP" | "FULFILLMENT" | "AI">("SKU"),
    [saving, setSaving] = useState(false),
    [actionError, setActionError] = useState(""),
    [showRuleEditor, setShowRuleEditor] = useState(false),
    [savingRules, setSavingRules] = useState(false),
    [ruleConfig, setRuleConfig] = useState({ requireOnePiece:true, require1688Selection:false, requireReturnShipping:false, requireNoReasonReturn:false, rejectNoSellableSku:true, requireSingleOrder:true, rejectInvalidProduct:true, rejectMissingCriticalData:false, pickup48Min:70, qualityMin:70, reviewCountMin:0, productFavoriteMin:0, positiveReviewMin:0 }),
    [productLinks, setProductLinks] = useState<Record<string, string>>({}),
    [selections, setSelections] = useState<Record<string, OfferSelection>>({});
  const stateOf = (offer: Offer) => selections[offer.id] ?? savedSelection(offer);
  const isRuleRejected = (offer: Offer) => ruleDecisionOf(offer) === "REJECTED";
  const isManualRejected = (offer: Offer) => stateOf(offer) === "REJECTED";
  const isRulePassed = (offer: Offer) => ruleDecisionOf(offer) === "PASSED";
  const isDataPending = (offer: Offer) => ruleDecisionOf(offer) !== "REJECTED" && reparseRequired(offer);
  const isAiRecommended = (offer: Offer) => offerAiSelection(offer)?.recommendation === "RECOMMENDED";
  const isUndecided = (offer: Offer) => isRulePassed(offer) && stateOf(offer) === "CANDIDATE";
  const rows = offers.filter((offer) => {
      if (status === "RULE_REJECTED") return isRuleRejected(offer);
      if (status === "MANUAL_REJECTED") return isManualRejected(offer);
      if (status === "RULE_PASSED") return isRulePassed(offer);
      if (status === "DATA_PENDING") return isDataPending(offer);
      if (status === "AI_RECOMMENDED") return isAiRecommended(offer);
      if (status === "UNDECIDED") return isUndecided(offer);
      if (status === "SELECTED") return ["PRIMARY", "BACKUP"].includes(stateOf(offer));
      return true;
    }),
    selectedCount = offers.filter((offer) => ["PRIMARY", "BACKUP"].includes(stateOf(offer))).length;
  const rulePassedCount = offers.filter(isRulePassed).length,
    dataPendingCount = offers.filter(isDataPending).length,
    ruleRejectedCount = offers.filter(isRuleRejected).length,
    aiRecommendedCount = offers.filter(isAiRecommended).length,
    undecidedCount = offers.filter(isUndecided).length,
    manualRejectedCount = offers.filter(isManualRejected).length,
    aiSelectableOffers = offers.filter((offer) => isRulePassed(offer) && stateOf(offer) === "CANDIDATE" && ["RECOMMENDED", "USABLE"].includes(offerAiSelection(offer)?.recommendation ?? "")),
    rejectionRate = offers.length ? Math.round(ruleRejectedCount / offers.length * 100) : 0;
  const selected = offers.find((offer) => offer.id === selectedId) ?? null;
  async function openRuleEditor() {
    if (!runId) return;
    setShowRuleEditor(true); setActionError("");
    try {
      const response = await fetch(`/api/sourcing/rule-config?runId=${encodeURIComponent(runId)}`), body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "读取规则失败");
      setRuleConfig(body.config);
    } catch (error) { setActionError(error instanceof Error ? error.message : "读取规则失败"); }
  }
  useEffect(() => {
    const open = () => void openRuleEditor();
    window.addEventListener("open-sourcing-rule-editor", open);
    return () => window.removeEventListener("open-sourcing-rule-editor", open);
  });
  async function saveRuleConfig() {
    if (!runId || savingRules) return;
    setSavingRules(true); setActionError("");
    try {
      const response = await fetch("/api/sourcing/rule-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, config: ruleConfig }) }), body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存规则失败");
      setShowRuleEditor(false); setActionError("规则已保存；请点击顶部“规则初筛”重新执行。");
    } catch (error) { setActionError(error instanceof Error ? error.message : "保存规则失败"); }
    finally { setSavingRules(false); }
  }
  const detail = (selected?.raw_data.detailEnrichment ?? {}) as Record<string, unknown>;
  const selectedFacts = selected ? offerFactsOf(selected) : {};
  const pricingContext = rawRecord(detail.pricingContext);
  const sourceSkus = sourceSkusOf(detail);
  const selectedAi = selected ? offerAiSelection(selected) : null;
  const productAttributes = [detail.productAttributes, detail.attributes, detail.productProperties]
    .flatMap(detailPairs)
    .filter(([name], index, rows) => rows.findIndex(([candidate]) => candidate === name) === index);
  const detailImageCount = [detail.detailImages, detail.detailImageUrls, detail.descriptionImages]
    .find(Array.isArray)?.length ?? null;
  const mainImageCount = Array.isArray(detail.mainImages)
    ? detail.mainImages.length
    : selected?.image_count ?? null;
  const skuImageCount = (Array.isArray(detail.skuImages) ? detail.skuImages.length : 0) || new Set(
    sourceSkus
      .map((sku) => sku.image ?? sku.imageUrl)
      .filter((value): value is string => typeof value === "string" && Boolean(value)),
  ).size || null;
  async function choose(next: OfferSelection) {
    if (!runId || !selected || saving) return;
    const rejectionReason = next === "REJECTED" ? window.prompt("请输入人工淘汰原因（必填）")?.trim() : undefined;
    if (next === "REJECTED" && !rejectionReason) return;
    setSaving(true); setActionError("");
    try {
      const response = await fetch("/api/sourcing/offer-selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, offerId: selected.id, status: next, rejectionReason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存货源状态失败");
      if (next === "PRIMARY" && typeof body.productHref === "string")
        setProductLinks((current) => ({ ...current, [selected.id]: body.productHref }));
      setSelections((current) => {
        const updated = Object.fromEntries(
          offers.map((offer) => [offer.id, current[offer.id] ?? savedSelection(offer)]),
        ) as Record<string, OfferSelection>;
        updated[selected.id] = next;
        return updated;
      });
    } catch (error) { setActionError(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }
  async function restoreRuleRejected() {
    const targets = offers.filter((offer) => isRuleRejected(offer) && !isManualRejected(offer));
    if (!runId || !targets.length || saving || !window.confirm(`确认恢复 ${targets.length} 条规则淘汰货源为候选？恢复后可重新运行 AI 分析。`)) return;
    setSaving(true); setActionError("");
    try {
      for (const offer of targets) {
        const response = await fetch("/api/sourcing/offer-selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, offerId: offer.id, status: "CANDIDATE" }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `恢复 ${offer.external_id ?? offer.id} 失败`);
      }
      await onRefresh();
      setSelections((current) => ({ ...current, ...Object.fromEntries(targets.map((offer) => [offer.id, "CANDIDATE" as const])) }));
      setActionError(`已恢复 ${targets.length} 条货源；可点击顶部“重新运行AI分析”。`);
    } catch (error) { setActionError(error instanceof Error ? error.message : "批量恢复失败"); }
    finally { setSaving(false); }
  }
  async function confirmAiSelectableOffers() {
    if (!runId || !aiSelectableOffers.length || saving || !window.confirm(`确认选择 ${aiSelectableOffers.length} 条 AI“推荐”或“可用”货源？`)) return;
    setSaving(true); setActionError("");
    let completed = 0;
    try {
      for (const offer of aiSelectableOffers) {
        const response = await fetch("/api/sourcing/offer-selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, offerId: offer.id, status: "PRIMARY" }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `选择 ${offer.external_id ?? offer.id} 失败`);
        completed += 1;
      }
      setSelections((current) => ({ ...current, ...Object.fromEntries(aiSelectableOffers.map((offer) => [offer.id, "PRIMARY" as const])) }));
      await onRefresh();
      setActionError(`已选择 ${completed} 条 AI 推荐或可用货源。`);
    } catch (error) { setActionError(`${error instanceof Error ? error.message : "批量选择失败"}；已完成 ${completed}/${aiSelectableOffers.length} 条。`); }
    finally { setSaving(false); }
  }
  return (
    <>
      <div className="v2-filter-group offer-status-tabs">
        {(["ALL", "RULE_PASSED", "DATA_PENDING", "RULE_REJECTED", "AI_RECOMMENDED", "UNDECIDED", "SELECTED", "MANUAL_REJECTED"] as const).map((value) => (
          <button
            key={value}
            className={status === value ? "v2-primary" : "v2-secondary"}
            onClick={() => setStatus(value)}
          >
            {value === "ALL" ? `全部 ${offers.length}` : value === "RULE_PASSED" ? `规则通过 ${rulePassedCount}` : value === "DATA_PENDING" ? `待补数据 ${dataPendingCount}` : value === "RULE_REJECTED" ? `规则淘汰 ${ruleRejectedCount}` : value === "AI_RECOMMENDED" ? `AI推荐 ${aiRecommendedCount}` : value === "UNDECIDED" ? `待人工决定 ${undecidedCount}` : value === "SELECTED" ? `已选择 ${selectedCount}` : `人工淘汰 ${manualRejectedCount}`}
          </button>
        ))}
        <button className="batch-ai-confirm" type="button" disabled={saving || !aiSelectableOffers.length} onClick={() => void confirmAiSelectableOffers()}>一键确认AI推荐与可用 ({aiSelectableOffers.length})</button>
      </div>
      {rejectionRate >= 60 && <div className="rule-strictness-warning"><div><b>当前规则可能过严</b><span>{rejectionRate}% 的货源未通过规则。建议检查“1688严选、评价数、售后保障”是否需要作为硬门槛。</span></div><div className="warning-actions"><button type="button" onClick={() => void openRuleEditor()}>检查规则</button><button type="button" disabled={saving} onClick={() => void restoreRuleRejected()}>批量恢复</button></div></div>}
      {showRuleEditor && <section className="v2-card" style={{marginBottom:16}}><div className="proposal-head"><div><h3>规则淘汰设置</h3><p>不考虑价格、运费、包邮、优惠券或折扣。保存后点击“规则初筛”生效。</p></div><button type="button" className="drawer-close" onClick={() => setShowRuleEditor(false)}>×</button></div><div className="form-grid"><label><input type="checkbox" checked={ruleConfig.requireOnePiece} onChange={(event) => setRuleConfig({...ruleConfig,requireOnePiece:event.target.checked})} /> 要求支持一件代发</label><label><input type="checkbox" checked={ruleConfig.require1688Selection} onChange={(event) => setRuleConfig({...ruleConfig,require1688Selection:event.target.checked})} /> 要求为1688严选商品</label><label><input type="checkbox" checked={ruleConfig.requireReturnShipping} onChange={(event) => setRuleConfig({...ruleConfig,requireReturnShipping:event.target.checked})} /> 要求支持退货包运费</label><label><input type="checkbox" checked={ruleConfig.requireNoReasonReturn} onChange={(event) => setRuleConfig({...ruleConfig,requireNoReasonReturn:event.target.checked})} /> 要求支持7天无理由退货</label><label><input type="checkbox" checked={ruleConfig.rejectNoSellableSku} onChange={(event) => setRuleConfig({...ruleConfig,rejectNoSellableSku:event.target.checked})} /> 已知SKU全部无货时淘汰</label><label><input type="checkbox" checked={ruleConfig.requireSingleOrder} onChange={(event) => setRuleConfig({...ruleConfig,requireSingleOrder:event.target.checked})} /> 要求可以单件下单</label><label><input type="checkbox" checked={ruleConfig.rejectInvalidProduct} onChange={(event) => setRuleConfig({...ruleConfig,rejectInvalidProduct:event.target.checked})} /> 商品下架或无法购买时淘汰</label><label><input type="checkbox" checked={ruleConfig.rejectMissingCriticalData} onChange={(event) => setRuleConfig({...ruleConfig,rejectMissingCriticalData:event.target.checked})} /> 关键规则数据缺失时淘汰</label><label>48H揽收率最低值（%）<input type="number" min="0" max="100" value={ruleConfig.pickup48Min} onChange={(event) => setRuleConfig({...ruleConfig,pickup48Min:Number(event.target.value)})} /></label><label>商品评价数量最低值（条）<input type="number" min="0" value={ruleConfig.reviewCountMin} onChange={(event) => setRuleConfig({...ruleConfig,reviewCountMin:Number(event.target.value)})} /></label><label>商品收藏数量最低值<input type="number" min="0" value={ruleConfig.productFavoriteMin} onChange={(event) => setRuleConfig({...ruleConfig,productFavoriteMin:Number(event.target.value)})} /></label><label>商品/代发品质最低值（%）<input type="number" min="0" max="100" value={ruleConfig.qualityMin} onChange={(event) => setRuleConfig({...ruleConfig,qualityMin:Number(event.target.value)})} /></label><label>好评率最低值（%）<input type="number" min="0" max="100" value={ruleConfig.positiveReviewMin} onChange={(event) => setRuleConfig({...ruleConfig,positiveReviewMin:Number(event.target.value)})} /></label></div><div className="action-buttons" style={{marginTop:16}}><button className="btn" type="button" disabled={savingRules} onClick={() => void saveRuleConfig()}>{savingRules ? "保存中…" : "保存规则"}</button><button className="secondary-btn" type="button" onClick={() => setRuleConfig({ requireOnePiece:true, require1688Selection:false, requireReturnShipping:false, requireNoReasonReturn:false, rejectNoSellableSku:true, requireSingleOrder:true, rejectInvalidProduct:true, rejectMissingCriticalData:false, pickup48Min:70, qualityMin:70, reviewCountMin:0, productFavoriteMin:0, positiveReviewMin:0 })}>恢复默认值</button></div></section>}
      <div className={`sourcing-offer-layout${selected ? " has-detail" : ""}`}>
      <div className="table-wrap"><table className="v2-table offer-admission-table decision-table">
        <colgroup>{[22,13,13,16,10,12,9,5].map((width,index) => <col key={index} style={{width:`${width}%`}} />)}</colgroup>
        <thead>
          <tr>
            <th>商品</th>
            <th>供应商</th>
            <th>分类</th>
            <th>AI商品名称</th>
            <th>商品分类</th>
            <th>AI结论</th>
            <th>人工决策</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const facts = offerFactsOf(o),
              hasSelectionTitle = booleanFact(facts, "hasSelectionTitle"),
              selectionTitle = stringFact(facts, "selectionTitle"),
              productRecognition = productRecognitionOf(o),
              recognitionGroups = Array.isArray(rawRecord(o.raw_data.productRecognition).productGroups) ? (rawRecord(o.raw_data.productRecognition).productGroups as unknown[]).map(rawRecord) : [],
              primaryGroup = recognitionGroups[0],
              standardName = primaryGroup ? String(primaryGroup.standardName ?? productRecognition?.productName ?? "") : productRecognition?.productName ?? "",
              sellingTitle = primaryGroup ? String(primaryGroup.sellingTitle ?? productRecognition?.sellingTitle ?? "") : productRecognition?.sellingTitle ?? "",
              detailIncomplete = detailParseFailed(o);
            const aiSelection = offerAiSelection(o);
            return (
              <tr key={o.id} className={selected?.id === o.id ? "active" : ""}>
                <td>
                  <div className="offer-product-cell">
                    {o.image_url && <img className="v2-mini-img" src={o.image_url} alt="" />}
                    <div className="offer-product-copy"><b>{productNameFromTitle(o.title)}</b>{hasSelectionTitle === true && <span className="v2-pill reading">{selectionTitle ?? "1688严选"}</span>}{productRecognition?.mixedSelling === true && <span className="v2-pill danger">SKU混卖</span>}{o.external_id && <small>offerId: {o.external_id}</small>}</div>
                  </div>
                </td>
                <td>
                  {o.supplier_name && <b>{cleanSupplier(o.supplier_name)}</b>}
                  {(o.shop_age != null || o.repurchase_rate != null) && <small>{o.shop_age != null ? `经营 ${o.shop_age} 年` : "年限待确认"}{o.repurchase_rate != null ? ` · 回头率 ${percent(o.repurchase_rate)}` : ""}</small>}
                </td>
                <td>{stringFact(facts, "productCategory") ?? "待采集"}</td>
                <td>
                  {ruleDecisionOf(o) === "REJECTED" ? <><span className="v2-pill">已跳过</span><small>恢复候选后可运行AI</small></> : standardName || sellingTitle ? <div className="ai-name-cell">{standardName && <><span>标准商品名</span><b>{standardName}</b></>}{sellingTitle && <><span>售卖标题</span><small>{sellingTitle}</small></>}</div> : <span className="v2-pill reading">待AI命名</span>}
                </td>
                <td>{ruleDecisionOf(o) === "REJECTED" ? <span className="v2-pill">已跳过</span> : productRecognition || primaryGroup ? <div className="category-cell"><small>{String(primaryGroup?.categoryParent ?? productRecognition?.categoryParent ?? "一级分类待确认")}</small><b>{String(primaryGroup?.categoryChild ?? productRecognition?.categoryChild ?? "二级分类待确认")}</b></div> : <span className="v2-pill reading">待AI分类</span>}</td>
                <td>
                  {ruleDecisionOf(o) === "REJECTED" ? <><span className="v2-pill">已跳过</span><small>规则淘汰，不消耗 AI 分析</small></> : aiSelection ? <><span className={`v2-pill ${aiSelection.recommendation === "RECOMMENDED" ? "success" : aiSelection.recommendation === "NOT_RECOMMENDED" ? "danger" : ""}`}>{aiRecommendationLabel(aiSelection.recommendation)}</span><small className="ai-reason-line">{aiSelection.recommendationReason}</small></> : <span className="v2-pill reading">待AI分析</span>}
                </td>
                <td>
                  {stateOf(o) === "REJECTED" ? <span className="v2-pill danger">人工淘汰</span> : <span className={`v2-pill ${["PRIMARY", "BACKUP"].includes(stateOf(o)) ? "success" : ""}`}>{selectionLabel[stateOf(o)]}</span>}
                  {ruleDecisionOf(o) === "REJECTED" && <details className="rejection-reasons"><summary>规则淘汰 · 查看原因</summary><ul>{stringArray(ruleSelectionOf(o).hardFailures).map((reason) => <li key={reason}>{reason}</li>)}</ul></details>}
                </td>
                <td>
                  <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(o.id); }}>详情</button>
                  {detailIncomplete && <button type="button" disabled={rechecking} onClick={(event) => { event.stopPropagation(); void onRetryOffer(o); }}>重新解析</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {selected && <aside className="v2-card sourcing-offer-drawer">
          <div className="proposal-head sourcing-drawer-head">{selected.image_url && <img className="v2-mini-img" src={selected.image_url} alt="" />}<div><h2>{productRecognitionOf(selected)?.productName ?? productNameFromTitle(selected.title)}</h2><p>offerId: {selected.external_id ?? "待确认"}　<a href={selected.source_url} target="_blank" rel="noreferrer">打开1688 ↗</a></p><span className={`v2-pill ${["PRIMARY", "BACKUP"].includes(stateOf(selected)) ? "success" : stateOf(selected) === "REJECTED" ? "danger" : ""}`}>{selectionLabel[stateOf(selected)]}</span></div><button className="drawer-close" type="button" aria-label="关闭详情" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="v2-filter-group offer-status-tabs">
            {(["SKU","PRODUCT","SUPPLIER","DROPSHIP","FULFILLMENT","AI"] as const).map((value) => <button key={value} className={detailTab === value ? "v2-primary" : "v2-secondary"} onClick={() => setDetailTab(value)}>{value === "SKU" ? "SourceSKU库存" : value === "PRODUCT" ? "商品信息" : value === "SUPPLIER" ? "供应商信息" : value === "DROPSHIP" ? "分销代发" : value === "FULFILLMENT" ? "履约能力" : "AI判断"}</button>)}
          </div>
          <section className="drawer-verdict-summary">
            <div><span>AI结论</span><b>{selected && ruleDecisionOf(selected) === "REJECTED" ? "已跳过" : selectedAi ? aiRecommendationLabel(selectedAi.recommendation) : "待AI分析"}</b><small>{selectedAi ? `置信度：${selectedAi.confidence === "HIGH" ? "高" : selectedAi.confidence === "MEDIUM" ? "中" : "低"}` : selected && ruleDecisionOf(selected) === "REJECTED" ? "该货源已被规则淘汰" : "等待本轮分析"}</small></div>
            <p>{selectedAi?.recommendationReason ?? (selected && ruleDecisionOf(selected) === "REJECTED" ? stringArray(ruleSelectionOf(selected).hardFailures).join("；") : "完成 AI 分析后，这里会显示核心理由。")}</p>
          </section>
          {detailTab === "SKU" && <div className="table-wrap sourcing-sku-table"><table className="v2-table compact source-sku-only-table"><thead><tr><th>图片</th><th>SourceSKU</th><th>采购价</th><th>库存</th></tr></thead><tbody>{sourceSkus.length ? sourceSkus.map((sku,index) => { const price = sku.dropshipPrice ?? sku.wholesalePrice, image = sku.image ?? sku.imageUrl, rawName = String(sku.rawSpecText ?? sku.specName ?? `SourceSKU ${index+1}`), normalizedName = String(sku.specName ?? ""), values = Array.isArray(sku.specValues) ? sku.specValues.map(String).filter(Boolean).join(" / ") : "", skuId = sku.skuId ?? sku.sourceVariantId ?? sku.id; return <tr key={String(sku.id ?? index)}><td>{image ? <img className="v2-mini-img" src={String(image)} alt="" /> : "—"}</td><td><b>{rawName}</b>{normalizedName && normalizedName !== rawName && <small>{normalizedName}</small>}{values && values !== rawName && values !== normalizedName && <small>{values}</small>}<small>{String(skuId)}</small></td><td>{price == null ? "待确认" : money(Number(price))}</td><td>{sku.inventory == null ? "待确认" : String(sku.inventory)}</td></tr>}) : <tr><td colSpan={4}>本次货源详情解析未返回 SourceSKU</td></tr>}</tbody></table></div>}
          {detailTab === "PRODUCT" && <div className="decision-sections"><section><h3>采购与市场表现</h3><dl className="candidate-facts"><div><span>采购价</span><b>{stringFact(selectedFacts,"offerPriceDisplay") ?? money(selected.price_min)}</b></div>{stringFact(selectedFacts,"newcomerPriceDisplay") && <div><span>新人价</span><b>{stringFact(selectedFacts,"newcomerPriceDisplay")}</b></div>}<div><span>MOQ</span><b>{selected.minimum_order_quantity ?? "待确认"}</b></div><div><span>库存</span><b>{selected.stock ?? "待确认"}</b></div><div><span>销量</span><b>{stringFact(selectedFacts,"salesDisplay") ?? selected.sales_count ?? "待确认"}</b></div></dl></section><section><h3>商品评价</h3><dl className="attribute-list">{numberFact(selectedFacts,"productRating") != null && <div><dt>商品评分</dt><dd>{numberFact(selectedFacts,"productRating")?.toFixed(1)}</dd></div>}{(stringFact(selectedFacts,"totalReviewCountDisplay") || numberFact(selectedFacts,"totalReviewCount") != null) && <div><dt>总评价数</dt><dd>{stringFact(selectedFacts,"totalReviewCountDisplay") ?? numberFact(selectedFacts,"totalReviewCount")}条评价</dd></div>}{(stringFact(selectedFacts,"positiveReviewCountDisplay") || stringFact(selectedFacts,"productReviewCountDisplay") || numberFact(selectedFacts,"positiveReviewCount") != null || numberFact(selectedFacts,"productReviewCount") != null) && <div><dt>好评人数</dt><dd>{stringFact(selectedFacts,"positiveReviewCountDisplay") ?? stringFact(selectedFacts,"productReviewCountDisplay") ?? numberFact(selectedFacts,"positiveReviewCount") ?? numberFact(selectedFacts,"productReviewCount")}</dd></div>}{numberFact(selectedFacts,"positiveReviewRate") != null && <div><dt>好评率</dt><dd>{percent(numberFact(selectedFacts,"positiveReviewRate"))}</dd></div>}{numberFact(selectedFacts,"productRepurchaseRate") != null && <div><dt>商品复购率</dt><dd>{percent(numberFact(selectedFacts,"productRepurchaseRate"))}</dd></div>}</dl></section><section><h3>铺货素材</h3><dl className="attribute-list"><div><dt>商品标题</dt><dd>{selected.title}</dd></div>{mainImageCount != null && <div><dt>主图</dt><dd>{mainImageCount} 张</dd></div>}{skuImageCount != null && <div><dt>SKU图</dt><dd>{skuImageCount} 张</dd></div>}{detailImageCount != null && <div><dt>详情图</dt><dd>{detailImageCount} 张</dd></div>}<div><dt>商品属性</dt><dd>{productAttributes.length ? "有" : "无"}</dd></div></dl>{productAttributes.length > 0 && <dl className="attribute-list">{productAttributes.map(([name,value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}</section></div>}
          {detailTab === "SUPPLIER" && <div className="decision-sections"><section><h3>供应商画像</h3><dl className="attribute-list"><div><dt>公司名称</dt><dd>{selected.supplier_name ? cleanSupplier(selected.supplier_name) : "待确认"}</dd></div>{stringFact(selectedFacts,"merchantType") && <div><dt>商家类型</dt><dd>{stringFact(selectedFacts,"merchantType")}</dd></div>}{stringFact(selectedFacts,"merchantLevel") && <div><dt>供应链等级</dt><dd>{stringFact(selectedFacts,"merchantLevel")}</dd></div>}{stringFact(selectedFacts,"mainCategory") && <div><dt>主营类目</dt><dd>{stringFact(selectedFacts,"mainCategory")}</dd></div>}<div><dt>经营年限</dt><dd>{selected.shop_age == null ? "待确认" : `${selected.shop_age} 年`}</dd></div><div><dt>店铺回头率</dt><dd>{percent(selected.repurchase_rate)}</dd></div><div><dt>品质达标率</dt><dd>{selected.quality_rate == null ? "待评估" : percent(selected.quality_rate)}</dd></div><div><dt>店铺48小时支揽率</dt><dd>{percent(numberFact(selectedFacts,"shopPickup48Rate"))}</dd></div>{selected.inspection === true && <div><dt>深度验厂</dt><dd>已验厂</dd></div>}</dl></section><section><h3>质量依据</h3><ul className="decision-checks"><li>经营年限：{selected.shop_age == null ? "待获取" : `${selected.shop_age} 年`}</li><li>回头率：{percent(selected.repurchase_rate)}</li><li>退货保障：{fact(selected.return_shipping === true || selected.no_reason_return === true,"支持")}</li></ul></section></div>}
          {detailTab === "DROPSHIP" && (
            <div className="decision-sections">
              <section>
                <h3>分销代发</h3>
                <dl className="attribute-list">
                  {selected.one_piece_delivery === true && <div><dt>一件代发</dt><dd>支持</dd></div>}
                  {numberFact(selectedFacts, "onePiecePrice") != null && <div><dt>1件价格</dt><dd>{money(numberFact(selectedFacts, "onePiecePrice"))}</dd></div>}
                  {selected.blind_shipping === true && <div><dt>密文代发</dt><dd>{stringFact(selectedFacts, "dropshipPlatforms") ? `支持：${stringFact(selectedFacts, "dropshipPlatforms")}` : "支持"}</dd></div>}
                  {stringFact(selectedFacts, "dropshipRank") && <div><dt>代发商家榜</dt><dd>{stringFact(selectedFacts, "dropshipRank")}</dd></div>}
                  {stringFact(selectedFacts, "dropshipHeat") && <div><dt>商家代发热度</dt><dd>{stringFact(selectedFacts, "dropshipHeat")}</dd></div>}
                  {(stringFact(selectedFacts, "dropship7DayVolumeDisplay") || numberFact(selectedFacts, "dropship7DayVolume") != null) && <div><dt>近7天代发量</dt><dd>{stringFact(selectedFacts, "dropship7DayVolumeDisplay") ?? numberFact(selectedFacts, "dropship7DayVolume")}</dd></div>}
                  {(stringFact(selectedFacts, "dropship30DayVolumeDisplay") || numberFact(selectedFacts, "dropship30DayVolume") != null) && <div><dt>近30天代发量</dt><dd>{stringFact(selectedFacts, "dropship30DayVolumeDisplay") ?? numberFact(selectedFacts, "dropship30DayVolume")}</dd></div>}
                  {(stringFact(selectedFacts, "downstreamListingCountDisplay") || numberFact(selectedFacts, "downstreamListingCount") != null) && <div><dt>下游铺货数</dt><dd>{stringFact(selectedFacts, "downstreamListingCountDisplay") ?? numberFact(selectedFacts, "downstreamListingCount")}</dd></div>}
                  {(stringFact(selectedFacts, "distributorCountDisplay") || numberFact(selectedFacts, "distributorCount") != null) && <div><dt>铺货分销商数</dt><dd>{stringFact(selectedFacts, "distributorCountDisplay") ?? numberFact(selectedFacts, "distributorCount")}</dd></div>}
                  {numberFact(selectedFacts, "dropshipQualityRate") != null && <div><dt>代发品质达标率</dt><dd>{percent(numberFact(selectedFacts, "dropshipQualityRate"))}</dd></div>}
                  {numberFact(selectedFacts, "dropshipBuyerRetentionRate") != null && <div><dt>代发买家留货率</dt><dd>{percent(numberFact(selectedFacts, "dropshipBuyerRetentionRate"))}</dd></div>}
                  {numberFact(selectedFacts, "pickup24Rate") != null && <div><dt>24h 揽收率</dt><dd>{percent(numberFact(selectedFacts, "pickup24Rate"))}</dd></div>}
                  {numberFact(selectedFacts, "pickup48Rate") != null && <div><dt>48h 揽收率</dt><dd>{percent(numberFact(selectedFacts, "pickup48Rate"))}</dd></div>}
                </dl>
              </section>
            </div>
          )}
          {detailTab === "FULFILLMENT" && (
            <div className="decision-sections">
              <section>
                <h3>履约能力</h3>
                <dl className="attribute-list">
                  {stringFact(selectedFacts, "shippingOrigin") && <div><dt>发货地</dt><dd>{stringFact(selectedFacts, "shippingOrigin")}</dd></div>}
                  {stringFact(selectedFacts, "estimatedDelivery") && <div><dt>预计送达</dt><dd>{stringFact(selectedFacts, "estimatedDelivery")}</dd></div>}
                  {numberFact(pricingContext, "shippingQuote") != null && <div><dt>运费</dt><dd>{money(numberFact(pricingContext, "shippingQuote"))} 起</dd></div>}
                  {selected.return_shipping === true && <div><dt>退货包运费</dt><dd>支持</dd></div>}
                  {selected.no_reason_return === true && <div><dt>7天无理由</dt><dd>支持</dd></div>}
                  {booleanFact(selectedFacts, "qualityCompensation") === true && <div><dt>品质不符包赔</dt><dd>支持</dd></div>}
                  {booleanFact(selectedFacts, "lateDeliveryCompensation") === true && <div><dt>晚发必赔</dt><dd>支持</dd></div>}
                </dl>
              </section>
            </div>
          )}
          {detailTab === "AI" && (() => { const groups = Array.isArray(rawRecord(selected.raw_data.productRecognition).productGroups) ? (rawRecord(selected.raw_data.productRecognition).productGroups as unknown[]).map(rawRecord) : []; return groups.some((group) => group.sellingTitle) ? <div className="decision-sections ai-decision"><section><h3>商品名称</h3>{groups.map((group, index) => <dl className="attribute-list" key={`${String(group.standardName)}-${index}`}><div><dt>标准商品名</dt><dd>{String(group.standardName ?? "未返回")}</dd></div><div><dt>售卖标题</dt><dd>{String(group.sellingTitle ?? "未返回")}</dd></div></dl>)}</section></div> : null; })()}
          {detailTab === "AI" && (() => {
            const recognition = rawRecord(selected.raw_data.productRecognition), groups = Array.isArray(recognition.productGroups) ? recognition.productGroups.map(rawRecord) : [],
              evidence = stringArray(recognition.evidence), recognitionRisks = stringArray(recognition.risks), unresolvedSkus = stringArray(recognition.unresolvedSkus);
            if (!groups.length) return null;
            return <div className="decision-sections ai-decision"><section><h3>商品识别结果</h3><dl className="attribute-list"><div><dt>商品形态</dt><dd>{recognition.offerType === "MIXED_SKU" ? "多商品混卖" : "单一商品"}</dd></div><div><dt>混卖判断</dt><dd>{recognition.mixedSelling === true ? `是（${String(recognition.mixedSellingType ?? "未分类")}）` : "否"}</dd></div><div><dt>识别模型</dt><dd>{String(recognition.model ?? "未记录")}</dd></div>{Boolean(recognition.analyzedAt) && <div><dt>判断时间</dt><dd>{new Date(String(recognition.analyzedAt)).toLocaleString()}</dd></div>}</dl></section><section><h3>识别到的商品组</h3>{groups.map((group, index) => <div key={`${String(group.standardName)}-${index}`} className="v2-card ai-product-group"><h4>{String(group.standardName ?? `商品组 ${index + 1}`)}</h4><dl className="attribute-list"><div><dt>一级分类</dt><dd>{String(group.categoryParent ?? "未识别")}</dd></div><div><dt>二级分类</dt><dd>{String(group.categoryChild ?? "未识别")}</dd></div><div><dt>置信度</dt><dd>{group.confidence === "HIGH" ? "高" : group.confidence === "LOW" ? "低" : "中"}</dd></div><div className="related-sku-row"><dt>关联SKU</dt><dd><RelatedSkuList ids={stringArray(group.skuIds)} skus={sourceSkus} /></dd></div></dl>{detailPairs(group.attributes).length > 0 && <dl className="attribute-list">{detailPairs(group.attributes).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}</div>)}</section><section><h3>识别依据</h3>{evidence.length ? <ul className="decision-checks">{evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="decision-empty">模型未返回识别依据</p>}</section><section><h3>识别风险</h3>{recognitionRisks.length ? <ul className="decision-risks">{recognitionRisks.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="decision-empty">模型未返回识别风险</p>}</section>{unresolvedSkus.length > 0 && <section><h3>未归类SKU</h3><ul className="decision-risks">{unresolvedSkus.map((item) => <li key={item}>{item}</li>)}</ul></section>}</div>;
          })()}
          {detailTab === "AI" && (() => { const ai = offerAiSelection(selected); return ai ? <div className="decision-sections ai-decision"><section><h3>AI结论：{aiRecommendationLabel(ai.recommendation)}</h3><p>结论置信度：{ai.confidence === "HIGH" ? "高" : ai.confidence === "MEDIUM" ? "中" : "低"}</p><span className={`v2-pill ${ai.recommendation === "RECOMMENDED" ? "success" : ai.recommendation === "NOT_RECOMMENDED" ? "danger" : ""}`}>{aiRecommendationLabel(ai.recommendation)}</span></section><section><h3>五维评估</h3><dl className="attribute-list"><div><dt>代发适配</dt><dd>{ai.dimensions.dropshipFit}</dd></div><div><dt>供货稳定</dt><dd>{ai.dimensions.supplyStability}</dd></div><div><dt>履约稳定</dt><dd>{ai.dimensions.fulfillmentStability}</dd></div><div><dt>质量可信度</dt><dd>{ai.dimensions.qualityConfidence}</dd></div><div><dt>商家稳定性</dt><dd>{ai.dimensions.supplierStability}</dd></div></dl></section><section><h3>推荐理由</h3><p>{ai.recommendationReason}</p></section><section><h3>优势</h3>{ai.advantages.length ? <ul className="decision-checks">{ai.advantages.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="decision-empty">暂无明确优势</p>}</section><section><h3>风险</h3>{ai.risks.length ? <ul className="decision-risks">{ai.risks.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="decision-empty">暂无明确风险</p>}</section>{ai.conflicts.length > 0 && <section><h3>证据冲突</h3><ul className="decision-risks">{ai.conflicts.map((item) => <li key={item}>{item}</li>)}</ul></section>}{ai.missingEvidence.length > 0 && <section><h3>缺失证据</h3><ul className="decision-risks">{ai.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul></section>}<section><h3>最终建议</h3><p>{ai.finalAdvice}</p></section></div> : <div className="decision-sections ai-decision"><section><h3>AI评估货源</h3><p className="decision-empty">尚未运行本轮「AI评估货源」。</p></section></div>; })()}
          {actionError && <div className="status-box error">{actionError}</div>}
          {productLinks[selected.id] && <div className="status-box success">货源已选择，商品已进入「待制作」。<Link className="text-link" href={productLinks[selected.id]}>前往商品中心制作 →</Link></div>}
          <div className="action-buttons" style={{marginTop:16}}>{selected && ruleDecisionOf(selected) === "REJECTED" ? <button className="btn" disabled={saving} onClick={() => void choose("CANDIDATE")}>恢复候选并允许AI分析</button> : <><button className="btn" disabled={saving || ["PRIMARY", "BACKUP"].includes(stateOf(selected))} onClick={() => void choose("PRIMARY")}>{["PRIMARY", "BACKUP"].includes(stateOf(selected)) ? "已选择" : "选择货源"}</button><button className="secondary-btn" disabled={saving} onClick={() => void choose("REJECTED")}>人工淘汰</button></>}</div>
      </aside>}
      </div>
    </>
  );
}
const fact = (value: boolean | null, label: string) =>
  value === true ? `✓ ${label}` : value === false ? `✕ ${label}` : `? ${label}`;
const percent = (value: number | null) =>
  value == null ? "待确认" : `${value}%`;
const money = (v: number | null) =>
  v == null ? "待核实" : `¥${Number(v).toFixed(2)}`;
const inventory = (v: number | null) =>
  v == null ? "待核实" : v === 0 ? "0（无货）" : `${v}`;
