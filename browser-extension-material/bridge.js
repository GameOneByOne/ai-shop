const RESULT_ORIGIN = "http://localhost:3000";
const activePorts = new Map();

function postMaterial(type, requestId, payload) {
  window.postMessage({ type, requestId, extensionVersion: chrome.runtime?.getManifest?.().version, ...payload }, RESULT_ORIGIN);
}

window.addEventListener("message", (event) => {
  if (event.source !== window || !["AI_SHOP_AUTOFILL_TAOBAO", "AI_SHOP_CAPTURE_TAOBAO_DRAFT"].includes(event.data?.type)) return;
  const requestId = event.data.requestId;
  const isDraft = event.data.type === "AI_SHOP_CAPTURE_TAOBAO_DRAFT";
  const resultType = isDraft ? "AI_SHOP_TAOBAO_DRAFT_RESULT" : "AI_SHOP_AUTOFILL_RESULT";
  const progressType = isDraft ? "AI_SHOP_TAOBAO_DRAFT_PROGRESS" : "AI_SHOP_AUTOFILL_PROGRESS";
  try {
    if (!chrome.runtime?.id) {
      postMaterial(resultType, requestId, { error: "商品素材管理扩展已更新，请刷新 AI 店长页面后重试" });
      return;
    }
    const port = chrome.runtime.connect({ name: isDraft ? "TAOBAO_DRAFT_CAPTURE" : "TAOBAO_AUTOFILL" });
    let settled = false;
    activePorts.set(requestId, port);
    port.onMessage.addListener((response) => {
      if (response?.progress) {
        postMaterial(progressType, requestId, response.progress);
        return;
      }
      settled = true;
      activePorts.delete(requestId);
      postMaterial(resultType, requestId, response || { error: isDraft ? "淘宝草稿采集未返回结果" : "淘宝自动填写未返回结果" });
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      activePorts.delete(requestId);
      if (settled) return;
      settled = true;
      postMaterial(resultType, requestId, { error: isDraft ? "淘宝草稿采集连接意外中断" : "淘宝自动填写连接意外中断" });
    });
    port.postMessage(isDraft
      ? { type: "CAPTURE_TAOBAO_DRAFT", requestId, itemId: event.data.itemId }
      : { type: "AUTOFILL_TAOBAO", requestId, itemId: event.data.itemId, materialMaster: event.data.materialMaster });
  } catch (error) {
    postMaterial(resultType, requestId, { error: `商品素材管理扩展异常：${error instanceof Error ? error.message : String(error)}` });
  }
});
