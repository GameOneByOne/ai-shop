const SEARCH_ORIGIN = "https://s.1688.com";
const SEARCH_PATH = "/selloffer/offer_search.htm";
let diagnosticStage = "初始化";
let diagnosticUrl = "未知";
const cancelledRequests = new Set();
const detailProgressByTab = new Map();

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "DETAIL_REVIEW_STATUS" || sender.tab?.id == null) return;
  detailProgressByTab.get(sender.tab.id)?.(message.status);
});

function withTimeout(promise, timeout, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function readableError(value, fallback = "未知错误") {
  if (typeof value === "string" && value.trim() && value.trim() !== "[object Object]") return value;
  if (value && typeof value === "object") {
    if (typeof value.message === "string" && value.message.trim())
      return value.message;
    if (value.message && value.message !== value)
      return readableError(value.message, fallback);
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {}
  }
  return fallback;
}

async function assertHostAccess(url) {
  const origin = `${new URL(url).origin}/*`;
  const allowed = await chrome.permissions.contains({ origins: [origin] });
  if (!allowed)
    throw new Error(
      `采集桥尚未获准访问 ${new URL(url).hostname}；请在扩展详情的“网站访问权限”中选择“在所有网站上”`,
    );
}

async function markStage(tabId, stage) {
  diagnosticStage = stage;
  diagnosticUrl = (await chrome.tabs.get(tabId)).url || "未知";
}

async function assertSearchPage(tabId) {
  const tab = await chrome.tabs.get(tabId),
    url = tab.url || "";
  if (/sale\.1688\.com\/.*punish|punish/i.test(url)) {
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId != null)
      await chrome.windows
        .update(tab.windowId, { focused: true })
        .catch(() => {});
    throw new Error(
      "1688 触发了安全验证。请在已打开的1688标签页完成验证，然后返回重新运行粗筛",
    );
  }
  if (!url.startsWith(`${SEARCH_ORIGIN}${SEARCH_PATH}`))
    throw new Error(
      `1688 搜索页发生跳转（${new URL(url || SEARCH_ORIGIN).hostname}），请在该标签页处理后重试`,
    );
  return tab;
}

async function pageCommand(tabId, message, timeout = 30000) {
  try {
    return await withTimeout(
      chrome.tabs.sendMessage(tabId, message),
      timeout,
      `1688 页面执行“${message?.type || "未知指令"}”超时，请刷新该页面后重试`,
    );
  } catch (error) {
    if (
      !String(error?.message || error).includes("Receiving end does not exist")
    )
      throw error;
    await chrome.tabs.reload(tabId);
    await waitForTab(tabId, 20000);
    return withTimeout(
      chrome.tabs.sendMessage(tabId, message),
      timeout,
      `1688 页面重新加载后仍未响应“${message?.type || "未知指令"}”`,
    );
  }
}

async function waitForTab(tabId, timeout = 15000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    return;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("1688 搜索页加载超时，请稍后重试"));
    }, timeout);
    const listener = (updatedId, info) => {
      if (updatedId !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 1800);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function readPageKeyword(tabId) {
  await markStage(tabId, "读取搜索框");
  const messageResult = await pageCommand(tabId, { type: "READ_KEYWORD" });
  if (messageResult?.error) throw new Error(readableError(messageResult.error, "读取搜索框失败"));
  return messageResult?.keyword || "";
  /* legacy dynamic-injection fallback retained for audit */
  const tab = await chrome.tabs.get(tabId);
  await assertHostAccess(tab.url || SEARCH_ORIGIN);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const candidates = [...document.querySelectorAll("input")].filter(
        (input) => {
          const rect = input.getBoundingClientRect();
          return rect.width > 250 && rect.height > 20 && rect.top < 300;
        },
      );
      return candidates[0]?.value?.trim() || "";
    },
  });
  return results?.[0]?.result || "";
}

async function submitNativeSearch(tabId, query) {
  await markStage(tabId, "提交原生搜索");
  const messageResult = await pageCommand(tabId, {
    type: "SUBMIT_SEARCH",
    query,
  });
  if (messageResult?.error) throw new Error(readableError(messageResult.error, "提交搜索失败"));
  return;
  /* legacy dynamic-injection fallback retained for audit */
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [query],
    func: (keyword) => {
      const inputs = [...document.querySelectorAll("input")].filter((input) => {
        const rect = input.getBoundingClientRect();
        return rect.width > 250 && rect.height > 20 && rect.top < 300;
      });
      const input = inputs[0];
      if (!input) return { error: "未找到 1688 搜索框" };

      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, keyword);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const candidates = [
        ...document.querySelectorAll(
          "button,input[type=submit],input[type=button],a,[role=button]",
        ),
      ]
        .filter((element) => {
          const label = `${element.textContent || ""}${element.value || ""}`
            .replace(/\s+/g, "")
            .trim();
          return label === "搜索";
        })
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 30 && rect.height > 20 && rect.top < 300;
        });
      const clickable =
        candidates.find((element) => element.tagName === "BUTTON") ||
        candidates[0];
      if (clickable) {
        clickable.focus();
        clickable.click();
      } else if (input.form) input.form.requestSubmit();
      else return { error: "未找到 1688 搜索按钮或搜索表单" };
      return { ok: true, method: clickable ? "button" : "form" };
    },
  });
  const result = results?.[0]?.result;
  if (result?.error) throw new Error(result.error);
}

async function findOrSearch(query) {
  const tabs = await chrome.tabs.query({
    url: ["https://s.1688.com/selloffer/*"],
  });
  let tab = tabs
    .filter((item) => item.url?.includes("offer_search"))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

  if (!tab?.id) {
    tab = await chrome.tabs.create({
      // An empty search URL redirects to the 1688 homepage, where this
      // extension intentionally has no injection permission. An ASCII seed
      // keeps the tab on s.1688.com until the native form submits Chinese.
      url: `${SEARCH_ORIGIN}${SEARCH_PATH}?keywords=pet`,
      active: false,
    });
    await waitForTab(tab.id);
  }

  tab = await assertSearchPage(tab.id);

  if ((await readPageKeyword(tab.id)) === query) return tab;

  await submitNativeSearch(tab.id, query);
  // 1688 may use either a navigation or an in-page update. Give its own
  // search submission time to render, without issuing another request.
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await assertSearchPage(tab.id);
  const currentKeyword = await readPageKeyword(tab.id);
  if (currentKeyword !== query) {
    throw new Error(`搜索词未提交成功（页面仍为“${currentKeyword || "空"}”）`);
  }
  const items = await extract(tab.id);
  const compact = query.replace(/\s+/g, "");
  const terms = Array.from(
    { length: Math.max(1, compact.length - 1) },
    (_, index) => compact.slice(index, index + 2),
  );
  if (!items.some((item) => terms.some((term) => item.title.includes(term)))) {
    throw new Error(
      "搜索框已更新，但商品列表仍是旧结果；请等待 1688 页面加载后重试",
    );
  }
  return tab;
}

async function extract(tabId, targetCount = 30) {
  await markStage(tabId, "提取商品卡片");
  // Search hydration intentionally waits through multiple lazy-load rounds.
  // It must not inherit the generic 30s command timeout.
  const messageResult = await pageCommand(tabId, { type: "EXTRACT_SEARCH", targetCount }, 70000);
  if (messageResult?.error) throw new Error(readableError(messageResult.error, "提取商品卡片失败"));
  return messageResult?.items || [];
  /* legacy dynamic-injection fallback retained for audit */
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const seen = new Set();
      const items = [];
      const add = (id, title, text = "", card) => {
        if (!id || seen.has(id) || items.length >= 30) return;
        const clean = (title || "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300);
        if (clean.length < 2) return;
        const priceRaw = /[¥￥]\s*(\d+(?:\s*\.\s*\d+)?)/.exec(text)?.[1];
        const price = priceRaw?.replace(/\s+/g, "");
        const markup = card?.outerHTML || "";
        const moq =
          /(\d+)\s*(?:件|个|只|套)\s*起/.exec(text)?.[1] ||
          /(?:beginAmount|minOrderQuantity|quantityBegin|beginQuantity|起批量)[^\d]{0,40}(\d+)/i.exec(
            markup,
          )?.[1];
        const supplier =
          /([^\s]{2,50}(?:有限公司|公司|工厂|厂|商行|经营部))/.exec(text)?.[1];
        const image =
          card?.querySelector("img")?.currentSrc ||
          card?.querySelector("img")?.src;
        const sales =
          /(?:月销|已售|成交|销量)?\s*\d+(?:\.\d+)?\s*万?\s*\+?\s*件/.exec(
            text,
          )?.[0];
        seen.add(id);
        items.push({
          externalId: id,
          title: clean,
          sourceUrl: `https://detail.1688.com/offer/${id}.html`,
          priceMin: price ? Number(price) : undefined,
          minimumOrderQuantity: moq ? Number(moq) : undefined,
          supplierName: supplier,
          imageUrl: image,
          salesHint: sales,
          rawData: { cardText: text },
        });
      };

      for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.href || anchor.getAttribute("href") || "";
        const id = /(?:offer\/|offerId[=/])(\d{8,})/i.exec(href)?.[1];
        if (!id) continue;
        const card =
          anchor.closest(
            "[class*=offer],[class*=card],[class*=item],[data-offer-id]",
          ) || anchor.parentElement;
        const text = (card?.innerText || anchor.innerText || "")
          .replace(/\s+/g, " ")
          .trim();
        add(
          id,
          anchor.getAttribute("title") ||
            anchor.innerText ||
            text.split(/[¥￥]/)[0],
          text,
          card,
        );
      }
      return items;
    },
  });
  return results?.[0]?.result || [];
}

function productType(title) {
  if (/滚筒|滚轮|粘毛滚/.test(title)) return "滚筒粘毛器";
  if (/水洗|可洗/.test(title)) return "可水洗除毛器";
  if (/刮毛|刮板|刮刀/.test(title)) return "沙发刮毛器";
  if (/猫梳|梳毛|脱毛梳|针梳/.test(title)) return "猫咪梳毛器";
  if (/静电|双面.*刷|除毛刷|粘毛刷/.test(title)) return "双面静电刷";
  return title.replace(/[\s\d¥￥.+%-]/g, "").slice(0, 12) || "其他";
}

async function nextPage(tabId, previousOfferIds = []) {
  await markStage(tabId, "进入下一页");
  const messageResult = await pageCommand(tabId, { type: "NEXT_PAGE" });
  if (messageResult?.error) throw new Error(readableError(messageResult.error, "翻页失败"));
  if (!messageResult?.moved) return false;
  await new Promise((resolve) => setTimeout(resolve, 5500));
  await assertSearchPage(tabId);
  const nextItems = await extract(tabId, 3), before = new Set(previousOfferIds.map(String));
  if (!nextItems.some((item) => !before.has(String(item.externalId || item.sourceUrl))))
    throw new Error("点击下一页后商品列表没有变化，已停止采集以避免重复或误采");
  return true;
  /* legacy dynamic-injection fallback retained for audit */
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const candidates = [
        ...document.querySelectorAll("a,button,li,[role=button]"),
      ];
      const next = candidates.find((element) => {
        const label =
          `${element.textContent || ""} ${element.getAttribute("title") || ""} ${element.getAttribute("aria-label") || ""}`.trim();
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 10 &&
          rect.height > 10 &&
          rect.top > innerHeight * 0.45 &&
          (/下一页|next/i.test(label) || label === ">")
        );
      });
      if (
        !next ||
        next.getAttribute("aria-disabled") === "true" ||
        next.className?.toString().includes("disabled")
      )
        return false;
      next.click();
      return true;
    },
  });
  return Boolean(results?.[0]?.result);
}

async function applySearchFilters(tabId, filters) {
  if (!hasEffectiveSearchFilters(filters)) return { skipped: true, changed: [] };
  await markStage(tabId, "应用搜索筛选");
  const result = await pageCommand(tabId, { type: "APPLY_FILTERS", filters });
  if (result?.error) throw new Error(readableError(result.error, "应用1688筛选失败"));
  if (result?.missing?.length)
    throw new Error(`1688 页面未找到已选筛选项：${result.missing.join("、")}`);
  if (result?.changed?.length) await new Promise((resolve) => setTimeout(resolve, 2500));
  return result;
}

function hasEffectiveSearchFilters(filters) {
  if (!filters || typeof filters !== "object") return false;
  return Boolean(
    (filters.sort && filters.sort !== "综合") ||
      filters.priceMin || filters.priceMax || filters.minOrder ||
      filters.shopProductMin || filters.shopProductMax || filters.region ||
      filters.merchantFeature || filters.businessMode ||
      filters.encryptedWaybill || filters.latePickupCompensation ||
      filters.pickup24Rate || filters.pickup48Rate || filters.mergeSuppliers ||
      (Array.isArray(filters.flags) && filters.flags.length),
  );
}

async function collectCategory(
  keywords,
  maxPages,
  targetOfferCount,
  filters,
  requestId,
  onProgress = () => {},
) {
  const unique = new Map();
  const knownTypes = new Set();
  const pageStats = [];
  let pagesFetched = 0;
  searchKeywords: for (const keyword of keywords) {
    if (cancelledRequests.has(requestId)) throw new Error("搜索已取消");
    onProgress({ phase: "search", status: "opening_search", message: `正在打开“${keyword}”搜索结果`, completed: unique.size, total: targetOfferCount, succeeded: unique.size, failed: 0 });
    const tab = await findOrSearch(keyword);
    if (hasEffectiveSearchFilters(filters)) {
      onProgress({ phase: "search", status: "applying_filters", message: `正在应用“${keyword}”的筛选条件`, completed: unique.size, total: targetOfferCount, succeeded: unique.size, failed: 0 });
      await applySearchFilters(tab.id, filters);
    } else {
      onProgress({ phase: "search", status: "filters_skipped", message: "未设置实际筛选条件，已跳过筛选操作", completed: unique.size, total: targetOfferCount, succeeded: unique.size, failed: 0 });
    }
    for (let page = 1; page <= maxPages; page += 1) {
      if (cancelledRequests.has(requestId)) throw new Error("搜索已取消");
      onProgress({ phase: "search", status: "parsing_results", message: `正在解析“${keyword}”第 ${page} 页商品卡片`, completed: unique.size, total: targetOfferCount, succeeded: unique.size, failed: 0, keyword, page });
      const items = await extract(tab.id, Math.max(1, targetOfferCount - unique.size));
      const before = unique.size;
      const typesBefore = knownTypes.size;
      for (const item of items) {
        const itemKey = item.externalId || item.sourceUrl;
        if (!unique.has(itemKey) && unique.size >= targetOfferCount) continue;
        unique.set(itemKey, {
          ...item,
          rawData: { ...(item.rawData || {}), keyword, page },
        });
        knownTypes.add(productType(item.title));
      }
      pagesFetched += 1;
      const newUnique = unique.size - before;
      const newTypes = knownTypes.size - typesBefore;
      const gainRate = items.length ? newUnique / items.length : 0;
      pageStats.push({
        keyword,
        page,
        found: items.length,
        newUnique,
        newTypes,
        gainRate,
      });
      onProgress({
        phase: "search",
        status: "page_parsed",
        message: `“${keyword}”第 ${page} 页解析完成，新增 ${newUnique} 条 Offer`,
        completed: unique.size,
        total: targetOfferCount,
        succeeded: unique.size,
        failed: 0,
        keyword,
        page,
      });
      if (unique.size >= targetOfferCount) break searchKeywords;
      if (page >= maxPages) break;
      if (!(await nextPage(tab.id, items.map((item) => item.externalId || item.sourceUrl)))) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3500));
  }
  if (unique.size < targetOfferCount)
    onProgress({
      phase: "search",
      status: "target_shortfall",
      message: `已搜索全部关键词和可用分页，目标 ${targetOfferCount} 个，实际找到 ${unique.size} 个去重 Offer`,
      completed: unique.size,
      total: targetOfferCount,
      succeeded: unique.size,
      failed: 0,
    });
  return {
    items: [...unique.values()],
    collection: {
      pagesFetched,
      pageStats,
      uniqueCount: unique.size,
      targetOfferCount,
      targetReached: unique.size >= targetOfferCount,
      shortfall: Math.max(0, targetOfferCount - unique.size),
      typeCount: knownTypes.size,
      appliedFilters: filters || {},
    },
  };
}

function captureRequest(message, onProgress = () => {}) {
  const keywords = [
    ...new Set(
      (Array.isArray(message.keywords) ? message.keywords : [message.query])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  const maxPages = Math.max(1, Math.min(30, Number(message.maxPages) || 30));
  const targetOfferCount = Math.max(
    1,
    Math.min(500, Number(message.targetOfferCount) || 20),
  );
  const filters =
    message.filters && typeof message.filters === "object"
      ? message.filters
      : null;
  if (!keywords.length) return Promise.reject(new Error("请至少输入一个搜索关键词"));
  return withTimeout(
    collectCategory(
      keywords,
      maxPages,
      targetOfferCount,
      filters,
      message.requestId,
      onProgress,
    ),
    480000,
    "1688 搜索与筛选超过8分钟未完成，请检查登录或安全验证",
  ).then(({ items, collection }) =>
    items.length && collection.targetReached
      ? { items, collection }
      : items.length
        ? { error: `目标 ${collection.targetOfferCount} 个，当前仅找到 ${collection.uniqueCount} 个去重 Offer；已搜索全部关键词及最多30页，必须足额后才会进入详情解析，请补充搜索关键词后重试`, collection }
        : { error: "搜索结果已加载，但尚未识别到商品，请向下滚动一次后重试" },
  );
}

async function extractOfferDetails(offer, factsOnly = false, onDetailProgress = () => {}) {
  const tab = await chrome.tabs.create({ url: offer.sourceUrl, active: false });
  detailProgressByTab.set(tab.id, onDetailProgress);
  if (!tab.id) throw new Error("无法打开 1688 商品详情页");
  try {
    await waitForTab(tab.id, 20000);
    const messageResult = await withTimeout(
      pageCommand(tab.id, {
        type: "EXTRACT_DETAILS",
        offer,
        factsOnly,
      }, 90000),
      105000,
      `Offer ${offer.externalId || offer.id || "未知"} 详情解析超时`,
    );
    if (messageResult?.error) throw new Error(messageResult.error);
    return messageResult?.detail;
    /* legacy dynamic-injection fallback retained for audit */
    await markStage(tab.id, `解析详情 ${offer.externalId}`);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [offer],
      func: async (source) => {
        const clean = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const bodyText = clean(document.body.innerText);
        const capabilities = {
          dropshipping: /一件代发|代发下单/.test(bodyText),
          encryptedDropshipping: /密文代发/.test(bodyText),
          returnShipping: /退货包运费/.test(bodyText),
        };
        const shippingText = /运费\s*[¥￥]\s*(\d+(?:\.\d+)?)\s*起?/.exec(
          bodyText,
        )?.[1];
        const pricingContext = {
          shippingFee: null,
          shippingQuote: shippingText ? Number(shippingText) : null,
          promotionDiscount: null,
          promotionText: /新人价|店铺优惠|券后价/.test(bodyText)
            ? "页面存在活动优惠，需在结算页核实"
            : null,
          shippingScope: shippingText
            ? "OFFER_QUOTE_ADDRESS_DEPENDENT"
            : "UNKNOWN",
        };
        const attributeNoise =
          /(?:产品类别|产品类目|品牌|材质|产地|货号|适用对象|是否进口|箱装数量|主要下游平台|主要销售地区)/;
        const candidates = [
          ...document.querySelectorAll(
            "button,[role=button],[class*=sku] [class*=item],[class*=spec] [class*=item]",
          ),
        ].filter((node) => {
          const text = clean(node.textContent);
          const rect = node.getBoundingClientRect();
          const insideSku = Boolean(node.closest("[class*=sku],[class*=spec]"));
          return (
            insideSku &&
            !attributeNoise.test(text) &&
            text.length >= 2 &&
            text.length <= 80 &&
            rect.width > 25 &&
            rect.height > 18 &&
            /(通道|隧道|彩色|彩虹|小号|中号|大号|T型|S型|Y型|字型|直通|直筒|三通)/i.test(
              text,
            )
          );
        });
        const unique = [
          ...new Map(
            candidates.map((node) => [
              clean(node.textContent)
                .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, "")
                .replace(/库存\s*\d+\s*个?/g, "")
                .trim(),
              node,
            ]),
          ).entries(),
        ]
          .filter(([text]) => text.length > 1)
          .slice(0, 30);
        const variants = [];
        for (let index = 0; index < unique.length; index += 1) {
          const [variantName, node] = unique[index];
          try {
            node.click();
            await new Promise((resolve) => setTimeout(resolve, 250));
          } catch {}
          const current = clean(document.body.innerText);
          const priceText =
            /(?:规格|包装)[\s\S]{0,140}?[¥￥]\s*(\d+(?:\.\d+)?)/.exec(
              current,
            )?.[1];
          const stockText = /(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(current)?.[1];
          const moqText = /(\d+)\s*(?:个|件|套|只)\s*起批/.exec(current)?.[1];
          const image =
            node.querySelector?.("img")?.currentSrc ||
            node.querySelector?.("img")?.src ||
            null;
          variants.push({
            sourceVariantId: `${source.externalId}:${index + 1}`,
            variantName,
            specValues: [variantName],
            price: priceText ? Number(priceText) : null,
            stock: stockText ? Number(stockText) : null,
            image,
            minOrderQuantity: moqText ? Number(moqText) : null,
            priceSource: priceText ? "SELECTED_VARIANT_SPEC_AREA" : "UNKNOWN",
          });
        }
        if (!variants.length)
          variants.push({
            sourceVariantId: `${source.externalId}:unresolved`,
            variantName: "规格待登录后解析",
            specValues: [],
            price: null,
            stock: null,
            image: null,
            minOrderQuantity: null,
          });
        return {
          offerId: source.id,
          externalId: source.externalId,
          capabilities,
          pricingContext,
          variants,
          capturedAt: new Date().toISOString(),
        };
      },
    });
    return results?.[0]?.result;
  } finally {
    detailProgressByTab.delete(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function enrichOffers(offers, onProgress = () => {}, factsOnly = false, requestId) {
  const indexedDetails = [];
  const failures = [];
  const selected = offers.slice(0, 50);
  // 每个详情页仍独立执行完整懒加载；最多同时解析 2 条，避免完全串行。
  let cursor = 0, completed = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      if (cancelledRequests.has(requestId)) throw new Error("搜索已取消");
      const index = cursor++, offer = selected[index], label = offer?.externalId || offer?.id || index + 1;
      onProgress({ phase: "detail", status: "opening_detail", message: `正在打开 Offer ${label} 详情`, completed, total: selected.length, succeeded: indexedDetails.length, failed: failures.length });
      try {
        const detail = await extractOfferDetails(offer, factsOnly, (status) =>
          onProgress({ phase: "detail", status, message: `Offer ${label}：${status}`, completed, total: selected.length, succeeded: indexedDetails.length, failed: failures.length }),
        );
        if (!detail) throw new Error("详情页未返回解析结果");
        indexedDetails.push({ index, detail });
        completed += 1;
        onProgress({ phase: "detail", status: "detail_parsed", message: `Offer ${label} 详情解析完成`, completed, total: selected.length, succeeded: indexedDetails.length, failed: failures.length });
      } catch (error) {
        failures.push({ offerId: offer?.id, externalId: offer?.externalId, title: offer?.title, error: readableError(error, "详情解析失败") });
        completed += 1;
        onProgress({ phase: "detail", status: "detail_parsed", message: `Offer ${label} 解析失败，继续下一条`, completed, total: selected.length, succeeded: indexedDetails.length, failed: failures.length });
      }
      if (cursor < selected.length) await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, selected.length) }, () => worker()));
  const details = indexedDetails.sort((a, b) => a.index - b.index).map((item) => item.detail);
  if (!details.length)
    throw new Error(
      readableError(failures[0]?.error, "没有成功解析任何详情规格"),
    );
  return { details, failures };
}

chrome.runtime.onConnect.addListener((port) => {
  if (!["DETAIL_ENRICHMENT", "OFFER_CAPTURE"].includes(port.name)) return;
  port.onMessage.addListener((message) => {
    if (port.name === "OFFER_CAPTURE") {
      if (message?.type !== "CAPTURE_1688") return;
      void captureRequest(message, (progress) =>
        port.postMessage({ progress }),
      )
        .then((result) => port.postMessage(result))
        .catch((error) =>
          port.postMessage({
            error: `${diagnosticStage}失败：${readableError(error, "采集失败")}；页面 ${diagnosticUrl}（扩展 v${chrome.runtime.getManifest().version}）`,
          }),
        );
      return;
    }
    if (message?.type !== "ENRICH_1688") return;
    const offers = Array.isArray(message.offers) ? message.offers : [];
    if (!offers.length) {
      port.postMessage({ error: "没有可进行详情解析的 Offer" });
      return;
    }
    void enrichOffers(
      offers,
      (progress) => port.postMessage({ progress }),
      message.factsOnly === true,
      message.requestId,
    )
      .then((result) => port.postMessage(result))
      .catch((error) =>
        port.postMessage({
          error: `${diagnosticStage}失败：${readableError(error, "详情采集失败")}`,
        }),
      );
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CANCEL_CAPTURE") {
    if (message.requestId) cancelledRequests.add(message.requestId);
    sendResponse({ cancelled: true });
    return;
  }
  if (message?.type === "ENRICH_1688") {
    const offers = Array.isArray(message.offers) ? message.offers : [];
    if (!offers.length) {
      sendResponse({ error: "没有可进行详情解析的 Offer" });
      return;
    }
    void enrichOffers(offers, undefined, false, message.requestId)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          error: `${diagnosticStage}失败：${readableError(error, "详情采集失败")}`,
        }),
      );
    return true;
  }
  if (message?.type !== "CAPTURE_1688") return;
  void captureRequest(message)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        error: `${diagnosticStage}失败：${readableError(error, "采集失败")}；页面 ${diagnosticUrl}（扩展 v${chrome.runtime.getManifest().version}）`,
      }),
    );
  return true;
});
