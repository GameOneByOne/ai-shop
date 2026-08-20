const cleanText = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decode1688Keyword() {
  const raw = /[?&]keywords=([^&]+)/.exec(location.search)?.[1];
  if (!raw) return "";
  try {
    const bytes = [];
    for (let index = 0; index < raw.length; index += 1) {
      if (
        raw[index] === "%" &&
        /^[0-9a-f]{2}$/i.test(raw.slice(index + 1, index + 3))
      ) {
        bytes.push(Number.parseInt(raw.slice(index + 1, index + 3), 16));
        index += 2;
      } else bytes.push(raw.charCodeAt(index));
    }
    return new TextDecoder("gb18030").decode(new Uint8Array(bytes)).trim();
  } catch {
    return "";
  }
}

function searchInput() {
  return [...document.querySelectorAll("input")].find((input) => {
    const rect = input.getBoundingClientRect();
    return rect.width > 250 && rect.height > 20 && rect.top < 300;
  });
}

function extractSupplierName() {
  const titleOnly = (value) =>
    cleanText(String(value || "").split(/\r?\n/)[0])
      .replace(/^(?:严选|精选|实力商家|镇店之宝)\s*/, "")
      .replace(
        /(?:AI?严选指数|\d+(?:\.\d+)?\+人好评|\d(?:\.\d+)?(?=\s*(?:入选|猫咪|商品|跨境|人气))|商品复购率|\d+\+人已加购|新人价|[¥￥]\s*\d)[\s\S]*$/,
        "",
      )
      .trim();
  const candidates = [
    ...document.querySelectorAll("h1,h2,[class*=title],[class*=subject]"),
  ]
    .map((node) => {
      const rect = node.getBoundingClientRect(),
        text = titleOnly(node.innerText || node.textContent);
      return { text, rect, tag: node.tagName };
    })
    .filter(
      (item) =>
        item.text.length >= 8 &&
        item.text.length <= 180 &&
        item.rect.width > 180 &&
        item.rect.height > 12 &&
        item.rect.top > 40 &&
        item.rect.top < 420,
    );
  candidates.sort(
    (a, b) =>
      (b.tag === "H1" ? 1000 : 0) - (a.tag === "H1" ? 1000 : 0) ||
      a.text.length - b.text.length,
  );
  return candidates[0]?.text || null;
}

function extractSearchItems() {
  const seen = new Set(),
    items = [];
  const add = (id, title, text = "", card) => {
    if (!id || seen.has(id) || items.length >= 30) return;
    const clean = cleanText(title)
      .replace(/<[^>]+>/g, "")
      .slice(0, 300);
    if (clean.length < 2) return;
    const priceRaw = /[¥￥]\s*(\d+(?:\s*\.\s*\d+)?)/.exec(text)?.[1],
      price = priceRaw?.replace(/\s+/g, ""),
      markup = card?.outerHTML || "",
      moq =
        /(\d+)\s*(?:件|个|只|套)\s*起/.exec(text)?.[1] ||
        /(?:beginAmount|minOrderQuantity|quantityBegin|beginQuantity|起批量)[^\d]{0,40}(\d+)/i.exec(
          markup,
        )?.[1],
      supplier = /([^\s]{2,50}(?:有限公司|公司|工厂|厂|商行|经营部))/.exec(
        text,
      )?.[1],
      image =
        card?.querySelector("img")?.currentSrc ||
        card?.querySelector("img")?.src,
      sales = /(?:月销|已售|成交|销量)?\s*\d+(?:\.\d+)?\s*万?\s*\+?\s*件/.exec(
        text,
      )?.[0];
    seen.add(id);
    items.push({
      externalId: id,
      title: clean,
      sourceUrl: `https://detail.1688.com/offer/${id}.html`,
      priceMin: price ? Number(price) : undefined,
      minimumOrderQuantity: moq ? Number(moq) : undefined,
      supplierName: supplier,
      imageUrl: image,
      salesHint: sales,
      rawData: { cardText: text },
    });
  };
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.href || anchor.getAttribute("href") || "",
      id = /(?:offer\/|offerId[=/])(\d{8,})/i.exec(href)?.[1];
    if (!id) continue;
    const card =
        anchor.closest(
          "[class*=offer],[class*=card],[class*=item],[data-offer-id]",
        ) || anchor.parentElement,
      text = cleanText(card?.innerText || anchor.innerText || "");
    add(
      id,
      anchor.getAttribute("title") ||
        anchor.innerText ||
        text.split(/[¥￥]/)[0],
      text,
      card,
    );
  }
  return items;
}

async function extractDetails(source, factsOnly = false) {
  const bodyText = cleanText(document.body.innerText),
    supplierName = extractSupplierName(),
    capabilities = {
      dropshipping: /一件代发|代发下单/.test(bodyText) ? true : null,
      encryptedDropshipping: /密文代发/.test(bodyText) ? true : null,
      returnShipping: /退货包运费/.test(bodyText) ? true : null,
      onePiecePrice: /1件价格|1件起批|1件起订/.test(bodyText) ? true : null,
    },
    shippingText = /运费\s*[¥￥]\s*(\d+(?:\.\d+)?)\s*起?/.exec(bodyText)?.[1],
    pricingContext = {
      shippingFee: null,
      shippingQuote: shippingText ? Number(shippingText) : null,
      promotionDiscount: null,
      promotionText: /新人价|店铺优惠|券后价/.test(bodyText)
        ? "页面存在活动优惠，需在结算页核实"
        : null,
      shippingScope: shippingText ? "OFFER_QUOTE_ADDRESS_DEPENDENT" : "UNKNOWN",
    };
  if (factsOnly) {
    const moqText = /(\d+)\s*(?:件|个|只|套)\s*(?:起批|起订|起)/.exec(
        bodyText,
      )?.[1],
      minOrderQuantity = moqText ? Number(moqText) : null,
      stockText = /(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(bodyText)?.[1],
      galleryImages = [
        ...new Set(
          [...document.querySelectorAll("img")]
            .filter((image) => {
              const rect = image.getBoundingClientRect();
              return (
                rect.width >= 35 &&
                rect.height >= 35 &&
                rect.top > 80 &&
                rect.top < innerHeight * 0.9 &&
                rect.left < innerWidth * 0.55
              );
            })
            .map((image) => image.currentSrc || image.src)
            .filter(Boolean),
        ),
      ],
      onePieceDelivery = /(?:一件代发|代发下单|1件起批|1件起订)/.test(bodyText)
        ? true
        : minOrderQuantity != null
          ? minOrderQuantity <= 1
          : null,
      offerFacts = {
        price: Number.isFinite(source.priceMin)
          ? Number(source.priceMin)
          : null,
        onePieceDelivery,
        minOrderQuantity,
        blindShipping:
          /(?:密文代发|淘宝\s*[（(]?菜鸟[）)]?|无界面单|支持平台代发)/.test(
            bodyText,
          )
            ? true
            : null,
        returnShipping: /退货包运费/.test(bodyText) ? true : null,
        noReasonReturn: /7\s*天无理由退货/.test(bodyText) ? true : null,
        shopAge: Number(/入驻\s*(\d+)\s*年/.exec(bodyText)?.[1]) || null,
        qualityRate:
          Number(/品质达标率\s*(\d+(?:\.\d+)?)%/.exec(bodyText)?.[1]) || null,
        repurchaseRate:
          Number(/(?:店铺)?回头率\s*(\d+(?:\.\d+)?)%/.exec(bodyText)?.[1]) ||
          null,
        deliveryRate:
          Number(
            /(?:48|24)\s*小时(?:揽收|发货)率\s*(\d+(?:\.\d+)?)%/.exec(
              bodyText,
            )?.[1],
          ) || null,
        stock: stockText ? Number(stockText) : null,
        imageCount: galleryImages.length || null,
        hasVideo: /(?:主图视频|视频)/.test(bodyText) ? true : false,
        inspection: /(?:官方验货|规格属性检验)/.test(bodyText) ? true : null,
      };
    return {
      offerId: source.id,
      externalId: source.externalId,
      supplierName,
      parserVersion: chrome.runtime.getManifest().version,
      capabilities,
      pricingContext,
      offerFacts,
      variants: [
        {
          sourceVariantId: `${source.externalId}:qualification`,
          variantName: "资质采集",
          specValues: [],
          price: null,
          stock: null,
          image: null,
          minOrderQuantity: null,
          priceSource: "UNKNOWN",
          nodeType: "UNKNOWN",
        },
      ],
      capturedAt: new Date().toISOString(),
    };
  }
  const readable = (value) =>
      cleanText(value).replace(/库存(?:不足|紧张)|无货|售罄/g, "库存0"),
    noise =
      /(?:参数|产品类别|产品类目|品牌|材质|产地|货号|适用对象|是否进口|箱装数量|主要下游平台|主要销售地区|立即下单|加入采购车|跨境铺货|收藏|加固|包装|opp袋|定制|贴标|贴牌|标签|条码|条形码|拿样费|促销|加字|加圈|印错包赔|尺寸不符赔|改尺寸|吊牌|洗标|码标|商标|商家标|唛|分装|箱规|拉链袋|自封袋|客户提供标)/i;
  const rowFor = (image) => {
    let current = image;
    for (
      let depth = 0;
      current && depth < 7;
      depth += 1, current = current.parentElement
    ) {
      const text = readable(current.innerText);
      if (
        text.length < 220 &&
        /[¥￥]\s*\d/.test(text) &&
        /(?:库存|可售)\s*\d+/.test(text)
      )
        return current;
    }
    return null;
  };
  let rows = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    rows = [
      ...new Set(
        [...document.querySelectorAll("img")]
          .map((image) => {
            const rect = image.getBoundingClientRect();
            return rect.width >= 20 && rect.height >= 20 ? rowFor(image) : null;
          })
          .filter(Boolean),
      ),
    ];
    if (rows.length >= 2) break;
    await wait(500);
  }
  const variants = [];
  const optionFor = (image) => {
    let current = image.parentElement;
    for (
      let depth = 0;
      current && depth < 5;
      depth += 1, current = current.parentElement
    ) {
      const text = cleanText(current.innerText);
      const rect = current.getBoundingClientRect();
      if (
        text.length >= 2 &&
        text.length <= 55 &&
        rect.width >= 45 &&
        rect.width <= 260 &&
        rect.height >= 24 &&
        rect.height <= 90
      )
        return current;
    }
    return null;
  };
  const sectionLabels = [...document.querySelectorAll("div,span,label")]
      .map((node) => ({
        node,
        text: cleanText(node.textContent),
        rect: node.getBoundingClientRect(),
      }))
      .filter(
        (item) =>
          item.rect.width > 0 && item.rect.height > 0 && item.text.length <= 12,
      ),
    colorLabel = sectionLabels.find((item) =>
      /^(?:颜色|款式|型号)$/.test(item.text),
    ),
    serviceLabels = sectionLabels
      .filter(
        (item) =>
          item.rect.top > (colorLabel?.rect.bottom ?? 0) &&
          /^(?:包装|加固印字|加圈加字|贴牌换标|包装定制|改尺寸)$/.test(
            item.text,
          ),
      )
      .sort((a, b) => a.rect.top - b.rect.top),
    firstService = serviceLabels[0],
    rawSpecLabel = sectionLabels
      .filter(
        (item) =>
          item.rect.top > (colorLabel?.rect.bottom ?? 0) &&
          /^(?:规格|尺寸)$/.test(item.text),
      )
      .sort((a, b) => a.rect.top - b.rect.top)[0],
    specLabel =
      rawSpecLabel &&
      (!firstService || rawSpecLabel.rect.top < firstService.rect.top)
        ? rawSpecLabel
        : null,
    firstBoundary = [specLabel, firstService]
      .filter(Boolean)
      .sort((a, b) => a.rect.top - b.rect.top)[0],
    colorTop = colorLabel?.rect.bottom ?? 200,
    colorBottom =
      firstBoundary?.rect.top ??
      Math.max(document.documentElement.scrollHeight, innerHeight),
    specTop = specLabel?.rect.bottom ?? 0,
    specBottom =
      serviceLabels.find((item) => item.rect.top > specTop)?.rect.top ??
      Math.max(document.documentElement.scrollHeight, innerHeight);
  const collectOptions = (scoped) =>
    [
      ...new Map(
        [...document.querySelectorAll("img")]
          .map((image) => {
            const rect = image.getBoundingClientRect(),
              insidePrimarySection =
                !scoped ||
                (rect.top >= colorTop - 4 && rect.top < colorBottom - 2),
              node =
                insidePrimarySection &&
                rect.width >= 20 &&
                rect.width <= 80 &&
                rect.height >= 20 &&
                rect.height <= 80
                  ? optionFor(image)
                  : null,
              name = cleanText(node?.innerText).replace(
                /^(?:颜色|款式|型号)\s*/,
                "",
              );
            return [name, { node, image }];
          })
          .filter(
            ([name, value]) =>
              name.length >= 2 &&
              name.length <= 50 &&
              value.node &&
              !noise.test(name) &&
              !/^颜色/.test(name) &&
              !name.includes("规格"),
          ),
      ).entries(),
    ].slice(0, 50);
  let colorOptions = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const scoped = collectOptions(true),
      global = collectOptions(false);
    colorOptions = scoped.length >= 2 ? scoped : global;
    if (colorOptions.length >= 2) break;
    await wait(500);
  }
  const pricedRows = () => {
    if (!specLabel) return [];
    const hasPair = (text) =>
        /[¥￥]\s*\d+(?:\.\d+)?/.test(text) && /(?:库存|可售)\s*\d+/.test(text),
      matches = [...document.querySelectorAll("li,div,[role=button]")].filter(
        (node) => {
          const text = readable(node.innerText),
            rect = node.getBoundingClientRect(),
            insideSpec = rect.top >= specTop - 4 && rect.top < specBottom - 2;
          return (
            insideSpec &&
            rect.width >= 70 &&
            rect.height >= 20 &&
            rect.height < 140 &&
            text.length < 180 &&
            hasPair(text) &&
            !noise.test(text)
          );
        },
      );
    return matches.filter(
      (node) =>
        ![...node.children].some((child) => hasPair(readable(child.innerText))),
    );
  };
  const textSpecRows = () => {
    const lines = String(document.body.innerText || "")
        .split(/\r?\n/)
        .map((line) => readable(line))
        .filter(Boolean),
      start = lines.findIndex((line) => /^(?:规格|尺寸)$/.test(line));
    if (start < 0) return [];
    const boundary =
        /^(?:包装|加固印字|加圈加字|贴牌换标|包装定制|改尺寸|加圈加字|加固加字|贴牌|定制)$/i,
      results = [];
    let buffer = "";
    for (
      let index = start + 1;
      index < Math.min(lines.length, start + 120);
      index += 1
    ) {
      const line = lines[index];
      if (boundary.test(line)) break;
      buffer = `${buffer} ${line}`.trim();
      if (buffer.length > 220) {
        buffer = line;
        continue;
      }
      const match =
        /^(.{1,100}?)\s*[¥￥]\s*(\d+(?:\.\d+)?)[\s\S]{0,80}?(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(
          buffer,
        );
      if (!match) continue;
      const name = readable(match[1])
        .replace(/^(?:规格|尺寸)\s*/, "")
        .trim();
      if (name && !noise.test(name))
        results.push({
          name,
          price: Number(match[2]),
          stock: Number(match[3]),
        });
      buffer = "";
    }
    return [...new Map(results.map((item) => [item.name, item])).values()];
  };
  const hasChildOptions = colorOptions.length >= 2;
  if (hasChildOptions) {
    for (const [
      colorName,
      { node: colorNode, image: colorImage },
    ] of colorOptions) {
      try {
        colorNode.click();
        await wait(350);
      } catch {}
      const directRow = rowFor(colorImage),
        directText = readable(directRow?.innerText),
        directPair =
          /[¥￥]\s*(\d+(?:\.\d+)?)[\s\S]{0,80}?(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(
            directText,
          );
      if (directPair && directText.length < 160 && !specLabel) {
        const image = colorImage.currentSrc || colorImage.src || null;
        variants.push({
          sourceVariantId: `${source.externalId}:${variants.length + 1}`,
          variantName: colorName,
          specValues: [colorName],
          rawSpecText: colorName,
          rawPriceText: `¥${directPair[1]}`,
          price: Number(directPair[1]),
          stock: Number(directPair[2]),
          image,
          minOrderQuantity: null,
          priceSource: "SKU_PRICE",
          nodeType: "SKU_SPEC",
        });
        continue;
      }
      const allPriceRows = pricedRows(),
        sizeRows = allPriceRows.filter((sizeNode) => {
          const text = readable(sizeNode.innerText),
            name = text
              .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, "")
              .replace(/(?:库存|可售)\s*\d+\s*个?/g, "")
              .replace(/[-+]?\s*\d+\s*$/, "")
              .trim();
          return name && !noise.test(name);
        });
      const fallbackSpecs = sizeRows.length <= 1 ? textSpecRows() : [];
      if (fallbackSpecs.length > 1) {
        const image = colorImage.currentSrc || colorImage.src || null;
        for (const spec of fallbackSpecs) {
          const variantName = `${colorName} / ${spec.name}`;
          variants.push({
            sourceVariantId: `${source.externalId}:${variants.length + 1}`,
            variantName,
            specValues: [colorName, spec.name],
            rawSpecText: variantName,
            rawPriceText: `¥${spec.price}`,
            price: spec.price,
            stock: spec.stock,
            image,
            minOrderQuantity: null,
            priceSource: "SKU_PRICE",
            nodeType: "SKU_SPEC",
          });
        }
        continue;
      }
      if (sizeRows.length <= 1) {
        const rowSnapshot = allPriceRows
            .map((priceNode) =>
              /[¥￥]\s*(\d+(?:\.\d+)?)[\s\S]{0,80}?(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(
                readable(priceNode.innerText),
              ),
            )
            .find(Boolean),
          textSnapshot = fallbackSpecs.length === 1 ? fallbackSpecs[0] : null,
          image = colorImage.currentSrc || colorImage.src || null,
          price =
            textSnapshot?.price ??
            (rowSnapshot ? Number(rowSnapshot[1]) : null),
          stock =
            textSnapshot?.stock ??
            (rowSnapshot ? Number(rowSnapshot[2]) : null);
        variants.push({
          sourceVariantId: `${source.externalId}:${variants.length + 1}`,
          variantName: colorName,
          specValues: [colorName],
          rawSpecText: colorName,
          rawPriceText: price == null ? null : `¥${price}`,
          price,
          stock,
          image,
          minOrderQuantity: null,
          priceSource: price == null ? "UNKNOWN" : "SKU_PRICE",
          nodeType: "SKU_SPEC",
        });
        continue;
      }
      for (const sizeNode of sizeRows) {
        const local = readable(sizeNode.innerText),
          paired =
            /[¥￥]\s*(\d+(?:\.\d+)?)[\s\S]{0,80}?(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(
              local,
            );
        if (!paired) continue;
        const sizeName = local
          .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, "")
          .replace(/(?:库存|可售)\s*\d+\s*个?/g, "")
          .replace(/[-+]?\s*\d+\s*$/, "")
          .trim();
        if (!sizeName || noise.test(sizeName)) continue;
        try {
          sizeNode.click();
          await wait(220);
        } catch {}
        const image = colorImage.currentSrc || colorImage.src || null,
          variantName = `${colorName} / ${sizeName}`;
        variants.push({
          sourceVariantId: `${source.externalId}:${variants.length + 1}`,
          variantName,
          specValues: [colorName, sizeName],
          rawSpecText: variantName,
          rawPriceText: `¥${paired[1]}`,
          price: Number(paired[1]),
          stock: Number(paired[2]),
          image,
          minOrderQuantity: null,
          priceSource: "SKU_PRICE",
          nodeType: "SKU_SPEC",
        });
      }
    }
  }
  const unique = [
    ...new Map(
      rows.map((node) => {
        const text = cleanText(node.innerText),
          name = text
            .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, "")
            .replace(/(?:库存|可售)\s*\d+\s*个?/g, "")
            .replace(/^颜色\s*/, "")
            .replace(/[-+]?\s*\d+\s*$/, "")
            .trim();
        return [name, node];
      }),
    ).entries(),
  ]
    .filter(([text]) => text.length > 1 && !noise.test(text))
    .slice(0, 50);
  if (!variants.length)
    for (let index = 0; index < unique.length; index += 1) {
      const [variantName, node] = unique[index],
        local = cleanText(node.innerText),
        rowValues =
          /[¥￥]\s*(\d+(?:\.\d+)?)[\s\S]{0,80}?(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(
            local,
          );
      try {
        node.click();
        await wait(350);
      } catch {}
      const current = cleanText(document.body.innerText),
        paired =
          rowValues ||
          /[¥￥]\s*(\d+(?:\.\d+)?)[\s\S]{0,80}?(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(
            current,
          ),
        priceText = paired?.[1],
        stockText = paired?.[2],
        optionImage = node.querySelector?.("img"),
        selectedMainImage = [...document.querySelectorAll("img")].find(
          (image) => {
            const rect = image.getBoundingClientRect();
            return (
              rect.width > 300 &&
              rect.height > 300 &&
              rect.left < innerWidth * 0.55 &&
              rect.top > 120
            );
          },
        ),
        image =
          optionImage?.currentSrc ||
          optionImage?.src ||
          selectedMainImage?.currentSrc ||
          selectedMainImage?.src ||
          null;
      variants.push({
        sourceVariantId: `${source.externalId}:${index + 1}`,
        variantName,
        specValues: [variantName],
        rawSpecText: variantName,
        rawPriceText: priceText ? `¥${priceText}` : null,
        price: priceText ? Number(priceText) : null,
        stock: stockText ? Number(stockText) : null,
        image,
        minOrderQuantity: null,
        priceSource: priceText ? "SKU_PRICE" : "UNKNOWN",
        nodeType: "SKU_SPEC",
      });
    }
  if (variants.length === 1) {
    const name = variants[0].variantName,
      beforeSpec = name.split(/\s+规格\s+/)[0],
      looksCombined =
        /\s+规格\s+/.test(name) && beforeSpec.trim().split(/\s+/).length > 1;
    if (looksCombined)
      throw new Error(
        `Offer ${source.externalId} 子产品尚未展开，拒绝保存合并 SKU`,
      );
  }
  if (!variants.length)
    variants.push({
      sourceVariantId: `${source.externalId}:unresolved`,
      variantName: "规格待解析",
      specValues: [],
      price: null,
      stock: null,
      image: null,
      minOrderQuantity: null,
      priceSource: "UNKNOWN",
    });
  const moqText = /(\d+)\s*(?:件|个|只|套)\s*(?:起批|起订|起)/.exec(
      bodyText,
    )?.[1],
    minOrderQuantity = moqText ? Number(moqText) : null,
    knownStocks = variants
      .map((item) => item.stock)
      .filter((value) => Number.isFinite(value)),
    knownPrices = variants
      .map((item) => item.price)
      .filter((value) => Number.isFinite(value)),
    galleryImages = [
      ...new Set(
        [...document.querySelectorAll("img")]
          .filter((image) => {
            const rect = image.getBoundingClientRect();
            return (
              rect.width >= 35 &&
              rect.height >= 35 &&
              rect.top > 80 &&
              rect.top < innerHeight * 0.9 &&
              rect.left < innerWidth * 0.55
            );
          })
          .map((image) => image.currentSrc || image.src)
          .filter(Boolean),
      ),
    ],
    onePieceDelivery = /(?:一件代发|代发下单|1件起批|1件起订)/.test(bodyText)
      ? true
      : minOrderQuantity != null
        ? minOrderQuantity <= 1
        : null,
    offerFacts = {
      price: knownPrices.length
        ? Math.min(...knownPrices)
        : Number.isFinite(source.priceMin)
          ? Number(source.priceMin)
          : null,
      onePieceDelivery,
      minOrderQuantity,
      blindShipping:
        /(?:密文代发|淘宝\s*[（(]?菜鸟[）)]?|无界面单|支持平台代发)/.test(
          bodyText,
        )
          ? true
          : null,
      returnShipping: /退货包运费/.test(bodyText) ? true : null,
      noReasonReturn: /7\s*天无理由退货/.test(bodyText) ? true : null,
      shopAge: Number(/入驻\s*(\d+)\s*年/.exec(bodyText)?.[1]) || null,
      qualityRate:
        Number(/品质达标率\s*(\d+(?:\.\d+)?)%/.exec(bodyText)?.[1]) || null,
      repurchaseRate:
        Number(/(?:店铺)?回头率\s*(\d+(?:\.\d+)?)%/.exec(bodyText)?.[1]) ||
        null,
      deliveryRate:
        Number(
          /(?:48|24)\s*小时(?:揽收|发货)率\s*(\d+(?:\.\d+)?)%/.exec(
            bodyText,
          )?.[1],
        ) || null,
      stock: knownStocks.length
        ? knownStocks.reduce((sum, value) => sum + Number(value), 0)
        : null,
      imageCount: galleryImages.length || null,
      hasVideo: /(?:主图视频|视频)/.test(bodyText) ? true : false,
      inspection: /(?:官方验货|规格属性检验)/.test(bodyText) ? true : null,
    };
  return {
    offerId: source.id,
    externalId: source.externalId,
    supplierName,
    parserVersion: chrome.runtime.getManifest().version,
    capabilities,
    pricingContext,
    offerFacts,
    variants,
    capturedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "READ_KEYWORD") {
    const fromInput = searchInput()?.value?.trim() || "",
      fromUrl = decode1688Keyword();
    sendResponse({ keyword: fromUrl || fromInput });
    return;
  }
  if (message?.type === "SUBMIT_SEARCH") {
    const input = searchInput();
    if (!input) {
      sendResponse({ error: "未找到 1688 搜索框" });
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, message.query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const button = [
      ...document.querySelectorAll(
        "button,input[type=submit],input[type=button],a,[role=button]",
      ),
    ].find(
      (element) =>
        cleanText(
          `${element.textContent || ""}${element.value || ""}`,
        ).includes("搜索") && element.getBoundingClientRect().top < 300,
    );
    if (button) button.click();
    else if (input.form) input.form.requestSubmit();
    else {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
        }),
      );
    }
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "EXTRACT_SEARCH") {
    sendResponse({ items: extractSearchItems() });
    return;
  }
  if (message?.type === "NEXT_PAGE") {
    const next = [
      ...document.querySelectorAll("a,button,li,[role=button]"),
    ].find((element) => {
      const label = cleanText(
          `${element.textContent || ""} ${element.getAttribute("title") || ""} ${element.getAttribute("aria-label") || ""}`,
        ),
        rect = element.getBoundingClientRect();
      return (
        rect.width > 10 &&
        rect.height > 10 &&
        rect.top > innerHeight * 0.45 &&
        (/下一页|next/i.test(label) || label === ">")
      );
    });
    if (!next || next.getAttribute("aria-disabled") === "true") {
      sendResponse({ moved: false });
      return;
    }
    next.click();
    sendResponse({ moved: true });
    return;
  }
  if (message?.type === "EXTRACT_DETAILS") {
    void extractDetails(message.offer, message.factsOnly === true)
      .then((detail) => sendResponse({ detail }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});
