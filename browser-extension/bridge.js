const RESULT_ORIGIN = "http://localhost:3000";
const activePorts = new Map();

function postResult(requestId, payload) {
  window.postMessage(
    {
      type: "AI_SHOP_CAPTURE_RESULT",
      requestId,
      extensionVersion: chrome.runtime?.getManifest?.().version,
      ...payload,
    },
    RESULT_ORIGIN,
  );
}

window.addEventListener("message", (event) => {
  if (
    event.source === window &&
    event.data?.type === "AI_SHOP_CANCEL_CAPTURE"
  ) {
    const requestId = event.data.requestId;
    activePorts.get(requestId)?.disconnect();
    activePorts.delete(requestId);
    chrome.runtime?.sendMessage({ type: "CANCEL_CAPTURE", requestId });
    return;
  }
  if (
    event.source !== window ||
    !["AI_SHOP_CAPTURE_1688", "AI_SHOP_ENRICH_1688", "AI_SHOP_PUBLISH_1688", "AI_SHOP_AUTOFILL_TAOBAO", "AI_SHOP_CAPTURE_TAOBAO_DRAFT"].includes(event.data?.type)
  ) {
    return;
  }

    const requestId = event.data.requestId;

  // Reloading an unpacked extension invalidates content scripts in pages that
  // were already open. Convert that state into a recoverable UI message.
  try {
    if (!chrome.runtime?.id) {
      postResult(requestId, {
        error: "扩展已更新，请刷新当前 AI 店长页面后重试",
      });
      return;
    }

    if (event.data.type === "AI_SHOP_PUBLISH_1688") {
      window.postMessage({ type: "AI_SHOP_PUBLISH_PROGRESS", requestId, stage: "bridge_ready", message: `铺货扩展 v${chrome.runtime.getManifest().version} 已就绪` }, RESULT_ORIGIN);
      let port;
      try {
        port = chrome.runtime.connect({ name: "LISTING_PUBLISH" });
      } catch (error) {
        window.postMessage({ type: "AI_SHOP_PUBLISH_RESULT", requestId, error: `无法连接铺货后台：${error instanceof Error ? error.message : String(error)}` }, RESULT_ORIGIN);
        return;
      }
      let settled = false;
      activePorts.set(requestId, port);
      window.postMessage({ type: "AI_SHOP_PUBLISH_PROGRESS", requestId, stage: "extension_connected", message: `铺货扩展 v${chrome.runtime.getManifest().version} 已连接后台` }, RESULT_ORIGIN);
      port.onMessage.addListener((response) => {
        if (response?.progress) {
          window.postMessage({ type: "AI_SHOP_PUBLISH_PROGRESS", requestId, ...response.progress }, RESULT_ORIGIN);
          return;
        }
        settled = true;
        activePorts.delete(requestId);
        window.postMessage({ type: "AI_SHOP_PUBLISH_RESULT", requestId, ...(response || { error: "铺货扩展未返回结果" }) }, RESULT_ORIGIN);
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        activePorts.delete(requestId);
        if (settled) return;
        settled = true;
        window.postMessage({ type: "AI_SHOP_PUBLISH_RESULT", requestId, error: "铺货连接意外中断，请刷新 AI 店长页面后重试" }, RESULT_ORIGIN);
      });
      port.postMessage({ type: "PUBLISH_1688", requestId, productId: event.data.productId, sourceUrl: event.data.sourceUrl });
      return;
    }

    if (event.data.type === "AI_SHOP_AUTOFILL_TAOBAO") {
      const port = chrome.runtime.connect({ name: "TAOBAO_AUTOFILL" });
      let settled = false;
      activePorts.set(requestId, port);
      port.onMessage.addListener((response) => {
        if (response?.progress) {
          window.postMessage({ type: "AI_SHOP_AUTOFILL_PROGRESS", requestId, ...response.progress }, RESULT_ORIGIN);
          return;
        }
        settled = true;
        activePorts.delete(requestId);
        window.postMessage({ type: "AI_SHOP_AUTOFILL_RESULT", requestId, ...(response || { error: "淘宝自动填写未返回结果" }) }, RESULT_ORIGIN);
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        activePorts.delete(requestId);
        if (settled) return;
        window.postMessage({ type: "AI_SHOP_AUTOFILL_RESULT", requestId, error: "淘宝自动填写连接意外中断" }, RESULT_ORIGIN);
      });
      port.postMessage({ type: "AUTOFILL_TAOBAO", requestId, itemId: event.data.itemId, materialMaster: event.data.materialMaster });
      return;
    }

    if (event.data.type === "AI_SHOP_CAPTURE_TAOBAO_DRAFT") {
      const port = chrome.runtime.connect({ name: "TAOBAO_DRAFT_CAPTURE" });
      let settled = false;
      activePorts.set(requestId, port);
      port.onMessage.addListener((response) => {
        if (response?.progress) { window.postMessage({ type: "AI_SHOP_TAOBAO_DRAFT_PROGRESS", requestId, ...response.progress }, RESULT_ORIGIN); return; }
        settled = true; activePorts.delete(requestId);
        window.postMessage({ type: "AI_SHOP_TAOBAO_DRAFT_RESULT", requestId, ...(response || { error: "淘宝草稿采集未返回结果" }) }, RESULT_ORIGIN);
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        activePorts.delete(requestId);
        if (!settled) window.postMessage({ type: "AI_SHOP_TAOBAO_DRAFT_RESULT", requestId, error: "淘宝草稿采集连接意外中断" }, RESULT_ORIGIN);
      });
      port.postMessage({ type: "CAPTURE_TAOBAO_DRAFT", requestId, itemId: event.data.itemId });
      return;
    }

    if (
      ["AI_SHOP_ENRICH_1688", "AI_SHOP_CAPTURE_1688"].includes(
        event.data.type,
      )
    ) {
      const isDetail = event.data.type === "AI_SHOP_ENRICH_1688";
      const port = chrome.runtime.connect({
        name: isDetail ? "DETAIL_ENRICHMENT" : "OFFER_CAPTURE",
      });
      let settled = false;
      activePorts.set(requestId, port);
      port.onMessage.addListener((response) => {
        if (response?.progress) {
          window.postMessage(
            {
              type: "AI_SHOP_CAPTURE_PROGRESS",
              requestId,
              ...response.progress,
            },
            RESULT_ORIGIN,
          );
          return;
        }
        settled = true;
        activePorts.delete(requestId);
        postResult(requestId, response || { error: "详情采集桥未返回结果" });
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        activePorts.delete(requestId);
        if (settled) return;
        settled = true;
        const runtimeError = chrome.runtime.lastError?.message;
        postResult(requestId, {
          error: `${isDetail ? "详情" : "Offer"}采集连接意外中断${runtimeError ? `：${runtimeError}` : "，请确认扩展仍在运行后重试"}`,
        });
      });
      port.postMessage({
        type: isDetail ? "ENRICH_1688" : "CAPTURE_1688",
        requestId,
        offers: event.data.offers,
        factsOnly: event.data.factsOnly === true,
        query: event.data.query,
        keywords: event.data.keywords,
        targetOfferCount: event.data.targetOfferCount,
        filters: event.data.filters,
        maxPages: event.data.maxPages,
      });
      return;
    }
  } catch (error) {
    if (event.data?.type === "AI_SHOP_PUBLISH_1688") {
      window.postMessage({ type: "AI_SHOP_PUBLISH_RESULT", requestId, error: `铺货扩展异常：${error instanceof Error ? error.message : "请刷新当前 AI 店长页面后重试"}` }, RESULT_ORIGIN);
    } else {
      postResult(requestId, { error: "扩展已更新，请刷新当前 AI 店长页面后重试" });
    }
  }
});
