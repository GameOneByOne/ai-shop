import Link from "next/link";
import { SourcingDiscovery } from "@/components/sourcing/sourcing-discovery";

export default function ProductSearchPage() {
  return (
    <div className="v2-page">
      <div className="v2-crumb">选品中心　/　新建选品任务</div>
      <header className="v2-page-head">
        <div>
          <h1>搜索真实货源</h1>
          <p>
            先采集 1688 Offer 与店铺资质并完成筛选，再解析通过筛选的商品与采购
            SKU。
          </p>
        </div>
        <div className="v2-actions">
          <Link className="v2-secondary" href="/products">
            返回选品总览
          </Link>
        </div>
      </header>
      <SourcingDiscovery />
    </div>
  );
}
