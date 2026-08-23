"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { SourcingV3Graph } from "@/lib/sourcing/v3";

export function ModelCandidateAction() {
  const params = useParams() as Record<string, string>;
  const [graph, setGraph] = useState<SourcingV3Graph | null>(null);

  useEffect(() => {
    void fetch(`/api/sourcing/latest?runId=${encodeURIComponent(params.runId)}`)
      .then((response) => response.json())
      .then((body) => setGraph(body.v3 ?? null));
  }, [params.runId]);

  const modelId = decodeURIComponent(params.modelId);
  const model = graph?.models.find((item) => item.id === modelId);
  const href = model
    ? `/skus?runId=${encodeURIComponent(params.runId)}&modelId=${encodeURIComponent(modelId)}`
    : "/skus";

  return (
    <section className="v2-card">
      <div className="proposal-head">
        <div>
          <span className="eyebrow">商品选择</span>
          <h2>选择商品并进入 SKU 映射</h2>
          <p className="muted">
            选择当前款型，进入商品中心建立淘宝 SKU 与 1688 SourceSKU 的映射。
          </p>
        </div>
        <Link className="btn button-link" href={href} aria-disabled={!model}>
          {model ? "选择商品并进入SKU映射" : "进入SKU映射"}
        </Link>
      </div>
    </section>
  );
}
