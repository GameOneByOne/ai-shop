"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PublishResult = { error?: string; taobaoItemId?: string; taobaoItemUrl?: string };

const progressByStage: Record<string, number> = {
  bridge_ready: 10,
  extension_connected: 18,
  opening_source: 30,
  clicking_publish: 48,
  checking_store: 64,
  submitted_publish: 78,
  waiting_result: 90,
};

export function DefaultPublishTask({ productId, started }: { productId: string; started: boolean }) {
  const router = useRouter();
  const requestRef = useRef<string | null>(null);
  const responseTimerRef = useRef<number | null>(null);
  const operationTimerRef = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(started ? "铺货任务可以继续执行。" : "");
  const [progress, setProgress] = useState(started ? 72 : 0);
  const [state, setState] = useState<"idle" | "running" | "success" | "error">(started ? "running" : "idle");

  function markFailed(error: string) {
    void fetch("/api/listing/default-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, action: "FAIL", error }),
    }).then(() => router.refresh()).catch(() => undefined);
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.data?.requestId !== requestRef.current) return;
      if (responseTimerRef.current != null) {
        window.clearTimeout(responseTimerRef.current);
        responseTimerRef.current = null;
      }
      if (event.data?.type === "AI_SHOP_PUBLISH_PROGRESS") {
        setState("running");
        setProgress(progressByStage[String(event.data.stage)] ?? 50);
        setMessage(String(event.data.message || "正在执行默认模板铺货…"));
        return;
      }
      if (event.data?.type !== "AI_SHOP_PUBLISH_RESULT") return;
      if (operationTimerRef.current != null) {
        window.clearTimeout(operationTimerRef.current);
        operationTimerRef.current = null;
      }
      const result = event.data as PublishResult;
      requestRef.current = null;
      if (result.error) {
        setRunning(false);
        setState("error");
        setMessage(result.error);
        markFailed(result.error);
        return;
      }
      void fetch("/api/listing/default-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, action: "COMPLETE", taobaoItemId: result.taobaoItemId, taobaoItemUrl: result.taobaoItemUrl }),
      }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "同步铺货结果失败");
        setRunning(false);
        setState("success");
        setProgress(100);
        setMessage("铺货成功，商品已存放到千牛仓库，并同步淘宝商品 ID。");
        router.refresh();
      }).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : "同步铺货结果失败";
        setRunning(false);
        setState("error");
        setMessage(errorMessage);
        markFailed(errorMessage);
      });
    }
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      if (responseTimerRef.current != null) window.clearTimeout(responseTimerRef.current);
      if (operationTimerRef.current != null) window.clearTimeout(operationTimerRef.current);
    };
  }, [productId, router]);

  async function start() {
    if (running) return;
    setRunning(true);
    setState("running");
    setProgress(5);
    setMessage("正在建立默认模板铺货任务…");
    try {
      const response = await fetch("/api/listing/default-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, action: "START" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "无法开始铺货任务");
      const requestId = crypto.randomUUID();
      requestRef.current = requestId;
      window.postMessage({ type: "AI_SHOP_PUBLISH_1688", requestId, productId, sourceUrl: body.sourceUrl }, location.origin);
      setMessage("正在打开 1688 货源并执行铺货…");
      responseTimerRef.current = window.setTimeout(() => {
        if (requestRef.current !== requestId) return;
        requestRef.current = null;
        responseTimerRef.current = null;
        if (operationTimerRef.current != null) {
          window.clearTimeout(operationTimerRef.current);
          operationTimerRef.current = null;
        }
        setRunning(false);
        setState("error");
        const errorMessage = "铺货扩展未响应。请在扩展管理页重载 AI 店长 1688 一键铺货，然后刷新本页重试。";
        setMessage(errorMessage);
        markFailed(errorMessage);
      }, 12000);
      operationTimerRef.current = window.setTimeout(() => {
        if (requestRef.current !== requestId) return;
        requestRef.current = null;
        operationTimerRef.current = null;
        setRunning(false);
        setState("error");
        const errorMessage = "自动铺货超过 3 分钟仍未完成。请检查 1688 页面是否出现登录、安全验证或铺货弹窗，然后重试。";
        setMessage(errorMessage);
        markFailed(errorMessage);
      }, 180000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "无法开始铺货任务";
      setRunning(false);
      setState("error");
      setMessage(errorMessage);
      markFailed(errorMessage);
    }
  }

  return <div className={`listing-publish-runner listing-runner-${state}`}>
    <div className="listing-runner-head"><div><span>自动铺货任务</span><b>{state === "success" ? "已完成" : state === "error" ? "需要处理" : running || started ? "执行中" : "等待开始"}</b></div><strong>{progress}%</strong></div>
    <div className="listing-progress" aria-label={`铺货进度 ${progress}%`}><i style={{ width: `${progress}%` }} /></div>
    {message && <p className="listing-runner-message">{message}</p>}
    <button className="v2-primary" type="button" disabled={running || state === "success"} onClick={() => void start()}>{running ? "自动铺货中…" : state === "error" ? "重新执行" : started ? "继续自动铺货" : "立即自动铺货"}</button>
  </div>;
}
