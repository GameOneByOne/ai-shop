"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LogResult = { error?: string; rows?: unknown[] };

export function DistributionLogSyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  async function sync() {
    if (running) return;
    setRunning(true);
    setMessage("正在读取 1688 官方铺货日志…");
    const requestId = crypto.randomUUID();
    const result = await new Promise<LogResult>((resolve) => {
      const timer = window.setTimeout(() => finish({ error: "扩展读取官方铺货日志超时" }), 45000);
      function finish(value: LogResult) { window.clearTimeout(timer); window.removeEventListener("message", receive); resolve(value); }
      function receive(event: MessageEvent) {
        if (event.origin !== location.origin || event.data?.requestId !== requestId || event.data?.type !== "AI_SHOP_DISTRIBUTION_LOG_RESULT") return;
        finish(event.data as LogResult);
      }
      window.addEventListener("message", receive);
      window.postMessage({ type: "AI_SHOP_SYNC_DISTRIBUTION_LOG", requestId }, location.origin);
    });
    try {
      if (result.error) throw new Error(result.error);
      const response = await fetch("/api/listing/distribution-log-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: result.rows ?? [] }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "同步失败");
      setMessage(`同步完成：仓库 ${body.warehoused}，失败 ${body.failed}，处理中 ${body.processing}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步失败");
    } finally { setRunning(false); }
  }

  return <div className="listing-publish-runner batch-publish-runner"><button className="v2-secondary" type="button" disabled={running} onClick={() => void sync()}>{running ? "同步中…" : "同步官方铺货日志"}</button>{message && <p className={message.includes("失败") && !message.includes("同步完成") ? "status-box error" : "status-box"}>{message}</p>}</div>;
}
