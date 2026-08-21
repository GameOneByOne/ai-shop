import sharp from "sharp";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  images: z
    .array(z.object({ id: z.string().min(1), url: z.string().url() }))
    .max(100),
});

function allowedImageUrl(value: string) {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    ["alicdn.com", "1688.com", "alibaba.com"].some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    )
  );
}

function perceptualHash(pixels: Buffer) {
  const size = 32;
  const low = 8;
  const coefficients: number[] = [];
  for (let v = 0; v < low; v += 1) {
    for (let u = 0; u < low; u += 1) {
      let sum = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          sum +=
            pixels[y * size + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
        }
      }
      coefficients.push(sum);
    }
  }
  const values = coefficients.slice(1);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  let bits = BigInt(0);
  for (const value of values)
    bits = (bits << BigInt(1)) | (value >= median ? BigInt(1) : BigInt(0));
  return bits.toString(16).padStart(16, "0");
}

export async function POST(request: Request) {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "请先登录" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "图片列表格式无效" }, { status: 400 });

  const hashes: Record<string, string> = {};
  const failures: string[] = [];
  await Promise.all(
    parsed.data.images.map(async ({ id, url }) => {
      try {
        if (!allowedImageUrl(url)) throw new Error("图片域名不受信任");
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`图片读取失败 ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 8 * 1024 * 1024) throw new Error("图片超过 8MB");
        const pixels = await sharp(bytes)
          .resize(32, 32, { fit: "fill" })
          .grayscale()
          .raw()
          .toBuffer();
        hashes[id] = perceptualHash(pixels);
      } catch {
        failures.push(id);
      }
    }),
  );
  return Response.json({ hashes, failures });
}
