const RESULT_ORIGIN = "http://localhost:3000";
const activePorts = new Map();

function postPublish(type, requestId, payload) {
  window.postMessage({ type, requestId, extensionVersion: chrome.runtime?.getManifest?.().version, ...payload }, RESULT_ORIGIN);
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== "AI_SHOP_PUBLISH_1688") return;
  const requestId = event.data.requestId;
  try {
    if (!chrome.runtime?.id) {
      postPublish("AI_SHOP_PUBLISH_RESULT", requestId, { error: "铺货扩展已更新，请刷新 AI 店长页面后重试" });
      return;
    }
    postPublish("AI_SHOP_PUBLISH_PROGRESS", requestId, { stage: "bridge_ready", message: `铺货扩展 v${chrome.runtime.getManifest().version} 已就绪` });
    const port = chrome.runtime.connect({ name: "LISTING_PUBLISH" });
    let settled = false;
    activePorts.set(requestId, port);
    port.onMessage.addListener((response) => {
      if (response?.progress) {
        postPublish("AI_SHOP_PUBLISH_PROGRESS", requestId, response.progress);
        return;
      }
      settled = true;
      activePorts.delete(requestId);
      postPublish("AI_SHOP_PUBLISH_RESULT", requestId, response || { error: "铺货扩展未返回结果" });
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      activePorts.delete(requestId);
      if (settled) return;
      settled = true;
      postPublish("AI_SHOP_PUBLISH_RESULT", requestId, { error: "铺货连接意外中断，请刷新 AI 店长页面后重试" });
    });
    port.postMessage({ type: "PUBLISH_1688", requestId, productId: event.data.productId, sourceUrl: event.data.sourceUrl });
  } catch (error) {
    postPublish("AI_SHOP_PUBLISH_RESULT", requestId, { error: `铺货扩展异常：${error instanceof Error ? error.message : String(error)}` });
  }
});
