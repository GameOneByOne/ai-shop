import { UnifiedSkus } from "@/components/store/domain-views";
import { RealVariantMappings } from "@/components/sourcing/real-sourcing-views";
import { SelectedSkuMapping } from "@/components/sourcing/selected-sku-mapping";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const runId = typeof query.runId === "string" ? query.runId : "";
  const modelId = typeof query.modelId === "string" ? query.modelId : "";
  const sourceSkuId =
    typeof query.sourceSkuId === "string" ? query.sourceSkuId : "";
  return (
    <>
      <header className="top">
        <div>
          <div className="eyebrow">商品中心 · ProductVariant ↔ SourceSKU</div>
          <h1>SKU 映射</h1>
          <p className="muted">为选中的商品建立淘宝 SKU 与 1688 货源关系</p>
        </div>
      </header>
      {runId && modelId && (
        <SelectedSkuMapping
          runId={runId}
          modelId={modelId}
          sourceSkuId={sourceSkuId}
        />
      )}
      <div className="notice">REAL DATA · PRIMARY / BACKUP Mapping</div>
      <RealVariantMappings />
      <div className="ops-section-title">
        <div><span>DEMO DATA</span><h2>本地订单履约映射</h2></div>
      </div>
      <UnifiedSkus />
    </>
  );
}
