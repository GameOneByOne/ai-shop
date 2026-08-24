"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { calculateSkuListingPrice, isTrustedPrice, type SourceSkuRecord } from "@/lib/sourcing/source-products";

type SourceProduct = {
  id: string;
  sourceOfferId: string;
  normalizedName: string;
  source_url: string;
  supplier_name: string | null;
  supports_dropshipping: boolean | null;
  supports_privacy_dropshipping: boolean | null;
  confidence: number;
  skus: SourceSkuRecord[];
};

type OfferRow = {
  id: string;
  source_url: string;
  title: string;
  supplier_name: string | null;
  raw_data: { detailEnrichment?: { sourceProducts?: Array<Record<string, unknown>> } };
};

interface LatestPayload {
  runId: string;
  products: OfferRow[];
}

type SkuForm = {
  dropshipPrice: string;
  dropshipMoq: string;
  wholesalePrice: string;
  wholesaleMoq: string;
  shippingFee: string;
  evidenceNote: string;
};

function toNumber(value: string) {
  const raw = Number.parseFloat(value);
  return Number.isFinite(raw) ? raw : null;
}

function toInt(value: string) {
  const raw = Number.parseInt(value, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function moneyText(value: number | null | undefined) {
  if (value == null) return "待核实";
  return `¥${value.toFixed(2)}`;
}

export default function SourceDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const sourceProductId = String(params.sourceProductId || "");
  const directionId = search.get("directionId");

  const [runId, setRunId] = useState("");
  const [sourceProduct, setSourceProduct] = useState<SourceProduct | null>(null);
  const [sourceOfferId, setSourceOfferId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [forms, setForms] = useState<Record<string, SkuForm>>({});

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/sourcing/latest");
        const body = await response.json();
        if (!active) return;
        if (!response.ok || body.error) throw new Error(body.error ?? "读取数据失败");
        setRunId(body.runId ?? "");

        for (const offer of body.products ?? []) {
          const detail = (offer.raw_data?.detailEnrichment ?? {}) as {
            sourceProducts?: Array<Record<string, unknown>>;
          };
          const products = Array.isArray(detail.sourceProducts)
            ? detail.sourceProducts
            : [];
          const found = products.find((item) => String(item.id) === sourceProductId);
          if (!found) continue;

          const sp = found as Record<string, unknown>;
          const skus = Array.isArray(sp.skus) ? sp.skus as SourceSkuRecord[] : [];
          const parsed: SourceProduct = {
            id: String(sp.id),
            sourceOfferId: offer.id,
            normalizedName: String(sp.normalizedName ?? "未命名货源"),
            source_url: offer.source_url,
            supplier_name: (sp.supplier_name as string | null) ?? offer.supplier_name ?? null,
            supports_dropshipping:
              (sp.supports_dropshipping as boolean | null) ??
              (((offer as Record<string, unknown>).supportsDropshipping as boolean | null) ?? null),
            supports_privacy_dropshipping: (sp.supports_privacy_dropshipping as boolean | null),
            confidence: Number(sp.confidence ?? 0),
            skus,
          };

          const initialForms = Object.fromEntries(
            skus.map((sku) => [
              sku.id,
              {
                dropshipPrice: sku.dropshipPrice == null ? "" : String(sku.dropshipPrice),
                dropshipMoq: sku.dropshipMoq == null ? "" : String(sku.dropshipMoq),
                wholesalePrice: sku.wholesalePrice == null ? "" : String(sku.wholesalePrice),
                wholesaleMoq: sku.wholesaleMoq == null ? "" : String(sku.wholesaleMoq),
                shippingFee: sku.shippingFee == null ? "" : String(sku.shippingFee),
                evidenceNote: "",
              },
            ]),
          );

          setSourceProduct(parsed);
          setSourceOfferId(offer.id);
          setForms(initialForms);
          return;
        }

        setSourceProduct(null);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "读取任务失败");
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [sourceProductId]);

  const trustedCount = useMemo(
    () => (sourceProduct?.skus.filter((sku) => isTrustedPrice(sku)).length ?? 0),
    [sourceProduct],
  );

  const totalCount = sourceProduct?.skus.length ?? 0;

  const sortedSkus = useMemo(() => {
    if (!sourceProduct) return [];
    return [...sourceProduct.skus].sort((a, b) => {
      const aStatus = isTrustedPrice(a) ? 0 : 1;
      const bStatus = isTrustedPrice(b) ? 0 : 1;
      if (aStatus !== bStatus) return aStatus - bStatus;
      const aPrice = a.dropshipPrice ?? a.wholesalePrice ?? Number.POSITIVE_INFINITY;
      const bPrice = b.dropshipPrice ?? b.wholesalePrice ?? Number.POSITIVE_INFINITY;
      return aPrice - bPrice;
    });
  }, [sourceProduct]);

  async function submitVerify(skuId: string) {
    if (!sourceProduct || !runId || !sourceOfferId) return;

    const current = forms[skuId];
    if (!current) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/sourcing/manual-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          sourceOfferId,
          sourceProductId: sourceProduct.id,
          sourceSkuId: skuId,
          dropshipPrice: toNumber(current.dropshipPrice),
          dropshipMoq: toInt(current.dropshipMoq),
          wholesalePrice: toNumber(current.wholesalePrice),
          wholesaleMoq: toInt(current.wholesaleMoq),
          shippingFee: toNumber(current.shippingFee),
          supportsPrivacyDropshipping: sourceProduct.supports_privacy_dropshipping,
          evidenceNote: current.evidenceNote,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "人工核实失败");
      }
      setMessage("人工核价已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "人工核实失败");
    } finally {
      setLoading(false);
    }
  }

  async function addToCandidates() {
    if (!sourceProduct || !runId || !sourceOfferId || selectedSkus.length === 0) return;
    setLoading(true);
    setMessage("");
    try {
      for (const skuId of selectedSkus) {
        const sku = sourceProduct.skus.find((item) => item.id === skuId);
        if (!sku) continue;

        const response = await fetch("/api/sourcing/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceOfferId,
            action: "candidate",
            sourceProduct: {
              id: sourceProduct.id,
              normalizedName: sourceProduct.normalizedName,
              supplierName: sourceProduct.supplier_name ?? "1688待审核供应商",
              sourceUrl: sourceProduct.source_url,
              directionId: directionId ?? "source-direction",
              ruleScore: sourceProduct.confidence,
              dataConfidence: Math.min(100, totalCount ? Math.round((trustedCount / totalCount) * 100) : 0),
              verificationNeeded: [],
              supportsDropshipping: Boolean(sourceProduct.supports_dropshipping),
              supportsPrivacyDropshipping: sourceProduct.supports_privacy_dropshipping,
              taskRelevance: "PRIMARY",
              commercialReadiness: 0,
              reviewId: undefined,
            },
            sourceSku: {
              id: sku.id,
              specName: sku.specName,
              price: sku.dropshipPrice ?? sku.wholesalePrice ?? 0,
              priceStatus: isTrustedPrice(sku) ? "VERIFIED" : "HIGH_CONFIDENCE",
              shippingFee: sku.shippingFee,
              promotionDiscount: sku.promotionDiscount ?? 0,
              dropshipMoq: sku.dropshipMoq,
              wholesaleMoq: sku.wholesaleMoq,
            },
          }),
        });

        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "加入选品池失败");
        }
      }
      setMessage("已加入选品池，接下来可在候选商品池继续推进。\n");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入选品池失败");
    } finally {
      setLoading(false);
    }
  }

  function updateForm(skuId: string, key: keyof Omit<SkuForm, "evidenceNote">, value: string) {
    setForms((current) => ({
      ...current,
      [skuId]: {
        ...current[skuId],
        [key]: value,
      },
    }));
  }

  if (!sourceProduct) {
    return (
      <div className="status-box error">未找到该货源信息。请返回方向页重新进入该货源。</div>
    );
  }

  return (
    <>
      <header className="top">
        <div>
          <span className="eyebrow">具体1688货源核实</span>
          <h1>{sourceProduct.normalizedName}</h1>
          <p className="muted">供应商：{sourceProduct.supplier_name ?? "待核实"}</p>
          <a className="text-link" href={sourceProduct.source_url} target="_blank" rel="noreferrer">
            打开1688原商品 ↗
          </a>
        </div>
        <div className="action-buttons">
          <Link
            className="secondary-btn"
            href={directionId && runId ? `/products/discover/runs/${runId}/directions/${directionId}` : "/products/discover"}
          >
            返回方向
          </Link>
        </div>
      </header>

      <section className="sourcing-funnel">
        <div><b>{sourceProduct.skus.length}</b><span>可采购规格</span></div>
        <div><b>{trustedCount}</b><span>可信规格</span></div>
        <div><b>{sourceProduct.supports_dropshipping ? "支持" : "未确认"}</b><span>一件代发</span></div>
      </section>

      {message ? <div className={`status-box ${message.includes("失败") ? "error" : "success"}`}>{message}</div> : null}
      {loading ? <div className="status-box reading">处理中…</div> : null}

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>选择</th>
                <th>SKU图</th>
                <th>规格</th>
                <th>代发价</th>
                <th>普通批发价</th>
                <th>定价</th>
                <th>代发MOQ</th>
                <th>库存</th>
                <th>代发是否密文</th>
                <th>Price Confidence</th>
                <th>状态</th>
                <th>人工核价</th>
              </tr>
            </thead>
            <tbody>
              {sortedSkus.map((sku) => {
                const isTrusted = isTrustedPrice(sku);
                const confidence = isTrusted ? "高可信" : "待核实";
                const status = sku.priceStatus === "NEEDS_REVIEW" ? "待核实" : sku.priceStatus;
                const isSelected = selectedSkus.includes(sku.id);
                const listingPrice = calculateSkuListingPrice(sku.targetSalePriceMin, sku.shippingFee);
                const form = forms[sku.id] ?? {
                  dropshipPrice: "",
                  dropshipMoq: "",
                  wholesalePrice: "",
                  wholesaleMoq: "",
                  shippingFee: "",
                  evidenceNote: "",
                };

                return (
                  <tr key={sku.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => {
                          setSelectedSkus((current) => {
                            if (event.target.checked) return [...new Set([...current, sku.id])];
                            return current.filter((id) => id !== sku.id);
                          });
                        }}
                      />
                    </td>
                    <td>{sku.image ? <img className="v2-mini-img" src={sku.image} alt={sku.specName || "SourceSKU"} /> : "—"}</td>
                    <td>{sku.specName || "待核实规格"}</td>
                    <td>{moneyText(sku.dropshipPrice)}</td>
                    <td>{moneyText(sku.wholesalePrice)}</td>
                    <td>{listingPrice == null ? "待核实" : <><b>{moneyText(listingPrice)}</b><small style={{display:"block"}}>规则 {moneyText(sku.targetSalePriceMin)} + 运费 {moneyText(sku.shippingFee)}</small></>}</td>
                    <td>{sku.dropshipMoq == null ? "待核实" : sku.dropshipMoq}</td>
                    <td>{sku.inventory == null ? "待核实" : sku.inventory}</td>
                    <td>{sourceProduct.supports_privacy_dropshipping ? "是" : "否"}</td>
                    <td>{confidence}</td>
                    <td>{status}</td>
                    <td>
                      <button
                        className="btn"
                        onClick={() => void submitVerify(sku.id)}
                        disabled={loading}
                      >
                        人工核实
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>人工核价</h2>
        <p className="muted">选择具体规格后可填写核价；填写后将用于更新该规格的可信价格。</p>
        <div className="manual-verification">
          <form
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
              <label>
                一件代发价
                <input
                  className="input"
                  value={forms[selectedSkus[0] ?? sourceProduct.skus[0]?.id]?.dropshipPrice ?? ""}
                  onChange={(event) => {
                    const target = selectedSkus[0] ?? sourceProduct.skus[0]?.id;
                    if (!target) return;
                    updateForm(target, "dropshipPrice", event.target.value);
                  }}
                  placeholder="例如 12.50"
                />
              </label>
              <label>
                代发MOQ
                <input
                  className="input"
                  value={forms[selectedSkus[0] ?? sourceProduct.skus[0]?.id]?.dropshipMoq ?? ""}
                  onChange={(event) => {
                    const target = selectedSkus[0] ?? sourceProduct.skus[0]?.id;
                    if (!target) return;
                    updateForm(target, "dropshipMoq", event.target.value);
                  }}
                  placeholder="例如 1"
                />
              </label>
              <label>
                普通批发价
                <input
                  className="input"
                  value={forms[selectedSkus[0] ?? sourceProduct.skus[0]?.id]?.wholesalePrice ?? ""}
                  onChange={(event) => {
                    const target = selectedSkus[0] ?? sourceProduct.skus[0]?.id;
                    if (!target) return;
                    updateForm(target, "wholesalePrice", event.target.value);
                  }}
                  placeholder="例如 11.80"
                />
              </label>
              <label>
                普通MOQ
                <input
                  className="input"
                  value={forms[selectedSkus[0] ?? sourceProduct.skus[0]?.id]?.wholesaleMoq ?? ""}
                  onChange={(event) => {
                    const target = selectedSkus[0] ?? sourceProduct.skus[0]?.id;
                    if (!target) return;
                    updateForm(target, "wholesaleMoq", event.target.value);
                  }}
                  placeholder="例如 5"
                />
              </label>
              <label>
                运费
                <input
                  className="input"
                  value={forms[selectedSkus[0] ?? sourceProduct.skus[0]?.id]?.shippingFee ?? ""}
                  onChange={(event) => {
                    const target = selectedSkus[0] ?? sourceProduct.skus[0]?.id;
                    if (!target) return;
                    updateForm(target, "shippingFee", event.target.value);
                  }}
                  placeholder="例如 4.00"
                />
              </label>
            </div>
            <label>
              备注
              <textarea
                className="textarea input"
                value={forms[selectedSkus[0] ?? sourceProduct.skus[0]?.id]?.evidenceNote ?? ""}
                onChange={(event) => {
                  const target = selectedSkus[0] ?? sourceProduct.skus[0]?.id;
                  if (!target) return;
                  const key = target;
                  setForms((current) => ({
                    ...current,
                    [key]: {
                      ...current[key],
                      evidenceNote: event.target.value,
                    },
                  }));
                }}
              />
            </label>
          </form>
        </div>
      </section>

      <div className="action-buttons">
        <button
          className="btn"
          onClick={() => void addToCandidates()}
          disabled={loading || selectedSkus.length === 0}
        >
          加入选品池
        </button>
      </div>
    </>
  );
}
