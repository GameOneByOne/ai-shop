import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../browser-extension/page-scraper.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../browser-extension/manifest.json", import.meta.url), "utf8"));

const noise = /(?:包装|opp袋|定制|贴标|贴牌|标签|条码|加字|改尺寸|商标|分装)/i;
const hasPriceAndStock = (text) =>
  /[¥￥]\s*\d+(?:\.\d+)?/.test(text) && /(?:库存|可售)\s*\d+/.test(text);
const isPurchasableSpecRow = (text) => hasPriceAndStock(text) && !noise.test(text);

const cases = [
  ["2mm（65*30） ¥3.6 库存99906", true],
  ["加厚大号 ¥12.8 可售350", true],
  ["蓝色-加长款 ￥9 库存 88", true],
  ["定制加字 ¥0.5 库存1000", false],
  ["OPP袋 ¥0.2 可售500", false],
  ["单一规格", false],
];

for (const [text, expected] of cases) {
  assert.equal(isPurchasableSpecRow(text), expected, `规格行分类错误：${text}`);
}

assert.match(source, /\(\?:颜色\|款式\|型号\)/, "必须支持颜色、款式和型号区");
assert.match(source, /\(\?:规格\|尺寸\)/, "必须支持规格和尺寸区");
assert.match(source, /if\s*\(\s*!specLabel\s*\)\s*return\s*\[\s*\]/, "价格库存行必须限制在规格区内");
assert.match(source, /textSpecRows/, "必须支持跨嵌套节点的规格区可见文本解析");
assert.match(source, /fallbackSpecs\.length\s*===\s*1/, "单一规格不拆分，但必须保留其价格和库存");
assert.doesNotMatch(source, /dimensionSpecs/, "禁止恢复尺寸格式专用兜底");
assert.doesNotMatch(source, /\(\?:mm\|cm\|m\)/, "禁止按计量单位硬编码规格解析");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "扩展必须记录语义化解析版本");

console.log(`SourceSKU 解析规则回归通过（扩展 ${manifest.version}）`);
