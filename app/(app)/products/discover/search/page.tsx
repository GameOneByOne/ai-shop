import { SourcingDiscovery } from "@/components/sourcing/sourcing-discovery";

export default function Page() {
  return (
    <div className="v2-page sourcing-search-page">
      <div className="v2-crumb">选品中心　/　货源发现　/　新建搜索</div>
      <header className="v2-page-head">
        <div><h1>搜索 1688 货源</h1><p>输入商品词并选择筛选条件，系统将完成搜索与详情采集。</p></div>
      </header>
      <SourcingDiscovery compact createMode />
    </div>
  );
}
