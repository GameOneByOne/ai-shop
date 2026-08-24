"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type BatchProduct = { id: string; name: string };
type PublishResult = { error?: string; taobaoItemId?: string; taobaoItemUrl?: string };

function runExtension(productId: string, sourceUrl: string, onProgress: (message: string) => void) {
  return new Promise<PublishResult>((resolve) => {
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => finish({ error: "自动铺货超过 3 分钟仍未完成" }), 180000);
    function finish(result: PublishResult) {
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
      resolve(result);
    }
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.data?.requestId !== requestId) return;
      if (event.data?.type === "AI_SHOP_PUBLISH_PROGRESS") {
        onProgress(String(event.data.message || "正在执行默认模板铺货…"));
        return;
      }
      if (event.data?.type === "AI_SHOP_PUBLISH_RESULT") finish(event.data as PublishResult);
    }
    window.addEventListener("message", receive);
    window.postMessage({ type: "AI_SHOP_PUBLISH_1688", requestId, productId, sourceUrl }, location.origin);
  });
}

export function BatchPublishButton({ products }: { products: BatchProduct[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  async function startBatch() {
    if (running || !products.length) return;
    setRunning(true);
    let succeeded = 0;
    const failures: string[] = [];
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      setMessage(`正在铺货 ${index + 1}/${products.length}：${product.name}`);
      try {
        const startResponse = await fetch("/api/listing/default-publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, action: "START" }),
        });
        const startBody = await startResponse.json();
        if (!startResponse.ok) throw new Error(startBody.error || "无法开始铺货任务");
        const result = await runExtension(product.id, startBody.sourceUrl, (progress) => {
          setMessage(`${index + 1}/${products.length} · ${product.name}：${progress}`);
        });
        if (result.error) throw new Error(result.error);
        const completeResponse = await fetch("/api/listing/default-publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, action: "COMPLETE", taobaoItemId: result.taobaoItemId, taobaoItemUrl: result.taobaoItemUrl }),
        });
        const completeBody = await completeResponse.json();
        if (!completeResponse.ok) throw new Error(completeBody.error || "同步铺货结果失败");
        succeeded += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "铺货失败";
        failures.push(`${product.name}：${errorMessage}`);
        await fetch("/api/listing/default-publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, action: "FAIL", error: errorMessage }) }).catch(() => undefined);
      }
    }
    setRunning(false);
    setMessage(failures.length
      ? `批量铺货完成：成功 ${succeeded} 个，失败 ${failures.length} 个。${failures.join("；")}`
      : `批量铺货完成：${succeeded} 个商品全部成功。`);
    router.refresh();
  }

  return <div className="listing-publish-runner batch-publish-runner">
    <button className="v2-primary" type="button" disabled={running || !products.length} onClick={() => void startBatch()}>
      {running ? "批量铺货中…" : `批量铺货（${products.length}）`}
    </button>
    {message && <p className={message.includes("失败") ? "status-box error" : "status-box"}>{message}</p>}
  </div>;
}
