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
    !["AI_SHOP_CAPTURE_1688", "AI_SHOP_ENRICH_1688"].includes(event.data?.type)
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
  } catch {
    postResult(requestId, {
      error: "扩展已更新，请刷新当前 AI 店长页面后重试",
    });
  }
});
