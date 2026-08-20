const RESULT_ORIGIN = "http://localhost:3000";

function postResult(requestId, payload) {
  window.postMessage(
    {
      type: "AI_SHOP_CAPTURE_RESULT",
      requestId,
      ...payload,
    },
    RESULT_ORIGIN,
  );
}

window.addEventListener("message", (event) => {
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

    if (event.data.type === "AI_SHOP_ENRICH_1688") {
      const port = chrome.runtime.connect({ name: "DETAIL_ENRICHMENT" });
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
        postResult(requestId, response || { error: "详情采集桥未返回结果" });
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError)
          postResult(requestId, { error: `详情采集连接中断：${runtimeError}` });
      });
      port.postMessage({
        type: "ENRICH_1688",
        offers: event.data.offers,
        factsOnly: event.data.factsOnly === true,
      });
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "CAPTURE_1688",
        query: event.data.query,
        keywords: event.data.keywords,
        maxPages: event.data.maxPages,
        offers: event.data.offers,
      },
      (response) => {
        try {
          const runtimeError = chrome.runtime.lastError?.message;
          if (runtimeError) {
            postResult(requestId, {
              error: runtimeError.includes("context invalidated")
                ? "扩展已更新，请刷新当前 AI 店长页面后重试"
                : runtimeError,
            });
            return;
          }

          postResult(
            requestId,
            response || { error: "采集扩展未响应，请刷新页面后重试" },
          );
        } catch {
          postResult(requestId, {
            error: "扩展已更新，请刷新当前 AI 店长页面后重试",
          });
        }
      },
    );
  } catch {
    postResult(requestId, {
      error: "扩展已更新，请刷新当前 AI 店长页面后重试",
    });
  }
});
