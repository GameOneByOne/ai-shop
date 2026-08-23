import assert from "node:assert/strict";
import { parseSourceProducts, type RawSourceOption } from "../lib/sourcing/source-products.ts";

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

console.log("SourceProduct 规格完整性回归通过");
