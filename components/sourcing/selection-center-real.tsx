"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  supplier_name: string | null;
  price_min: number | null;
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
    execution?: "DEEPSEEK" | "RULE_FALLBACK";
    requestedModel?: string;
    actualModel?: string;
    fallbackReason?: string | null;
    analyzedAt?: string;
  } | null;
};
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
export function RealDiscoveryWorkspace() {
  const [data, setData] = useState<Payload | null>(null),
    [tab, setTab] = useState<"models" | "pending" | "offers">("models"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0),
    [sourceFilter, setSourceFilter] = useState<"all" | "pending">("all"),
    [busy, setBusy] = useState(false),
    [rechecking, setRechecking] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    void fetch("/api/sourcing/latest")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "读取失败");
        setData(body);
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : "读取失败"));
  }, []);
  const graph = data?.v3,
    models = useMemo(
      () => (graph?.models ?? []).filter((x) => x.name.includes(query)),
      [graph, query],
    ),
    model = models[selected] ?? models[0],
    allSourceSkus = useMemo(() => graph?.sourceSkus ?? [], [graph]),
    pending = useMemo(
      () => allSourceSkus.filter((x) => x.price == null || x.stock == null),
      [allSourceSkus],
    ),
    visibleSourceSkus = sourceFilter === "pending" ? pending : allSourceSkus;
  async function rerun() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/sourcing/v3/analyze", { method: "POST" }),
        body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "重新分析失败");
      setData((x) => (x ? { ...x, v3: body.graph } : x));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "重新分析失败");
    } finally {
      setBusy(false);
    }
  }
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
      const analyze = await fetch("/api/sourcing/v3/analyze", {
        method: "POST",
      });
      const analyzed = await analyze.json();
      if (!analyze.ok) throw new Error(analyzed.error ?? "刷新分析结果失败");
      setData((current) =>
        current ? { ...current, v3: analyzed.graph } : current,
      );
      const failed = result.failures?.length ?? 0;
      setMessage(
        failed
          ? `重查完成，仍有 ${failed} 个 Offer 未能读取价格或库存。`
          : `已完成 ${offers.length} 个待核实 Offer 的自动重查。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "待核实货源重查失败");
    } finally {
      setRechecking(false);
    }
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
    status = pending.length ? "🟡 货源待确认" : "🟢 可进入采购比较";
  return (
    <div className="v2-page discovery">
      <div className="v2-crumb">
        选品中心　/　货源发现{data?.query ? `　/　${data.query}` : ""}
      </div>
      <header className="v2-page-head">
        <div>
          <h1>货源发现{data?.query ? ` · ${data.query}` : ""}</h1>
          <p>按商品款型和可售子产品理解真实 1688 货源，支持采购前比较。</p>
        </div>
        <div className="v2-actions">
          <button
            className="v2-secondary"
            disabled={busy}
            onClick={() => void rerun()}
          >
            ↻ {busy ? "分析中" : "重新分析货源"}
          </button>
          <Link className="v2-primary" href="#capture">
            采集真实货源
          </Link>
        </div>
      </header>
      <section className="v2-metrics">
        <Metric
          icon="⌕"
          label="搜索发现"
          value={data?.stats?.fetched ?? 0}
          detail="搜索结果"
        />
        <Metric
          icon="▱"
          label="供应商品牌"
          value={counts.offers}
          detail="1688 商品页"
          tone="blue"
        />
        <Metric
          icon="◇"
          label="采购 SKU"
          value={counts.sourceSkus}
          detail="真实采购子产品"
          tone="green"
        />
        <Metric
          icon="⌑"
          label="商品款型"
          value={counts.models}
          detail="淘宝售卖结构"
          tone="orange"
        />
        <Metric
          icon="▦"
          label="可采购 SKU"
          value={
            graph?.sourceSkus.filter(
              (x) =>
                x.role === "MAIN_PRODUCT" && x.price != null && x.stock != null,
            ).length ?? 0
          }
          detail="价格库存已确认"
          tone="blue"
        />
      </section>
      <section className="v2-decision-banner">
        <Icon tone="orange">!</Icon>
        <div>
          <span>商品决策状态</span>
          <h2>{data?.query ?? "当前商品"}</h2>
          <b>{status}</b>
        </div>
        <dl>
          <dt>原因</dt>
          <dd>
            {pending.length
              ? `${pending.length} 个 SKU 的价格或库存待核实`
              : "价格和库存已获取"}
          </dd>
          <dt>影响</dt>
          <dd>
            {pending.length
              ? "待核实货源暂不参与最低价比较"
              : "可以进行采购价比较"}
          </dd>
        </dl>
        <button
          className="v2-warn"
          onClick={() => {
            setSourceFilter("pending");
            setTab("pending");
          }}
        >
          查看待核实货源
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
      {data?.v3Meta && (
        <div
          className={`status-box ${data.v3Meta.execution === "DEEPSEEK" ? "success" : "reading"}`}
        >
          {data.v3Meta.execution === "DEEPSEEK"
            ? `商品款型池由真实 AI 聚类：${data.v3Meta.actualModel ?? data.v3Meta.requestedModel}`
            : `AI 调用失败，已使用规则引擎兜底：${data.v3Meta.fallbackReason ?? "未知原因"}`}
        </div>
      )}
      <div className="v2-tabs">
        <button
          className={tab === "models" ? "active" : ""}
          onClick={() => setTab("models")}
        >
          商品款型池 ({counts.models})
        </button>
        <button
          className={tab === "pending" ? "active" : ""}
          onClick={() => setTab("pending")}
        >
          采购 SKU ({allSourceSkus.length})
        </button>
        <button
          className={tab === "offers" ? "active" : ""}
          onClick={() => setTab("offers")}
        >
          原始 1688 ({counts.offers})
        </button>
      </div>
      {tab === "models" && (
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
              <option>全部决策状态</option>
            </select>
            <select>
              <option>按货源数量排序</option>
            </select>
          </div>
          <div className="v2-split">
            <section className="v2-card table-card">
              <ModelTable
                models={models}
                graph={graph}
                runId={data?.runId}
                selected={model?.id}
                onSelect={setSelected}
              />
            </section>
            <ModelDrawer model={model} graph={graph} runId={data?.runId} />
          </div>
        </>
      )}
      {tab === "pending" && (
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
          <PendingTable rows={visibleSourceSkus} onAction={setMessage} />
        </section>
      )}
      {tab === "offers" && (
        <section className="v2-card table-card">
          <OfferTable offers={data?.products ?? []} />
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
  graph,
  runId,
  selected,
  onSelect,
}: {
  models: V3ProductModel[];
  graph?: SourcingV3Graph;
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
          <th>规格完整度</th>
          <th>最低采购价</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {models.map((m, i) => {
          const eligible =
              graph?.sourceSkus.filter(
                (x) =>
                  m.sourceSkuIds.includes(x.id) &&
                  x.dimensionStatus !== "UNKNOWN" &&
                  x.price != null,
              ) ?? [],
            lowest = eligible.length
              ? Math.min(...eligible.map((x) => x.price!))
              : null;
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
                <b>{m.sizeCompleteness}%</b>
                <small className={m.pendingCount ? "danger" : "success"}>
                  {m.pendingCount} 待确认
                </small>
              </td>
              <td>
                <b>{money(lowest)}</b>
              </td>
              <td>
                <span
                  className={`v2-pill ${m.pendingCount ? "orange" : "success"}`}
                >
                  {m.pendingCount ? "🟡 待确认" : "🟢 可比较"}
                </span>
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
      graph?.sourceSkus.filter((x) => model.sourceSkuIds.includes(x.id)) ?? [],
    comparableSuppliers = new Set(
      sources
        .filter((x) => x.dimensionStatus !== "UNKNOWN")
        .map((x) => x.supplierName),
    ).size,
    hold = model.pendingCount > 0 || comparableSuppliers < 2;
  return (
    <aside className="v2-drawer">
      <div className="v2-drawer-head">
        <div>
          <h2>{model.name}</h2>
          <span className={`v2-pill ${hold ? "orange" : "success"}`}>
            {hold ? "🟡 待确认" : "🟢 可比较"}
          </span>
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
          <dt>规格完整度</dt>
          <dd className={model.sizeCompleteness < 60 ? "danger" : "success"}>
            {model.sizeCompleteness}%
          </dd>
          <dt>可比货源</dt>
          <dd>{model.matchCount} 个</dd>
        </dl>
      </div>
      <section className="v2-drawer-section v2-decision-summary">
        <h3>商品决策摘要</h3>
        <dl>
          <dt>推荐状态</dt>
          <dd>
            <b>{hold ? "🟡 暂不采购" : "🟢 可进入采购比较"}</b>
          </dd>
          <dt>原因</dt>
          <dd>
            {model.pendingCount
              ? "规格不足"
              : comparableSuppliers < 2
                ? "可比较供应商不足"
                : "规格完整"}
          </dd>
          <dt>可比较供应商</dt>
          <dd>{comparableSuppliers}</dd>
          <dt>下一步</dt>
          <dd>{hold ? "补充规格" : "查看最低可采购 SKU"}</dd>
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
      <section className="v2-drawer-section">
        <h3>货源对比</h3>
        {sources.length ? (
          <table className="v2-table compact">
            <tbody>
              {sources.slice(0, 4).map((x) => (
                <tr key={x.id}>
                  <td>{x.supplierName}</td>
                  <td>{money(x.price)}</td>
                  <td
                    className={
                      x.dimensionStatus === "UNKNOWN" ? "danger" : "success"
                    }
                  >
                    {x.dimensionStatus === "UNKNOWN" ? "缺尺寸" : "可比较"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="v2-empty">
            <b>暂无采购 SKU</b>
          </div>
        )}
      </section>
      <div className="v2-drawer-footer">
        <Link
          className="v2-primary"
          href={
            runId
              ? `/products/discover/runs/${runId}/models/${model.id}`
              : `/products/discover/models/${model.id}`
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
  onAction,
}: {
  rows: V3SourceSku[];
  onAction: (v: string) => void;
}) {
  const [preview, setPreview] = useState<V3SourceSku | null>(null);
  return (
    <>
      <table className="v2-table">
        <thead>
          <tr>
            <th>图片</th>
            <th>SourceSKU</th>
            <th>供应商</th>
            <th>采购价</th>
            <th>库存</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
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
              <td>
                <b>{x.rawName}</b>
                <small>{x.externalOfferId}</small>
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
                  <a href={x.sourceUrl} target="_blank" rel="noreferrer">
                    跳转 1688 ↗
                  </a>
                  <button
                    onClick={() =>
                      onAction(`已将「${x.rawName}」加入人工确认队列。`)
                    }
                  >
                    人工确认
                  </button>
                  <button
                    onClick={() =>
                      onAction(
                        `已在当前视图忽略「${x.rawName}」；原始数据未删除。`,
                      )
                    }
                  >
                    忽略
                  </button>
                </div>
              </td>
            </tr>
          ))}
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
function OfferTable({ offers }: { offers: Offer[] }) {
  const [status, setStatus] = useState<"ALL" | "PASS" | "RISK" | "REJECT">(
      "ALL",
    ),
    [requirements, setRequirements] = useState({
      delivery: false,
      blind: false,
      returns: false,
      stock: false,
      age: false,
    });
  const rows = offers.filter((offer) => {
      if (status !== "ALL" && offer.offer_status !== status) return false;
      if (requirements.delivery && offer.one_piece_delivery !== true)
        return false;
      if (requirements.blind && offer.blind_shipping !== true) return false;
      if (
        requirements.returns &&
        offer.return_shipping !== true &&
        offer.no_reason_return !== true
      )
        return false;
      if (requirements.stock && Number(offer.stock ?? 0) <= 100) return false;
      if (requirements.age && Number(offer.shop_age ?? 0) <= 1) return false;
      return true;
    }),
    counts = {
      PASS: offers.filter((offer) => offer.offer_status === "PASS").length,
      RISK: offers.filter((offer) => offer.offer_status === "RISK").length,
      REJECT: offers.filter((offer) => offer.offer_status === "REJECT").length,
    },
    toggle = (key: keyof typeof requirements) =>
      setRequirements((current) => ({ ...current, [key]: !current[key] }));
  return (
    <>
      <div className="offer-admission-summary">
        <div>
          <b>{offers.length}</b>
          <span>采集 Offer</span>
        </div>
        <div>
          <b className="success">{counts.PASS}</b>
          <span>通过筛选</span>
        </div>
        <div>
          <b className="orange">{counts.RISK}</b>
          <span>待确认</span>
        </div>
        <div>
          <b className="danger">{counts.REJECT}</b>
          <span>淘汰 Offer</span>
        </div>
      </div>
      <div className="offer-filter-panel">
        <b>货源筛选</b>
        {(
          [
            ["delivery", "一件代发"],
            ["blind", "无痕发货"],
            ["returns", "退货保障"],
            ["stock", "库存 > 100"],
            ["age", "店铺经营 > 1 年"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={requirements[key]}
              onChange={() => toggle(key)}
            />
            {label}
          </label>
        ))}
        <button
          className="v2-secondary"
          onClick={() =>
            setRequirements({
              delivery: false,
              blind: false,
              returns: false,
              stock: false,
              age: false,
            })
          }
        >
          重置
        </button>
      </div>
      <div className="v2-filter-group offer-status-tabs">
        {(["ALL", "PASS", "RISK", "REJECT"] as const).map((value) => (
          <button
            key={value}
            className={status === value ? "v2-primary" : "v2-secondary"}
            onClick={() => setStatus(value)}
          >
            {value === "ALL"
              ? `全部 (${offers.length})`
              : value === "PASS"
                ? `推荐 (${counts.PASS})`
                : value === "RISK"
                  ? `待确认 (${counts.RISK})`
                  : `淘汰 (${counts.REJECT})`}
          </button>
        ))}
      </div>
      <table className="v2-table offer-admission-table">
        <thead>
          <tr>
            <th>商品标题</th>
            <th>供应商</th>
            <th>采购价</th>
            <th>供应能力</th>
            <th>店铺质量</th>
            <th>商品表现</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const hasDetail = Boolean(o.raw_data.detailEnrichment),
              d = (o.raw_data.detailEnrichment ?? {}) as Record<
                string,
                unknown
              >,
              count = Array.isArray(d.rawOptions) ? d.rawOptions.length : 0;
            return (
              <tr key={o.id}>
                <td>
                  <b>{o.title}</b>
                </td>
                <td>
                  {o.supplier_name ? cleanSupplier(o.supplier_name) : "待确认"}
                </td>
                <td>
                  <b>{money(o.price_min)}</b>
                  <small>MOQ {o.minimum_order_quantity ?? "待确认"}</small>
                </td>
                <td>
                  <small>{fact(o.one_piece_delivery, "一件代发")}</small>
                  <small>{fact(o.blind_shipping, "无痕发货")}</small>
                  <small>
                    {fact(
                      o.return_shipping === true || o.no_reason_return === true
                        ? true
                        : o.return_shipping === false &&
                            o.no_reason_return === false
                          ? false
                          : null,
                      "退货保障",
                    )}
                  </small>
                </td>
                <td>
                  <small>
                    经营 {o.shop_age == null ? "待确认" : `${o.shop_age} 年`}
                  </small>
                  <small>品质 {percent(o.quality_rate)}</small>
                  <small>回头率 {percent(o.repurchase_rate)}</small>
                  <small>揽收率 {percent(o.delivery_rate)}</small>
                </td>
                <td>
                  <small>库存 {o.stock ?? "待确认"}</small>
                  <small>近30天销量 {o.sales_count ?? "待确认"}</small>
                  <small>
                    主图 {o.image_count ?? "待确认"} 张 · 视频{" "}
                    {o.has_video ? "有" : "无/待确认"}
                  </small>
                </td>
                <td>
                  <span
                    className={`v2-pill ${o.offer_status === "PASS" ? "success" : o.offer_status === "REJECT" ? "danger" : "orange"}`}
                  >
                    {o.offer_status === "PASS"
                      ? "🟢 推荐"
                      : o.offer_status === "REJECT"
                        ? "🔴 淘汰"
                        : "🟡 待确认"}
                  </span>
                  <small>
                    {o.offer_reasons?.join("；") ||
                      (hasDetail
                        ? `${count} 个 SKU 已解析`
                        : "等待详情事实采集")}
                  </small>
                </td>
                <td>
                  <a href={o.source_url} target="_blank" rel="noreferrer">
                    打开1688 ↗
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
