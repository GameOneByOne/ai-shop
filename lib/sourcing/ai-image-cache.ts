import sharp from "sharp";

export type AiImageCache = {
  sourceUrl: string;
  dataUrl: string;
  preparedAt: string;
};

export function readAiImageCache(value: unknown, sourceUrl: string | null): AiImageCache | null {
  if (!sourceUrl || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const cache = value as Record<string, unknown>;
  if (cache.sourceUrl !== sourceUrl || typeof cache.dataUrl !== "string" || !cache.dataUrl.startsWith("data:image/jpeg;base64,")) return null;
  return { sourceUrl, dataUrl: cache.dataUrl, preparedAt: String(cache.preparedAt ?? "") };
}

export async function downloadAiImage(sourceUrl: string): Promise<AiImageCache> {
  const url = new URL(sourceUrl);
  const trusted = url.protocol === "https:" && ["alicdn.com", "1688.com", "alibaba.com"].some((domain) =>
    url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (!trusted) throw new Error("主图地址不受信任");
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`主图下载失败（HTTP ${response.status}）`);
  const source = Buffer.from(await response.arrayBuffer());
  if (!source.length || source.length > 10 * 1024 * 1024) throw new Error("主图文件为空或超过10MB");
  const image = await sharp(source).rotate().resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 52 }).toBuffer();
  return { sourceUrl, dataUrl: `data:image/jpeg;base64,${image.toString("base64")}`, preparedAt: new Date().toISOString() };
}
