const RESULT_ORIGIN = "http://localhost:3000";
const activePorts = new Map();

function postCapture(requestId, payload) {
  window.postMessage({ type: "AI_SHOP_CAPTURE_RESULT", requestId, extensionVersion: chrome.runtime?.getManifest?.().version, ...payload }, RESULT_ORIGIN);
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type === "AI_SHOP_CANCEL_CAPTURE") {
    const requestId = event.data.requestId;
    activePorts.get(requestId)?.disconnect();
    activePorts.delete(requestId);
    chrome.runtime?.sendMessage({ type: "CANCEL_CAPTURE", requestId });
    return;
  }
  if (!["AI_SHOP_CAPTURE_1688", "AI_SHOP_ENRICH_1688"].includes(event.data?.type)) return;
  const requestId = event.data.requestId;
  try {
    if (!chrome.runtime?.id) {
      postCapture(requestId, { error: "采集扩展已更新，请刷新 AI 店长页面后重试" });
      return;
    }
    const isDetail = event.data.type === "AI_SHOP_ENRICH_1688";
    const port = chrome.runtime.connect({ name: isDetail ? "DETAIL_ENRICHMENT" : "OFFER_CAPTURE" });
    let settled = false;
    activePorts.set(requestId, port);
    port.onMessage.addListener((response) => {
      if (response?.progress) {
        window.postMessage({ type: "AI_SHOP_CAPTURE_PROGRESS", requestId, ...response.progress }, RESULT_ORIGIN);
        return;
      }
      if (response?.checkpoint) {
        window.postMessage({ type: "AI_SHOP_CAPTURE_CHECKPOINT", requestId, ...response.checkpoint }, RESULT_ORIGIN);
        return;
      }
      settled = true;
      activePorts.delete(requestId);
      postCapture(requestId, response || { error: "采集扩展未返回结果" });
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      activePorts.delete(requestId);
      if (settled) return;
      settled = true;
      const runtimeError = chrome.runtime.lastError?.message;
      postCapture(requestId, { error: `${isDetail ? "详情" : "Offer"}采集连接意外中断${runtimeError ? `：${runtimeError}` : ""}` });
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
  } catch (error) {
    postCapture(requestId, { error: `采集扩展异常：${error instanceof Error ? error.message : String(error)}` });
  }
});
