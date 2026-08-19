const SEARCH_ORIGIN = "https://s.1688.com";
const SEARCH_PATH = "/selloffer/offer_search.htm";
let diagnosticStage = "初始化";
let diagnosticUrl = "未知";

async function markStage(tabId, stage) {
  diagnosticStage = stage;
  diagnosticUrl = (await chrome.tabs.get(tabId)).url || "未知";
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

      const clickable = [
        ...document.querySelectorAll(
          "button,a,input[type=submit],input[type=button],[role=button],div,span",
        ),
      ]
        .filter((element) => {
          const label = `${element.textContent || ""}${element.value || ""}`
            .replace(/\s+/g, "")
            .trim();
          return label === "搜索";
        })
        .find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 30 && rect.height > 20 && rect.top < 300;
        });
      if (clickable) clickable.click();
      else if (input.form) input.form.requestSubmit();
      else return { error: "未找到 1688 搜索按钮或搜索表单" };
      return { ok: true };
    },
  });
  const result = results?.[0]?.result;
  if (result?.error) throw new Error(result.error);
}

async function findOrSearch(query) {
  const tabs = await chrome.tabs.query({
    url: ["https://s.1688.com/selloffer/*"],
  });
  let tab =
    tabs
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

  tab = await chrome.tabs.get(tab.id);
  if (!tab.url?.startsWith(`${SEARCH_ORIGIN}${SEARCH_PATH}`)) {
    throw new Error(`1688 搜索页发生跳转（${new URL(tab.url || SEARCH_ORIGIN).hostname}），请在该标签页完成验证后重试`);
  }

  if ((await readPageKeyword(tab.id)) === query) return tab;

  await submitNativeSearch(tab.id, query);
  // 1688 may use either a navigation or an in-page update. Give its own
  // search submission time to render, without issuing another request.
  await new Promise((resolve) => setTimeout(resolve, 6000));
  return tab;
}

async function extract(tabId) {
  await markStage(tabId, "提取商品卡片");
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
          /(?:beginAmount|minOrderQuantity|quantityBegin|beginQuantity|起批量)[^\d]{0,40}(\d+)/i.exec(markup)?.[1];
        const supplier = /([^\s]{2,50}(?:有限公司|公司|工厂|厂|商行|经营部))/.exec(text)?.[1];
        const image = card?.querySelector("img")?.currentSrc || card?.querySelector("img")?.src;
        const sales = /(?:月销|已售|成交|销量)?\s*\d+(?:\.\d+)?\s*万?\s*\+?\s*件/.exec(text)?.[0];
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

async function nextPage(tabId) {
  await markStage(tabId, "进入下一页");
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const candidates = [
        ...document.querySelectorAll("a,button,li,[role=button]"),
      ];
      const next = candidates.find((element) => {
        const label = `${element.textContent || ""} ${element.getAttribute("title") || ""} ${element.getAttribute("aria-label") || ""}`.trim();
        const rect = element.getBoundingClientRect();
        return rect.width > 10 && rect.height > 10 && rect.top > innerHeight * 0.45 && (/下一页|next/i.test(label) || label === ">");
      });
      if (!next || next.getAttribute("aria-disabled") === "true" || next.className?.toString().includes("disabled")) return false;
      next.click();
      return true;
    },
  });
  return Boolean(results?.[0]?.result);
}

async function collectCategory(keywords, maxPages) {
  const unique = new Map();
  const knownTypes = new Set();
  const pageStats = [];
  let pagesFetched = 0;
  for (const keyword of keywords) {
    const tab = await findOrSearch(keyword);
    for (let page = 1; page <= maxPages; page += 1) {
      const items = await extract(tab.id);
      const before = unique.size;
      const typesBefore = knownTypes.size;
      for (const item of items) {
        unique.set(item.externalId || item.sourceUrl, {
          ...item,
          rawData: { ...(item.rawData || {}), keyword, page },
        });
        knownTypes.add(productType(item.title));
      }
      pagesFetched += 1;
      const newUnique = unique.size - before;
      const newTypes = knownTypes.size - typesBefore;
      const gainRate = items.length ? newUnique / items.length : 0;
      pageStats.push({ keyword, page, found: items.length, newUnique, newTypes, gainRate });
      if (page >= maxPages || (page > 1 && (gainRate < 0.15 || newTypes === 0))) break;
      if (!(await nextPage(tab.id))) break;
      await new Promise((resolve) => setTimeout(resolve, 5500));
    }
    await new Promise((resolve) => setTimeout(resolve, 3500));
  }
  return { items: [...unique.values()], collection: { pagesFetched, pageStats, uniqueCount: unique.size, typeCount: knownTypes.size } };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CAPTURE_1688") return;
  const keywords = [...new Set((Array.isArray(message.keywords) ? message.keywords : [message.query]).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 5);
  const maxPages = Math.max(1, Math.min(3, Number(message.maxPages) || 3));
  if (!keywords.length) {
    sendResponse({ error: "请至少输入一个搜索关键词" });
    return;
  }

  void collectCategory(keywords, maxPages)
    .then(({ items, collection }) =>
      sendResponse(
        items.length
          ? { items, collection }
          : { error: "搜索结果已加载，但尚未识别到商品，请向下滚动一次后重试" },
      ),
    )
    .catch((error) =>
      sendResponse({
        error: `${diagnosticStage}失败：${error.message || "采集失败"}；页面 ${diagnosticUrl}（扩展 v${chrome.runtime.getManifest().version}）`,
      }),
    );
  return true;
});
