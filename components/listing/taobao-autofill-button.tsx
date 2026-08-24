"use client";

import { useEffect, useRef, useState } from "react";

type Enhancement = {
  editable?: { title?: string; guideTitle?: string; sellingPoints?: string[]; shortDescription?: string; detailSections?: Array<{ heading?: string; body?: string }> };
  audit?: Array<{ field?: string; status?: "PASS" | "WARN" | "BLOCK"; detail?: string }>;
  corrections?: Array<{ field?: string; current?: string; suggested?: string; evidence?: string }>;
  mediaPlan?: { missingAssets?: Array<{ type?: string; brief?: string }> };
  factGaps?: string[];
  skuUpdates?: Array<{ draftSkuIndex: number; draftSkuName: string; sourceSkuId: string; matchBasis: string; price: string; stock: number }>;
  readyForAutofill?: boolean;
};

export function TaobaoAutofillButton({ productId, itemId, initialEnhancement }: { productId: string; itemId: string; initialEnhancement?: Enhancement }) {
  const requestRef = useRef<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [enhancement, setEnhancement] = useState<Enhancement | null>(initialEnhancement ?? null);
  const [stage, setStage] = useState<"IDLE" | "CAPTURING" | "ENHANCING" | "READY" | "AUTOFILLING" | "VERIFIED">(initialEnhancement ? "READY" : "IDLE");
  const enhanceAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.requestId !== requestRef.current) return;
      if (["AI_SHOP_TAOBAO_DRAFT_PROGRESS", "AI_SHOP_AUTOFILL_PROGRESS"].includes(event.data?.type)) {
        setMessage(String(event.data.message || "正在处理淘宝商品…"));
        return;
      }
      if (event.data?.type === "AI_SHOP_TAOBAO_DRAFT_RESULT") {
        if (event.data.error) { requestRef.current = null; setRunning(false); setError(true); setMessage(`${String(event.data.error)}${event.data.extensionVersion ? `（扩展 v${event.data.extensionVersion}）` : ""}`); return; }
        setStage("ENHANCING");
        setMessage("已读取淘宝草稿，AI 正在一次完成质检和内容增强…");
        try {
          const controller = new AbortController(); enhanceAbortRef.current = controller;
          const response = await fetch("/api/listing/enhance-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, snapshot: event.data.snapshot }), signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "AI增强失败");
          setEnhancement(body.enhancement); setStage("READY"); setMessage("AI增强完成。请检查建议内容，再执行安全回填。"); setError(false);
        } catch (cause) { setStage("IDLE"); setError(true); setMessage(cause instanceof DOMException && cause.name === "AbortError" ? "已取消淘宝草稿质检。" : cause instanceof Error ? cause.message : "AI增强失败"); }
        finally { enhanceAbortRef.current = null; requestRef.current = null; setRunning(false); }
        return;
      }
      if (event.data?.type !== "AI_SHOP_AUTOFILL_RESULT") return;
      requestRef.current = null;
      setRunning(false);
      setError(Boolean(event.data.error));
      if (event.data.error) { setStage("READY"); setMessage(String(event.data.error)); return; }
      try {
        const response = await fetch("/api/listing/autofill-result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, itemId, fields: event.data.fields ?? {} }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "保存回填验证结果失败");
        setStage("VERIFIED"); setMessage("允许修改的文案字段已回填并通过回读验证；受控字段未改动。");
      } catch (cause) { setStage("READY"); setError(true); setMessage(cause instanceof Error ? cause.message : "保存回填验证结果失败"); }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [productId]);

  function captureAndEnhance() {
    if (running) return;
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    setRunning(true);
    setStage("CAPTURING");
    setError(false);
    setMessage("正在读取淘宝发布页已填写内容…");
    window.postMessage({ type: "AI_SHOP_CAPTURE_TAOBAO_DRAFT", requestId, itemId }, location.origin);
  }
  function autofill() {
    const editable = enhancement?.editable;
    if (running || !editable) return;
    const requestId = crypto.randomUUID(); requestRef.current = requestId; setRunning(true); setStage("AUTOFILLING"); setError(false); setMessage("正在安全回填标题和导购标题，并执行回读验证…");
    window.postMessage({ type: "AI_SHOP_AUTOFILL_TAOBAO", requestId, itemId, materialMaster: { ...editable, skuUpdates: enhancement?.skuUpdates ?? [] } }, location.origin);
  }
  function cancel() {
    enhanceAbortRef.current?.abort();
    if (requestRef.current) window.postMessage({ type: "AI_SHOP_CANCEL_CAPTURE", requestId: requestRef.current }, location.origin);
    requestRef.current = null; setRunning(false); setStage(enhancement ? "READY" : "IDLE"); setMessage("已取消当前操作。");
  }

  return <div className="listing-autofill-action">
    <div className="action-buttons"><button className="v2-primary" type="button" disabled={running} onClick={captureAndEnhance}>{running ? stage === "CAPTURING" ? "读取草稿中…" : stage === "ENHANCING" ? "AI质检中…" : "处理中…" : enhancement ? "重新读取并质检" : "读取淘宝草稿并AI优化"}</button>{enhancement?.editable && <button className="v2-secondary" type="button" disabled={running || enhancement.readyForAutofill === false} onClick={autofill}>{stage === "VERIFIED" ? "重新安全回填" : "安全回填优化内容"}</button>}{running && <button className="v2-secondary" type="button" onClick={cancel}>取消</button>}</div>
    {enhancement && <div className="candidate-facts"><div><span>质检项</span><b>{Array.isArray(enhancement.audit) ? enhancement.audit.length : 0} 项</b></div><div><span>锁定字段</span><b>类目 / SKU结构 / 物流</b></div><div><span>回填范围</span><b>标题 / 导购标题 / SKU价格与库存</b></div></div>}
    {enhancement?.editable && <div className="listing-enhancement-preview"><section><span>优化标题</span><b>{enhancement.editable.title}</b><small>{enhancement.editable.guideTitle || "无导购标题建议"}</small></section><section><span>内容建议</span><p>{enhancement.editable.shortDescription}</p><small>{enhancement.editable.sellingPoints?.join(" · ")}</small></section>{Boolean(enhancement.audit?.length) && <section><span>质检结果</span><ul>{enhancement.audit?.map((item, index) => <li key={`${item.field}-${index}`} className={String(item.status).toLowerCase()}><b>{item.status}</b> {item.field}：{item.detail}</li>)}</ul></section>}{Boolean(enhancement.factGaps?.length || enhancement.mediaPlan?.missingAssets?.length) && <section><span>待人工补充</span><ul>{enhancement.factGaps?.map((item) => <li key={item}>{item}</li>)}{enhancement.mediaPlan?.missingAssets?.map((item, index) => <li key={`${item.type}-${index}`}>{item.type}：{item.brief}</li>)}</ul></section>}</div>}
    {message && <p className={`status-box${error ? " error" : ""}`}>{message}</p>}
  </div>;
}
