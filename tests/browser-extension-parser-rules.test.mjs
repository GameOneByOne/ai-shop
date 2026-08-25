import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../browser-extension/page-scraper.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../browser-extension/background.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../browser-extension/bridge.js", import.meta.url), "utf8");
const enrichRoute = readFileSync(new URL("../app/api/sourcing/enrich/route.ts", import.meta.url), "utf8");
const importRoute = readFileSync(new URL("../app/api/sourcing/browser-import/route.ts", import.meta.url), "utf8");
const aiSelectionRoute = readFileSync(new URL("../app/api/sourcing/ai-selection/route.ts", import.meta.url), "utf8");
const productRecognitionRoute = readFileSync(new URL("../app/api/sourcing/product-recognition/route.ts", import.meta.url), "utf8");
const ruleSelectionRoute = readFileSync(new URL("../app/api/sourcing/rule-selection/route.ts", import.meta.url), "utf8");
const selectionCenter = readFileSync(new URL("../components/sourcing/selection-center-real.tsx", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../browser-extension/manifest.json", import.meta.url), "utf8"));

const noise = /(?:包装|opp袋|定制|贴标|贴牌|标签|条码|加字|改尺寸|商标|分装)/i;
const hasPriceAndStock = (text) =>
  /[¥￥]\s*\d+(?:\.\d+)?/.test(text) && /(?:库存|可售)\s*\d+/.test(text);
const isPurchasableSpecRow = (text) => hasPriceAndStock(text) && !noise.test(text);

const cases = [
  ["2mm（65*30） ¥3.6 库存99906", true],
  ["加厚大号 ¥12.8 可售350", true],
  ["蓝色-加长款 ￥9 库存 88", true],
  ["定制加字 ¥0.5 库存1000", false],
  ["OPP袋 ¥0.2 可售500", false],
  ["单一规格", false],
];

for (const [text, expected] of cases) {
  assert.equal(isPurchasableSpecRow(text), expected, `规格行分类错误：${text}`);
}

assert.match(source, /\(\?:颜色\|款式\|型号\)/, "必须支持颜色、款式和型号区");
assert.match(source, /\(\?:规格\|尺寸\)/, "必须支持规格和尺寸区");
assert.match(source, /if\s*\(\s*!specLabel\s*\)\s*return\s*\[\s*\]/, "价格库存行必须限制在规格区内");
assert.match(source, /textSpecRows/, "必须支持跨嵌套节点的规格区可见文本解析");
assert.match(source, /fallbackSpecs\.length\s*===\s*1/, "单一规格不拆分，但必须保留其价格和库存");
assert.match(source, /singleSpecName/, "单一规格文字必须附加到每个一级选项 SourceSKU");
assert.match(source, /\[colorName, singleSpecName\]/, "单一规格必须写入 SourceSKU 的 specValues");
assert.match(source, /如图\[\.。\]\?/, "如图等占位文字不能作为 SourceSKU 规格");
assert.match(source, /primaryOptionMentions\s*<=\s*1/, "包含多个一级选项名称的文本不能作为单一规格");
assert.doesNotMatch(source, /dimensionSpecs/, "禁止恢复尺寸格式专用兜底");
assert.doesNotMatch(source, /\(\?:mm\|cm\|m\)/, "禁止按计量单位硬编码规格解析");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "扩展必须记录语义化解析版本");

const embeddedPayload = {
  result: {
    data: {
      Root: { fields: { dataJson: {
        tempModel: { offerTitle: "真实商品标题", companyName: "真实供应商有限公司" },
        skuModel: {
          skuProps: [{ prop: "款式", value: [{ name: "标准款" }] }],
          skuInfoMap: { "标准款&gt;纸盒包装": { skuId: 123, discountPrice: "8.69", canBookCount: 99 } },
        },
      } } },
      gallery: { fields: { mainImage: ["https://cbu01.alicdn.com/img/ibank/product.jpg"] } },
      productTitle: { fields: { tagList: [{ text: "1688严选", type: "1688_ELECTION" }], rateInfo: { goodsGrade: 4.3, goodRates: 82.5, commonTagNodeList: [{ name: "全部", count: 40 }] } } },
      productEvaluation: { fields: { rateInfo: { goodsGrade: 1.6, goodRates: 20, commonTagNodeList: [{ name: "全部", count: 5 }] } } },
    },
    global: { globalData: { model: { detailBusiness: { shopBaseInfo: { isPmSource: true, byrRepeatRate3m: "41.09%" } } } } },
  },
};
const parserContext = {
  document: { scripts: [{ textContent: `window.context=(function(){})(window.contextPath,${JSON.stringify(embeddedPayload)});` }], querySelector: () => null },
  TextDecoder,
};
vm.createContext(parserContext);
vm.runInContext(source.slice(0, source.indexOf("function decode1688Keyword")), parserContext);
vm.runInContext(source.slice(source.indexOf("function compactChineseCount"), source.indexOf("function structuredProductReviewFacts")), parserContext);
const embeddedState = parserContext.extractEmbeddedOfferState();
const embeddedFacts = parserContext.embeddedOfferFacts(embeddedState);
const embeddedVariants = parserContext.embeddedSkuVariants(embeddedState, "offer-1");
const productActionFacts = parserContext.criticalPageRuleFacts("收藏 (84) 店铺关注 2.3万");
assert.equal(embeddedFacts.supplierName, "真实供应商有限公司", "供应商必须优先来自当前 Offer 结构化数据");
assert.equal(embeddedFacts.review.productRating, 1.6, "商品评分必须只读取商品评价模块的数据");
assert.equal(embeddedFacts.review.totalReviewCount, 5, "评价数必须只读取商品评价模块的数据");
assert.equal(embeddedFacts.hasSelectionTitle, true, "严选标识必须来自商品标题模块的 tagList");
assert.equal(embeddedFacts.selectionTitle, "1688严选");
assert.equal(embeddedFacts.merchantFeatures.join(" · "), "源头旗舰", "商家特色必须来自供应商结构化信息");
assert.deepEqual(Array.from(embeddedFacts.mainImages), ["https://cbu01.alicdn.com/img/ibank/product.jpg"], "商品主图必须来自固定 gallery.mainImage");
assert.equal(embeddedVariants.length, 1, "SourceSKU 必须支持页面内嵌 skuInfoMap");
assert.deepEqual(Array.from(embeddedVariants[0].specValues), ["标准款", "纸盒包装"]);
assert.equal(embeddedVariants[0].price, 8.69);
assert.equal(embeddedVariants[0].stock, 99);
assert.equal(embeddedVariants[0].image, "https://cbu01.alicdn.com/img/ibank/product.jpg", "单一SKU没有专属图片时必须使用商品主图");
assert.equal(productActionFacts.productFavoriteCount, 84, "商品收藏数必须支持页面操作区的‘收藏 (84)’格式");
assert.equal(productActionFacts.shopFavoriteCount, undefined, "商品收藏数不得继续写入店铺收藏字段");

const realOfferText = "AI严选指数 4.6 商品评价 4.9 30+人好评 好评率97.4% 已售1.1万+ 1个起批 ¥13.00～¥25.00 新人价 ¥12.00起 店铺头部 48小时支揽率99% 密文代发 24h揽收率57% 48h揽收率100% 近30日代发量100+";
assert.equal(/商品评价\s*[：:]?\s*(\d(?:\.\d+)?)/.exec(realOfferText)?.[1], "4.9", "商品评分必须锚定商品评价区，不能读取 AI 严选指数");
assert.equal(/(\d+(?:\.\d+)?)(万)?(\+)?\s*人好评/.exec(realOfferText)?.[1], "30", "好评数必须读取 XX+人好评");
const reviewDisplays = ["10+条评价", "300+条评价", "1.1万+条评价"];
assert.deepEqual(reviewDisplays.map((text) => /(\d+(?:\.\d+)?)(万)?(\+)?\s*条评价/.exec(text)?.slice(1, 4).filter(Boolean).join("")), ["10+", "300+", "1.1万+"], "总评价数必须保留加号和万加号展示口径");
assert.match(source, /function findProductReviewModule/, "评价字段必须先定位商品评价模块");
assert.match(source, /function nodesWithOwnText/, "大型详情页必须用文本节点定位模块，禁止扫描所有容器的完整 textContent");
assert.doesNotMatch(source, /querySelectorAll\(\"div,span,a,button,h1,h2,h3,h4\"\)/, "评价模块定位禁止遍历所有容器及其完整后代文字");
assert.match(source, /structuredProductReviewFacts/, "必须优先检查商品结构化评价数据");
assert.doesNotMatch(source, /productTitle\?\.fields\?\.rateInfo/, "商品标题区评价摘要禁止作为商品评价真值");
assert.doesNotMatch(source, /globalData\?\.model\?\.detailBusiness\?\.rateInfo/, "店铺或全局评价摘要禁止作为商品评价真值");
assert.match(source, /scrollIntoView/, "商品评价模块必须滚动进入可视区域以触发懒加载");
assert.match(source, /查看全部评价/, "评价模块必须支持展开全部评价入口");
assert.match(source, /function safeReviewControl/, "评价入口点击前必须检查是否会触发页面导航");
assert.doesNotMatch(source, /\/\^\(\?:A\|BUTTON\)\$\//, "禁止直接点击普通评价链接导致详情页导航和消息超时");
assert.match(source, /positiveReviewCount/, "好评人数必须与总评价数独立保存");
assert.doesNotMatch(source, /AI\\s\*严选指数[^\n]*exec\(bodyText\)/, "AI严选指数禁止从整页文字读取");
assert.doesNotMatch(source, /商品复购率[^\n]*exec\(bodyText\)/, "商品复购率禁止从整页文字读取");
assert.doesNotMatch(source, /reviewText\s*\|\|\s*bodyText/, "评价字段禁止回退到整页文字");
for (const status of ["正在定位商品评价模块", "正在加载商品评价", "正在解析商品评分", "商品评价解析完成", "商品评价模块不存在", "商品评价加载失败"])
  assert.match(source + background, new RegExp(status), `缺少评价解析状态：${status}`);
assert.doesNotMatch(selectionCenter, /商品评分<\/dt><dd>\{[^}]*待获取/, "商品评分缺失时必须隐藏，不能显示待获取");
const dropshipSection = realOfferText.slice(realOfferText.indexOf("密文代发"));
assert.equal(/24\s*(?:H|小时)\s*(?:揽收|支揽|发货)率\s*(\d+(?:\.\d+)?)%/i.exec(dropshipSection)?.[1], "57", "24H 揽收率必须来自代发模块");
assert.equal(/48\s*(?:H|小时)\s*(?:揽收|支揽|发货)率\s*(\d+(?:\.\d+)?)%/i.exec(dropshipSection)?.[1], "100", "48H 揽收率必须来自同一代发模块");
assert.match(source, /offerPriceMin/, "必须单独采集 Offer 价格区间，禁止用首个 SourceSKU 价格代替");
assert.match(source, /newcomerPriceDisplay/, "新人价必须保留价格和起价口径");
assert.match(source, /salesDisplay/, "销量必须保留万和加号展示口径");
assert.match(source, /shopPickup48Rate/, "店铺48小时支揽率必须独立于代发模块揽收率保存");
assert.match(source, /extractPageTitle\(supplierName\)/, "商品标题解析必须显式排除当前供应商名称");
assert.match(source, /isSupplierTitle/, "商品标题候选必须过滤公司/工厂名称");
assert.match(source, /isPromotionTitle/, "商品标题候选必须过滤限购、优惠等促销文案");
assert.match(source, /extractMaterialPreviewTitle/, "商品标题必须优先读取铺货素材预览");
assert.match(source, /materialPreviewTitle\s*\|\|\s*extractPageTitle/, "素材预览标题必须高于详情页通用标题候选");
assert.match(source, /function cleanProductTitle/, "商品标题必须统一清洗非商品字段");
assert.match(source, /一件代发/, "标题清洗必须去除一件代发等交易标签");
assert.match(enrichRoute, /validProductTitle/, "服务端必须二次拒绝促销文案标题，避免污染历史数据");
assert.match(enrichRoute, /variants:\s*z\.array\(variant\)\.min\(1\)\.max\(500\)/, "真实颜色×规格矩阵不得被旧的50条上限拒绝");
assert.match(enrichRoute, /issue\?\.path\.join/, "详情格式错误必须返回具体字段路径");
assert.match(source, /selectedSkuState/, "点击 SourceSKU 后必须读取当前规格模块状态");
assert.match(source, /purchaseModule/, "SKU价格库存必须支持从采购模块和底部已选规格行读取");
assert.match(source, /waitForSelectedSkuState/, "规格点击后必须等待异步价格库存稳定");
assert.match(source, /detailDeadline/, "详情解析必须设置内部时间预算，禁止由外层消息超时丢失整条 Offer");
assert.match(source, /SourceSKU解析达到时间上限，已保存可用数据/, "SKU矩阵过大时必须保存已解析数据并返回明确状态");
assert.doesNotMatch(source, /colorOptions\.slice\(/, "真实一级规格不得按固定数量截断，应由时间预算安全退出");
assert.match(source, /directSkuRows/, "页面直接展示价格库存时必须完整逐行解析 SourceSKU");
assert.match(source, /contextText/, "点击型规格必须用当前已选规格行校验价格库存归属");
assert.match(source, /colorImage\.click\(\)/, "图片规格必须点击真实图片选项，不能点击不稳定的外层容器");
assert.match(source, /colorLabel \? global : \[\]/, "未识别规格模块时禁止把整页图片当作SourceSKU逐个点击");
assert.match(background, /Math\.min\(2, selected\.length\)/, "详情解析应限制为最多2条并行以缩短小批量等待");
assert.match(source, /selectedColorState\.price/, "一级规格价格必须支持从独立价格节点读取");
assert.match(source, /selectedColorState\.stock/, "一级规格库存必须支持从独立库存节点读取");
assert.match(source, /mainCategory/, "必须采集店铺头部主营类目");
assert.match(source, /productCategory/, "必须独立采集并保存货源商品所属分类");
assert.match(source, /CpvEnhance/, "商品分类必须优先读取1688结构化商品属性");
assert.match(enrichRoute, /productCategory:\s*z\.string/, "服务端必须接收商品分类字段");
assert.match(selectionCenter, /<th>分类<\/th>/, "候选表必须显示货源商品分类");
assert.match(selectionCenter, /stringFact\(facts,\s*"productCategory"\)/, "分类列必须读取已保存的商品分类，不能读取AI款式方向");
assert.match(source, /源头旗舰/, "必须识别店铺头部源头旗舰标签");
assert.match(source, /1688_ELECTION/, "严选标识必须读取商品标题模块的结构化标签类型");
assert.match(source, /merchantFeatures/, "实力商家、源头旗舰等必须独立保存为商家特色");
assert.doesNotMatch(source, /shopHeaderText\s*=.*bodyText/, "商家特色禁止回退到整页文字解析");
assert.match(source, /\.module-od-consign/, "分销代发字段必须限定在1688密文代发模块内解析");
assert.match(source, /fulfillmentModule\s*=\s*smallestModule/, "履约字段必须从最小履约模块解析");
assert.match(source, /送至\\s\*\[\\u4e00-\\u9fa5\]/, "发货地必须从“发货地送至收货地”的履约文案解析");
assert.doesNotMatch(source, /dropshipText\s*\|\|\s*bodyText/, "分销代发指标禁止回退到整页文字混合判断");
assert.doesNotMatch(source, /按 1688 密文代发模块当前固定图标顺序兜底/, "密文代发平台禁止按图标位置推演");
assert.match(background, /hasEffectiveSearchFilters\(filters\)/, "默认条件必须跳过无实际筛选操作");
assert.match(background, /filters_skipped/, "搜索流程必须报告跳过空筛选的明确状态");
assert.match(source, /async function hydrateSearchResults/, "搜索页必须滚动加载懒加载商品卡后再统计 Offer");
assert.match(source, /gallery\.mainImage/, "详情主图必须优先读取结构化 gallery.mainImage");
assert.match(source, /\/img\\\/ibank\\\//, "搜索卡主图必须优先选择1688商品图片路径");
assert.match(source, /badge\|label/, "图片兜底必须排除商家徽标和标签图");
assert.match(source, /stableRounds/, "搜索页滚动必须等待商品卡和页面高度稳定");
assert.match(source, /const accumulated = new Map/, "虚拟滚动搜索页必须跨滚动窗口累计 Offer，不能只读取最后一屏");
assert.match(source, /currentTop \+ viewport \* 0\.65/, "虚拟列表必须用更小步长逐屏采集，禁止跳过尚未挂载的中间 Offer");
assert.match(source, /function searchResultsScrollRoot/, "必须定位1688商品列表内部滚动容器，不能假设页面由window滚动");
assert.match(source, /overflowY/, "内部滚动容器必须通过真实可滚动样式识别");
assert.match(source, /root\.dispatchEvent\(new Event\("scroll"/, "滚动内部商品列表时必须触发懒加载事件");
assert.match(source, /function findSearchNextPageControl/, "下一页必须支持固定分页容器和无文字语义按钮");
assert.match(source, /settleSearchResultsAtBottom/, "查找下一页前必须等待商品列表和页面高度稳定");
assert.match(source, /minimumLoadWindow = 20_000/, "未达到目标数时必须保留至少20秒完整懒加载窗口");
assert.match(source, /maximumLoadWindow = 55_000/, "单页懒加载必须在外层命令超时前返回累计结果");
assert.match(background, /EXTRACT_SEARCH", targetCount \}, 70000/, "搜索卡片采集必须使用独立于普通页面命令的超时预算");
assert.match(source, /await wait\(1800\)/, "1688懒加载每轮必须保留足够的组件挂载时间");
assert.match(source, /stableRounds >= 8/, "搜索结果必须连续多轮稳定后才能判定本页加载完成");
assert.match(source, /stableRounds >= 4/, "查找分页前必须再次等待底部列表连续稳定");
assert.ok(source.includes('a[rel="next"]'), "下一页必须支持rel=next标准链接");
assert.doesNotMatch(source, /\.\.\.document\.querySelectorAll\("a,button,li,\[role=button\]"\)/, "下一页禁止扫描整页箭头按钮，避免误点轮播或推荐区");
assert.match(source, /method:\s*"verified_pagination_control"/, "下一页只能点击已验证的分页控件");
assert.doesNotMatch(source, /searchParams\.set\("keywords"/, "翻页禁止重写中文关键词URL，避免字符集乱码");
assert.doesNotMatch(background, /function matchesSearchKeyword/, "翻页后不得按标题关键词二次过滤真实搜索结果");
assert.doesNotMatch(background, /翻页后搜索词异常/, "1688搜索框乱码不得导致翻页采集失败");
assert.doesNotMatch(source, /searchParams\.set\("beginPage"/, "找不到分页控件时禁止猜测页码URL");
assert.match(source, /root\.querySelectorAll\('a\[href\]'/, "无文字下一页按钮时必须从真实分页容器的页码链接识别下一页");
assert.match(source, /targetPage <= currentPage/, "分页链接只能前进，禁止误点当前页或上一页");
assert.match(source, /pageNo.*pageNum.*currentPage/, "分页必须兼容1688新的页码参数");
assert.match(source, /icon-only SPA pagination buttons/, "分页必须支持无文字SPA下一页按钮");
assert.match(background, /商品列表没有变化/, "翻页后必须验证Offer列表确实变化");
assert.match(background, /items\.length && collection\.targetReached/, "未达到目标Offer数时禁止提前进入详情解析");
assert.match(source, /count >= Math\.max\(1, targetCount\)/, "搜索页只能在去重 Offer 数达到本页目标后提前停止");
assert.match(background, /targetOfferCount - unique\.size/, "每页采集目标必须使用全局去重目标的剩余缺口");
assert.match(background, /Math\.min\(30, Number\(message\.maxPages\)/, "必须允许持续翻页直到达到目标数量");
assert.match(source, /\.then\(\(items\) => sendResponse\(\{ items \}\)\)/, "搜索结果必须返回滚动期间累计的 Offer");
assert.match(source, /\.\.\.\(image \? \{ imageUrl: image \} : \{\}\)/, "未识别商品图时必须省略 imageUrl，禁止发送 null 破坏导入格式");
assert.match(background, /target_shortfall/, "搜索结果不足目标数量时必须返回明确的缺口状态");
assert.match(background, /shortfall:\s*Math\.max/, "搜索统计必须保存目标数量缺口");
assert.match(background, /opening_detail/, "详情打开阶段必须发送心跳");
assert.match(background, /detail_parsed/, "详情解析阶段必须发送心跳");
assert.match(bridge, /if \(settled\) return/, "正常完成后断开端口不能误报失败");
assert.match(bridge, /采集连接意外中断/, "扩展意外断连必须立即返回明确错误");
assert.match(importRoute, /searchTitle:\s*item\.title/, "搜索原标题必须独立保留");
assert.match(enrichRoute, /preservedSearchTitle/, "详情标题异常时必须恢复搜索原标题");
assert.match(aiSelectionRoute, /inputHash/, "AI选款必须按输入哈希去重，禁止相同输入重复调用");
assert.match(aiSelectionRoute, /aiSelection:/, "AI选款结果必须逐Offer持久化");
assert.doesNotMatch(aiSelectionRoute, /selected\s*:/, "AI选款不得修改人工选中状态");
assert.doesNotMatch(aiSelectionRoute, /ai_rank/, "AI选款不得写入旧版自动排名状态");
assert.match(selectionCenter, /"AI选择货源"/, "现有货源页必须提供第一阶段AI货源选择按钮");
assert.match(selectionCenter, /"执行规则筛选"/, "现有货源页必须提供确定性规则筛选按钮");
assert.match(productRecognitionRoute, /sourceEvaluation/, "一次模型响应必须同时包含商品识别与货源评估");
assert.match(productRecognitionRoute, /aiSelection:/, "合并接口必须持久化货源评估结果");
assert.match(selectionCenter, /商品识别结果/, "AI判断页必须展示商品识别结果");
assert.match(selectionCenter, /识别到的商品组/, "AI判断页必须展示模型返回的全部商品组");
assert.match(selectionCenter, /productRecognition\?\.productName/, "列表必须优先显示多模态规范商品名");
assert.match(selectionCenter, /productRecognition\?\.categoryChild/, "分类列必须优先显示多模态分类结果");
assert.match(selectionCenter, /SKU混卖/, "多模态识别到SKU混卖时必须显示风险标识");
assert.match(selectionCenter, /\/api\/sourcing\/rule-selection/, "规则初筛按钮必须调用真实保存接口");
assert.match(selectionCenter, /function retryOfferDetail/, "详情失败的 Offer 必须支持单条重新获取");
assert.match(selectionCenter, /function detailCompletenessIssues/, "必须识别详情已返回但关键字段不完整的 Offer");
assert.match(selectionCenter, /解析失败/, "详情未获取或不完整行必须统一显示解析失败状态");
assert.match(selectionCenter, /重新解析/, "详情缺失或不完整行必须显示单条重试按钮");
assert.match(selectionCenter, /重新解析缺失项/, "结果页顶部必须提供数据缺失项批量重新解析按钮");
assert.match(selectionCenter, /const detailParseFailed\s*=\s*\(offer:\s*Offer\)\s*=>\s*detailCompletenessIssues\(offer\)\.length\s*>\s*0/, "详情未获取或解析不完整必须统一定义为解析失败");
assert.match(selectionCenter, /failedOffers\s*=\s*offers\.filter\(reparseRequired\)/, "批量重新解析必须覆盖关键规则数据缺失货源");
assert.doesNotMatch(selectionCenter, /`待补数据 \(/, "关键数据缺失不得保留待补数据页签");
assert.match(selectionCenter, /offers:\s*\[\{/, "单条重试不得重新采集整批 Offer");
assert.match(selectionCenter, /detailIncomplete/, "单条重试按钮必须由详情完整性状态控制");
assert.match(source, /async function startDefaultPublish/, "扩展必须提供默认模板自动铺货流程");
assert.match(source, /clicked_immediate_publish/, "自动铺货必须先点击立即铺货");
assert.match(source, /checked_default_store/, "自动铺货必须勾选默认淘宝店铺");
assert.match(source, /confirmed_publish/, "自动铺货必须点击确定铺货");
assert.match(source, /立即铺货\(\?:（\(\?:单店\|多店\)）/, "确认店铺必须兼容‘立即铺货（单店/多店）’按钮");
assert.match(background, /立即铺货\(\?:（\(\?:单店\|多店\)）/, "后台兜底点击必须兼容‘立即铺货（单店/多店）’按钮");
assert.match(source, /START_DEFAULT_PUBLISH/, "详情页必须接收默认铺货指令");
assert.match(bridge, /AI_SHOP_PUBLISH_1688/, "本地应用必须能通过扩展桥发起铺货任务");
assert.match(background, /async function publishDefaultListing/, "后台必须编排完整铺货任务");
assert.match(background, /waitForTaobaoPublishResult/, "铺货完成后必须识别淘宝商品ID");
assert.match(background, /createdAfterSubmission/, "铺货结果只能来自本次操作后新建的标签页");
assert.match(background, /navigatedAfterSubmission/, "铺货结果可以来自本次操作后URL发生变化的标签页");
assert.doesNotMatch(background, /recentlyActivated/, "铺货结果禁止复用仅被激活的旧淘宝标签页");
assert.doesNotMatch(background, /aiPublishPage\s*=/, "铺货结果禁止因旧页面带fromAIPublish标记而直接成功");
assert.match(selectionCenter, /尚未运行本轮「AI评估货源」/, "AI评估Tab只能展示已保存结果或空状态");
assert.match(aiSelectionRoute, /offer-source-evaluation-v1/, "AI评估必须使用独立缓存版本");
assert.match(aiSelectionRoute, /function diversifyRecommendations/, "AI推荐必须经过确定性差异化复核，不能只依赖模型措辞");
assert.match(aiSelectionRoute, /kept\.size < 5/, "AI推荐位必须限制数量，避免同质商品占满结果");
assert.match(aiSelectionRoute, /directions\.has\(direction\)/, "同一功能结构方向只能保留一个AI推荐项");
assert.match(aiSelectionRoute, /qualityEligible/, "AI推荐必须先通过确定性质量门槛");
assert.doesNotMatch(ruleSelectionRoute, /offer_status|offer_reasons/, "规则初筛不得查询尚未迁移的source_products字段");
assert.match(productRecognitionRoute, /decision\s*===\s*"PASSED"/, "只有规则明确通过项才能进入AI识别与分类");
assert.match(selectionCenter, /recognitionCandidates\.length\s*>\s*0\s*&&\s*recognitionCandidates\.every/, "AI识别完成状态只能统计规则未淘汰项");
assert.match(ruleSelectionRoute, /status:\s*"CANDIDATE"/, "规则初筛只能保留为候选，规则淘汰由ruleSelection单独表达");
assert.doesNotMatch(ruleSelectionRoute, /decision === "PRIMARY" \|\| decision === "BACKUP"/, "规则初筛不得区分主货源和备用货源");
const sourcingDiscovery = readFileSync(new URL("../components/sourcing/sourcing-discovery.tsx", import.meta.url), "utf8");
assert.match(sourcingDiscovery, /filters:\s*searchOptions/, "搜索筛选参数必须完整传递给1688采集桥");
assert.match(sourcingDiscovery, /sourcing-search-condition-row/, "搜索区域必须使用1688风格条件分组");
assert.match(sourcingDiscovery, /所在地区<select/, "1688下拉筛选项不能降级为自由文本输入");
assert.match(sourcingDiscovery, /商家特色<select/, "商家特色必须使用下拉框");
assert.match(sourcingDiscovery, /armCaptureWatchdog/, "采集请求必须有可续期的阶段看门狗");
assert.match(sourcingDiscovery, /采集桥未响应。扩展更新后需要刷新/, "扩展更新导致旧页面失联时必须快速明确报错");
assert.match(sourcingDiscovery, /lastCaptureStageRef/, "采集超时必须显示最后收到的阶段心跳");
assert.match(sourcingDiscovery, /capture-progress-stage/, "采集过程中必须展示当前搜索或详情解析阶段");

console.log(`SourceSKU 解析规则回归通过（扩展 ${manifest.version}）`);
