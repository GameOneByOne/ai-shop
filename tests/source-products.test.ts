import assert from "node:assert/strict";
import { calculateSkuListingPrice, parseSourceProducts, type RawSourceOption } from "../lib/sourcing/source-products.ts";

const names = ["彩虹小通", "蓝黑小通", "彩虹方块", "彩虹直通", "20直径彩虹T", "彩虹T型", "蓝黑T型", "彩虹S通", "彩虹S有球"];
const options: RawSourceOption[] = names.map((variantName, index) => ({
  sourceVariantId: `offer:row:${index + 1}`,
  variantName,
  rawSpecText: variantName,
  rawPriceText: `¥${index + 4.3}`,
  specValues: [variantName],
  price: index + 4.3,
  stock: 9000 - index,
  image: `https://example.com/${index}.jpg`,
  minOrderQuantity: null,
  priceSource: "SKU_PRICE",
  nodeType: "SKU_SPEC",
}));

const result = parseSourceProducts({
  sourceOfferId: "source-id",
  externalOfferId: "1052278348698",
  supportsDropshipping: true,
  onePiecePrice: true,
  options,
});
const skus = result.products.flatMap((product) => product.skus);
assert.equal(skus.length, 9, "同色但不同造型的真实 SourceSKU 不能按颜色去重");
assert.deepEqual(skus.map((sku) => sku.rawSpecText).sort(), [...names].sort());
assert.ok(skus.some((sku) => sku.specName === "彩虹小通"), "规格名不能被过度归一化成单一颜色");
assert.ok(skus.some((sku) => sku.specName === "彩虹方块"), "造型描述必须保留");
assert.equal(calculateSkuListingPrice(29.9, 4), 33.9, "SKU定价必须等于规则价加运费");
assert.equal(calculateSkuListingPrice(29.9, null), null, "运费未核实时不得生成伪定价");

const catLitterOptions: RawSourceOption[] = [
  ["5877126345121", "2502-1浅灰色（透明盖）-超大号", 10.05, 4695],
  ["5877126345129", "2503-1黄色（透明盖）-特大号", 15.94, 6172],
  ["5877126345118", "2501-1绿色（透明盖）-大号", 7.62, 4878],
].map(([skuId, color, price, stock]) => ({
  sourceVariantId: `953403075995:sku:${skuId}`,
  variantName: `${color} / 加厚猫砂盆`,
  rawSpecText: `${color} / 加厚猫砂盆`,
  rawPriceText: `¥${price}`,
  specValues: [String(color), "加厚猫砂盆"],
  price: Number(price),
  stock: Number(stock),
  image: `https://example.com/${skuId}.jpg`,
  minOrderQuantity: null,
  priceSource: "SKU_PRICE",
  nodeType: "SKU_SPEC",
}));
const catLitterResult = parseSourceProducts({
  sourceOfferId: "06997ae7-05dc-4be7-be2b-dbf426beea1e",
  externalOfferId: "953403075995",
  supportsDropshipping: true,
  onePiecePrice: true,
  options: catLitterOptions,
});
const catLitterSkus = catLitterResult.products.flatMap((product) => product.skus);
assert.equal(catLitterSkus.length, catLitterOptions.length, "颜色/尺寸与商品规格组成的二维 SourceSKU 不得被聚合行规则过滤");
assert.deepEqual(catLitterSkus[0].specValues, catLitterOptions[0].specValues, "扩展返回的真实规格维度必须原样保留");
assert.equal(catLitterSkus[0].skuId, catLitterOptions[0].sourceVariantId, "1688 SKU ID 必须写入 SourceSKU");

console.log("SourceProduct 规格完整性回归通过");
