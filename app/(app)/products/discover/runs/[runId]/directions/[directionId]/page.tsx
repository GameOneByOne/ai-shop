"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { isTrustedPrice } from "@/lib/sourcing/source-products";
import type { ProductDirection } from "@/lib/sourcing/directions";

type LatestPayload = {
  runId: string;
  directions: ProductDirection[];
  products: Array<{
    id: string;
    source_url: string;
    supplier_name: string | null;
    raw_data: Record<string, unknown>;
  }>;
};

function clampDirection(direction: ProductDirection, runProducts: LatestPayload["products"]): ProductDirection {
  const nextProducts = direction.products.map((product) => {
    const offer = runProducts.find((item) => item.id === product.sourceOfferId);
    return {
      ...product,
      source_url: (product as { source_url?: string }).source_url ?? offer?.source_url,
      supplier_name: product.supplier_name ?? offer?.supplier_name ?? null,
    } as ProductDirection["products"][number] & { source_url?: string };
  }) as ProductDirection["products"];

  return { ...direction, products: nextProducts };
}

function parseDirectionRows(direction: ProductDirection) {
  return direction.products.map((product) => {
    const skus = product.skus ?? [];
    const trusted = skus.filter((sku) => isTrustedPrice(sku));
    const prices = trusted
      .map((sku) => sku.dropshipPrice ?? sku.wholesalePrice)
      .filter((value): value is number => value != null);
    const priceRange = prices.length
      ? prices.length === 1
        ? `¥${prices[0].toFixed(2)}`
        : `¥${Math.min(...prices).toFixed(2)}~¥${Math.max(...prices).toFixed(2)}`
      : "待核实";

    const moqValues = skus
      .map((sku) => sku.dropshipMoq)
      .filter((value): value is number => value != null && value > 0);

    return {
      product: product as ProductDirection["products"][number] & { source_url?: string },
      skuCount: skus.length,
      dropshipping: product.supports_dropshipping ? "✓" : "—",
      moq: moqValues.length ? `${Math.min(...moqValues)}` : "待核实",
      supplier: product.supplier_name ?? "待核实",
      offerText: String(product.sourceOfferId).slice(0, 14),
      range: priceRange,
      trustRate: `${Math.round((trusted.length / Math.max(1, skus.length)) * 100)}%`,
      status: trusted.length > 0 ? "数据完整" : "待核实",
    };
  });
}

function directionPriceRange(direction: ProductDirection) {
  const values = direction.products.flatMap((product) =>
    (product.skus ?? [])
      .map((sku) => (isTrustedPrice(sku) ? sku.dropshipPrice ?? sku.wholesalePrice : null))
      .filter((value): value is number => value != null),
  );

  if (!values.length) return "待核实";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `¥${min.toFixed(2)}` : `¥${min.toFixed(2)}~¥${max.toFixed(2)}`;
}

export default function DirectionDetailPage() {
  const params = useParams();
  const directionId = String(params.directionId || "");

  const [payload, setPayload] = useState<LatestPayload | null>(null);
  const [sortBy, setSortBy] = useState("ai");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void fetch("/api/sourcing/latest")
      .then(async (response) => {
        const body = await response.json();
        if (!mounted) return;
        if (!response.ok || body.error) {
          throw new Error(body.error ?? "读取方向详情失败");
        }
        setPayload(body as LatestPayload);
      })
      .catch((e: unknown) => {
        if (mounted) {
          setError(e instanceof Error ? e.message : "读取方向详情失败");
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const direction = useMemo(() => {
    if (!payload) return null;
    const found = payload.directions.find((item) => item.id === directionId);
    return found ? clampDirection(found, payload.products) : null;
  }, [payload, directionId]);

  const rows = useMemo(() => {
    if (!direction) return [] as ReturnType<typeof parseDirectionRows>;
    const list = parseDirectionRows(direction);

    if (sortBy === "sku") {
      return [...list].sort((a, b) => b.skuCount - a.skuCount);
    }
    if (sortBy === "trust") {
      return [...list].sort(
        (a, b) => Number.parseInt(b.trustRate, 10) - Number.parseInt(a.trustRate, 10),
      );
    }
    if (sortBy === "price") {
      const parseRange = (text: string) =>
        text === "待核实" ? Number.POSITIVE_INFINITY : Number(text.replace("¥", "").split("~")[0]);
      return [...list].sort((a, b) => parseRange(a.range) - parseRange(b.range));
    }

    return [...list].sort(
      (a, b) => Number(b.product.confidence ?? 0) - Number(a.product.confidence ?? 0),
    );
  }, [direction, sortBy]);

  if (error) {
    return <div className="status-box error">{error}</div>;
  }

  if (!direction) {
    return (
      <div className="status-box">正在加载方向信息或当前方向不存在，请先返回货源发现重新进入。</div>
    );
  }

  const totalSku = direction.products.reduce((total, product) => total + product.skus.length, 0);

  return (
    <>
      <header className="top">
        <div>
          <span className="eyebrow">商品方向</span>
          <h1>{direction.name}</h1>
          <p className="muted">AI 方向判断：{direction.summary ?? direction.marketReason ?? "待核实"}</p>
        </div>
        <Link className="secondary-btn" href="/products/discover">
          返回方向列表
        </Link>
      </header>

      <section className="sourcing-funnel">
        <div>
          <b>{direction.products.length}</b>
          <span>候选货源</span>
        </div>
        <div>
          <b>{totalSku}</b>
          <span>可采购规格</span>
        </div>
        <div>
          <b>{directionPriceRange(direction)}</b>
          <span>可信报价区间</span>
        </div>
        <div>
          <b>{direction.taskRelevance === "PRIMARY" ? "核心方向" : "关联机会"}</b>
          <span>方向属性</span>
        </div>
      </section>

      <section className="content-toolbar" style={{ marginBottom: 12 }}>
        <span className="eyebrow">供应商比较</span>
        <label className="input">
          <select
            className="input"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value="ai">AI建议优先核实</option>
            <option value="price">最低可信代发成本</option>
            <option value="trust">供应商证据</option>
            <option value="sku">SKU覆盖</option>
          </select>
        </label>
      </section>

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>商品</th>
                <th>供应商</th>
                <th>Offer</th>
                <th>SKU 数</th>
                <th>一件代发</th>
                <th>代发MOQ</th>
                <th>可信价格范围</th>
                <th>数据状态</th>
                <th>动作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product.id}>
                  <td>{row.product.normalizedName}</td>
                  <td>{row.supplier}</td>
                  <td>
                    <a className="text-link" href={row.product.source_url ?? "#"} target="_blank" rel="noreferrer">
                      {row.offerText}
                    </a>
                  </td>
                  <td>{row.skuCount}</td>
                  <td>{row.dropshipping}</td>
                  <td>{row.moq}</td>
                  <td>{row.range}</td>
                  <td>
                    <span className={row.status === "待核实" ? "data-state data_error" : "data-state valid"}>{
                      `${row.status} · ${row.trustRate}`
                    }</span>
                  </td>
                  <td>
                    <Link className="btn" href={`/products/discover/sources/${row.product.id}?directionId=${direction.id}`}>
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
