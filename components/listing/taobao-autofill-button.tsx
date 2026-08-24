"use client";

import { useEffect, useRef, useState } from "react";

type Enhancement = { editable?: Record<string, unknown>; audit?: unknown[]; readyForAutofill?: boolean };

export function TaobaoAutofillButton({ productId, itemId, initialEnhancement }: { productId: string; itemId: string; initialEnhancement?: Enhancement }) {
  const requestRef = useRef<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [enhancement, setEnhancement] = useState<Enhancement | null>(initialEnhancement ?? null);

  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.requestId !== requestRef.current) return;
      if (["AI_SHOP_TAOBAO_DRAFT_PROGRESS", "AI_SHOP_AUTOFILL_PROGRESS"].includes(event.data?.type)) {
        setMessage(String(event.data.message || "正在处理淘宝商品…"));
        return;
      }
      if (event.data?.type === "AI_SHOP_TAOBAO_DRAFT_RESULT") {
        if (event.data.error) { requestRef.current = null; setRunning(false); setError(true); setMessage(String(event.data.error)); return; }
        setMessage("已读取淘宝草稿，AI 正在一次完成质检和内容增强…");
        try {
          const response = await fetch("/api/listing/enhance-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, snapshot: event.data.snapshot }) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "AI增强失败");
          setEnhancement(body.enhancement); setMessage("AI增强完成。类目、SKU、价格、库存和物流保持锁定，可安全回填文案。"); setError(false);
        } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : "AI增强失败"); }
        finally { requestRef.current = null; setRunning(false); }
        return;
      }
      if (event.data?.type !== "AI_SHOP_AUTOFILL_RESULT") return;
      requestRef.current = null;
      setRunning(false);
      setError(Boolean(event.data.error));
      setMessage(event.data.error ? String(event.data.error) : "允许修改的文案字段已回填并通过回读验证；受控字段未改动。");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [productId]);

  function captureAndEnhance() {
    if (running) return;
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    setRunning(true);
    setError(false);
    setMessage("正在读取淘宝发布页已填写内容…");
    window.postMessage({ type: "AI_SHOP_CAPTURE_TAOBAO_DRAFT", requestId, itemId }, location.origin);
  }
  function autofill() {
    const editable = enhancement?.editable;
    if (running || !editable) return;
    const requestId = crypto.randomUUID(); requestRef.current = requestId; setRunning(true); setError(false); setMessage("正在安全回填标题、导购标题和内容文案…");
    window.postMessage({ type: "AI_SHOP_AUTOFILL_TAOBAO", requestId, itemId, materialMaster: editable }, location.origin);
  }

  return <div className="listing-autofill-action">
    <div className="action-buttons"><button className="v2-primary" type="button" disabled={running} onClick={captureAndEnhance}>{running ? "处理中…" : enhancement ? "重新读取并质检" : "读取淘宝草稿并AI优化"}</button>{enhancement?.editable && <button className="v2-secondary" type="button" disabled={running || enhancement.readyForAutofill === false} onClick={autofill}>安全回填优化内容</button>}</div>
    {enhancement && <div className="candidate-facts"><div><span>质检项</span><b>{Array.isArray(enhancement.audit) ? enhancement.audit.length : 0} 项</b></div><div><span>受控字段</span><b>类目 / SKU / 价格 / 库存 / 物流</b></div><div><span>回填范围</span><b>标题 / 导购标题 / 内容文案</b></div></div>}
    {message && <p className={`status-box${error ? " error" : ""}`}>{message}</p>}
  </div>;
}
