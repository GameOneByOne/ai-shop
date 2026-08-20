# 选品与 1688 货源主链重构 V0.1

## 架构审计

- 真实链原先为 `sourcing_runs -> source_products -> raw_data.detailEnrichment.sourceProducts[].skus[]`。Offer、解析商品和 SKU 被嵌在 JSON 中，不能被候选、供应商、SKU Mapping 稳定引用。
- “加入选品池”原先只创建 `candidate_products`，并把 SourceSKU 追踪信息写进 `notes`；`suppliers`、`skus`、`supplier_products` 没有同步建立。
- `/products/candidates`、`/suppliers`、`/skus` 和履约页主要读取浏览器 localStorage 的 V2 Mock Store State，因此真实猫隧道数据到此断开。
- `store_profiles` 已包含店铺阶段、品类、毛利、风险偏好、新品强度和采购策略，可直接作为 SourcingTask 的策略快照，不需要第二套策略。
- `ai_runs/ai_analyses` 已具备可追溯 AI 基础设施；标准化表只保存其引用，不新增不可追溯的单值 AI 分数。

## 数据模型修改

迁移 `202608200019_unified_sourcing_domain.sql` 新增：

- `sourcing_tasks`：属于现有 Store/Profile，保存策略快照与 REAL/DEMO 模式。
- `source_offers`：引用已有抓取行，保留 URL、原始标题、属性与供应商原始数据。
- `source_skus`、`normalized_source_skus`：原始采购 SKU 与标准化语义分层；支持 role、raw_size 和品类化 dimensions JSON。
- `product_models`、`product_variants`：消费者款型与标准属性组合。
- `variant_source_mappings`：Variant 到 N 个 SourceSKU，数据库约束每个 Variant 最多一个有效 PRIMARY。
- `cost_snapshots`：只建立成本接口和证据，不固化成本公式。
- `supplier_reviews`、`sourcing_decisions`：供应商审核与主供/备供决策独立可追踪。
- 现有 `candidate_products` 和 `skus` 增加 Variant/Task 引用；没有建立平行 Candidate 或 Listing 系统。

## 数据迁移方案

1. 执行 019 迁移；现有抓取数据保持原状，默认标记 REAL。
2. 用户从真实货源详情选择 SourceSKU 时，决策 API 按顺序实体化 Task、Supplier、Offer、SourceSKU、Normalization、Model、Variant、CostSnapshot、Mapping、Candidate、SupplierReview 和 Decision。
3. 同 Task、同 ProductModel、同标准属性签名会复用 Variant；第一个 SourceSKU 为 PRIMARY，后续为 BACKUP。
4. 历史 `candidate_products.notes` 中的追踪数据不自动猜测回填；下一阶段可用一次性审计脚本验证后再迁移，避免错误关联。
5. 迁移属于新增表/列，回滚时可先停止新写入，再按逆依赖顺序删除新增对象；原始 `source_products.raw_data` 不受影响。

## 页面与 API 影响

- `/products/discover`：导航和采集流程不变；最终人工动作改为统一领域写入。
- `/products/candidates`：顶部展示 REAL Candidate/Model/Variant，底部明确隔离 DEMO 演示链。
- `/suppliers`：展示真实 Supplier Repository 和待审 Review，保留 1688 原链接。
- `/skus`：展示真实 Variant 的 PRIMARY/BACKUP 货源；现有 Mock 履约映射单独标为 DEMO。
- `POST /api/sourcing/decision`：成为当前主链编排入口；忽略动作仍只更新捕获 Offer 状态。
- Dashboard、订单、分析和 AI 店长未重构，避免破坏现有经营链。

## 新数据主链

`StoreProfile -> SourcingTask -> SourcingRun -> SourceOffer -> SourceSKU -> NormalizedSourceSKU -> ProductModel -> ProductVariant -> VariantSourceMapping (PRIMARY/BACKUP) -> CandidateProduct -> SupplierReview -> 现有 SKU/Content/Order`

原始层不会被标准化层覆盖；订单阶段未来只读取有效 PRIMARY mapping，缺货或异常时由 AIAction 提议切换 BACKUP，并保留人工批准。

## 猫隧道回归覆盖

- Case A/B：现有解析器从 Offer 内 variants 建立 SourceSKU，不以 Offer Title 作为最终商品身份。
- Case C：80cm 与 120cm 进入 Variant 属性签名，可属于同 ProductModel 但不会合并为同 Variant。
- Case D：名称含“垫子/配件/附件/替换”的 SKU 在标准化层标记 ACCESSORY/REPLACEMENT，不作为主商品语义。
- 当前工作区未配置可执行的本地 Supabase 数据库，因此没有伪造“69/19/25/51”运行结果；真实数据在应用迁移数据库后通过现有猫隧道任务逐项写入。

## DEMO / REAL 隔离

- 数据库统一使用 `data_mode = REAL|DEMO`；真实页面查询显式限定 REAL。
- localStorage V2 状态仍是 DEMO，仅用于订单履约演示，并在页面分区标识。
- 禁止 REAL Candidate 与 Mock 淘宝订单自动建立映射；后续真实淘宝接入必须沿 ProductVariant 引用创建。

## 占位模块与下一阶段规则

尚未深入实现：品类尺寸 Schema、尺寸容差、最终同款算法、Model 拆分规则、Variant 属性白名单、完整成本公式、运费模型、供应商评分权重、PRIMARY 自动选择/切换、淘宝定价、自动采购、自动上架、自动联系供应商。

下一阶段需依次定义：SourceOffer/SourceSKU 解析、ProductModel、ProductVariant、Size 标准化、同款判断、Variant × SourceSKU 比价、真实代发成本、供应商评价、PRIMARY/BACKUP 选择、淘宝定价利润和页面信息层级。
