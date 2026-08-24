const cleanText = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodePageText(value) {
  return cleanText(value)
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// The canonical Offer payload is rendered before interactive components mount.
// Parse it as data (never execute it) so recommendation cards cannot be mistaken
// for the current Offer. Numeric SKU keys are the only non-JSON syntax observed.
function extractEmbeddedOfferState() {
  const marker = "})(window.contextPath,";
  for (const script of document.scripts) {
    const text = String(script.textContent || ""), start = text.indexOf(marker);
    if (start < 0 || !text.includes('"skuModel"')) continue;
    let raw = text.slice(start + marker.length).trim().replace(/\);\s*$/, "");
    raw = raw.replace(/([,{])\s*(\d+)\s*:/g, '$1"$2":');
    try {
      const parsed = JSON.parse(raw), result = parsed?.result;
      return { data: result?.data || null, globalData: result?.global?.globalData || null };
    } catch {}
  }
  return null;
}

function embeddedOfferFacts(state) {
  const dataJson = state?.data?.Root?.fields?.dataJson || {},
    tempModel = dataJson.tempModel || {}, offerBaseInfo = dataJson.offerBaseInfo || {},
    shopBaseInfo = state?.globalData?.model?.detailBusiness?.shopBaseInfo || {},
    productTitle = state?.data?.productTitle?.fields || {},
    gallery = state?.data?.gallery?.fields || {},
    // productTitle.rateInfo can be a cross-network/store summary and has been
    // observed to disagree with the actual 商品评价 component. Only accept
    // evaluation-module-owned structured data here.
    rateInfo = state?.data?.productEvaluation?.fields?.rateInfo || {},
    totalEntry = (rateInfo.commonTagNodeList || []).find((item) => item?.name === "全部"),
    totalReviewCount = totalEntry?.count == null ? null : Number(totalEntry.count),
    productRating = rateInfo.goodsGrade == null ? null : Number(rateInfo.goodsGrade),
    positiveReviewRate = rateInfo.goodRates == null ? null : Number(rateInfo.goodRates),
    selectionTag = (productTitle.tagList || []).find((item) =>
      item?.type === "1688_ELECTION" || /^(?:1688)?严选$/.test(cleanText(item?.text))),
    cpvEnhance = gallery?.CpvEnhance || {},
    categoryEntries = [cpvEnhance.normalCpv, cpvEnhance.decisionCpv]
      .flatMap((value) => Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : []),
    categoryEntry = categoryEntries
      .find((item) => /^(?:产品类别|产品类目|商品类目|类目|品类)$/.test(cleanText(item?.name || item?.key || item?.propertyName))),
    categoryValue = cleanText(
      categoryEntry?.value || categoryEntry?.valueName ||
      (Array.isArray(categoryEntry?.values) ? categoryEntry.values.map((item) => item?.name || item?.value || item).filter(Boolean).join(" / ") : categoryEntry?.values),
    ),
    merchantFeatures = [
      shopBaseInfo.isPmSource ? "源头旗舰" : null,
      !shopBaseInfo.isPmSource && shopBaseInfo.isPm ? "实力商家" : null,
    ].filter(Boolean);
  return {
    title: cleanProductTitle(tempModel.offerTitle) || null,
    supplierName: cleanText(tempModel.companyName || tempModel.sellerLoginId ||
      shopBaseInfo.authCompanyName || shopBaseInfo.companyName || offerBaseInfo.sellerLoginId) || null,
    hasSelectionTitle: Array.isArray(productTitle.tagList) ? Boolean(selectionTag) : null,
    selectionTitle: cleanText(selectionTag?.text) || null,
    merchantFeatures,
    merchantType: merchantFeatures.join(" · ") || null,
    productCategory: categoryValue || null,
    productCategoryId: cleanText(tempModel.postCategoryId || offerBaseInfo.catId) || null,
    storeRepurchaseRate: Number.parseFloat(shopBaseInfo.byrRepeatRate3m) || null,
    review: {
      productRating: Number.isFinite(productRating) ? productRating : null,
      totalReviewCount: Number.isFinite(totalReviewCount) ? totalReviewCount : null,
      totalReviewCountDisplay: Number.isFinite(totalReviewCount) ? String(totalReviewCount) : null,
      positiveReviewRate: Number.isFinite(positiveReviewRate) ? positiveReviewRate : null,
    },
    skuModel: dataJson.skuModel || null,
    mainImages: Array.isArray(gallery.mainImage)
      ? gallery.mainImage.filter((url) => /^https?:\/\//i.test(url || ""))
      : [],
  };
}

function fixedTitleBadgeFacts(pageTitle) {
  if (!pageTitle) return { hasSelectionTitle: null, selectionTitle: null };
  const titleNode = [...document.querySelectorAll("h1,[class*=offer-title],[class*=product-title]")]
    .find((node) => cleanText(node.innerText || node.textContent).includes(pageTitle || ""));
  if (!titleNode) return { hasSelectionTitle: null, selectionTitle: null };
  let titleModule = titleNode;
  for (let depth = 0; titleModule.parentElement && depth < 4; depth += 1) {
    const next = titleModule.parentElement, text = cleanText(next.innerText);
    if (text.length > 1800 || next.getBoundingClientRect().height > 600) break;
    titleModule = next;
  }
  const ownLabels = [...titleModule.querySelectorAll("span,img,[title],[aria-label]")]
    .flatMap((node) => [node.innerText, node.getAttribute("alt"), node.getAttribute("title"), node.getAttribute("aria-label")])
    .map(cleanText).filter(Boolean),
    selectionTitle = ownLabels.find((value) => /^(?:1688)?严选$/.test(value)) || null;
  return { hasSelectionTitle: Boolean(selectionTitle), selectionTitle };
}

function embeddedSkuVariants(state, externalId) {
  const facts = embeddedOfferFacts(state), model = facts.skuModel, infoMap = model?.skuInfoMap;
  if (!infoMap || typeof infoMap !== "object") return [];
  const skuEntries = Object.entries(infoMap);
  const imageByValue = new Map();
  for (const prop of model.skuProps || [])
    for (const value of prop?.value || [])
      if (value?.name && value?.imageUrl) imageByValue.set(decodePageText(value.name), value.imageUrl);
  return skuEntries.flatMap(([rawName, info], index) => {
    const specValues = decodePageText(info?.specAttrs || rawName).split(">").map(cleanText).filter(Boolean),
      price = Number(info?.discountPrice ?? info?.price), stock = Number(info?.canBookCount),
      variantName = specValues.join(" / ");
    if (!variantName) return [];
    return [{
      sourceVariantId: `${externalId}:sku:${info?.skuId || info?.specId || index + 1}`,
      variantName, specValues, rawSpecText: variantName,
      rawPriceText: Number.isFinite(price) ? `¥${price}` : null,
      price: Number.isFinite(price) ? price : null,
      stock: Number.isFinite(stock) ? stock : null,
      image: specValues.map((value) => imageByValue.get(value)).find(Boolean) ||
        (skuEntries.length === 1 ? facts.mainImages[0] || null : null),
      minOrderQuantity: null,
      priceSource: Number.isFinite(price) ? "SKU_PRICE" : "UNKNOWN",
      nodeType: "SKU_SPEC",
    }];
  });
}

function cleanProductTitle(value) {
  let title = cleanText(value)
    .replace(/[【\[]\s*(?:一件代发|支持代发|厂家直销|厂家直供|源头厂家|跨境专供|包邮|现货|可混批|批发)\s*[】\]]/g, " ")
    .trim();
  const leading = /^(?:(?:支持)?一件代发|厂家直销|厂家直供|源头厂家|跨境专供|支持混批|可混批|批发|包邮|现货|限购\s*\d+\s*(?:件|个|只|套)?)[\s·丨|｜,，、:：_-]*/;
  const trailing = /[\s·丨|｜,，、:：_-]*(?:(?:支持)?一件代发|厂家直销|厂家直供|源头厂家|跨境专供|支持混批|可混批|批发|包邮|现货)$/;
  for (let index = 0; index < 4; index += 1) {
    const next = title.replace(leading, "").replace(trailing, "").trim();
    if (next === title) break;
    title = next;
  }
  return title.replace(/^[\s·丨|｜,，、:：_-]+|[\s·丨|｜,，、:：_-]+$/g, "");
}

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
  const companyPattern = /[\u4e00-\u9fa5A-Za-z0-9（）()·]{2,60}(?:有限责任公司|股份有限公司|有限公司|供应链管理有限公司|公司|工厂|厂|商行|经营部)/g;
  const candidates = [];
  for (const node of document.querySelectorAll(
    "[class*=company],[class*=supplier],[class*=shop],[class*=seller],[class*=factory],a[href*=company],a[href*=winport]",
  )) {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const matches = cleanText(node.innerText || node.textContent).match(companyPattern) || [];
    for (const text of matches) candidates.push({ text, top: rect.top });
  }
  if (!candidates.length) {
    const matches = cleanText(document.body.innerText).match(companyPattern) || [];
    for (const text of matches) candidates.push({ text, top: 9999 });
  }
  candidates.sort((a, b) => a.top - b.top || a.text.length - b.text.length);
  return candidates[0]?.text || null;
}

function extractPageTitle(supplierName = null) {
  const normalize = (value) =>
    cleanProductTitle(String(value || "").split(/\r?\n/)[0])
      .replace(/^(?:严选|精选|实力商家|镇店之宝)\s*/, "")
      .replace(/[-_｜|]\s*阿里巴巴.*$/i, "")
      .replace(
        /(?:AI?严选指数|商品复购率|\d+\+人已加购|新人价|[¥￥]\s*\d)[\s\S]*$/,
        "",
      )
      .trim();
  const isSupplierTitle = (value) =>
    !value ||
    value === supplierName ||
    /^(?:[\u4e00-\u9fa5A-Za-z0-9（）()·]{2,60})(?:有限责任公司|股份有限公司|有限公司|供应链管理有限公司|公司|工厂|厂|商行|经营部)$/.test(value);
  const isPromotionTitle = (value) =>
    /^(?:限购\s*\d+|新人(?:价|专享|首单)|满\s*\d+|券后|优惠|促销|活动)|(?:超出|超过).{0,12}(?:不享受|无)优惠|\d+\s*(?:件|个|只|套)\s*起批/.test(
      value,
    );
  const metaTitle = normalize(
    document.querySelector('meta[property="og:title"]')?.content ||
      document.querySelector('meta[name="og:title"]')?.content,
  );
  const candidates = [
    ...document.querySelectorAll("h1,[class*=offer-title],[class*=title],[class*=subject]"),
  ]
    .map((node) => ({
      text: normalize(node.innerText || node.textContent),
      rect: node.getBoundingClientRect(),
      heading: node.tagName === "H1",
    }))
    .filter(
      (item) =>
        item.text.length >= 2 &&
        item.text.length <= 300 &&
        item.rect.width > 100 &&
        item.rect.height > 10 &&
        item.rect.top > 20 &&
        item.rect.top < 520 &&
        !isSupplierTitle(item.text) &&
        !isPromotionTitle(item.text),
    )
    .sort((a, b) => Number(b.heading) - Number(a.heading) || b.text.length - a.text.length);
  if (candidates[0]?.text) return candidates[0].text;
  if (
    metaTitle.length >= 2 &&
    !isSupplierTitle(metaTitle) &&
    !isPromotionTitle(metaTitle)
  )
    return metaTitle.slice(0, 300);
  const documentTitle = normalize(document.title);
  return isSupplierTitle(documentTitle) || isPromotionTitle(documentTitle)
    ? null
    : documentTitle || null;
}

async function extractMaterialPreviewTitle() {
  const findModule = () => {
    const anchor = [...document.querySelectorAll("div,span,h1,h2,h3,h4")].find(
      (node) => cleanText(node.textContent) === "铺货素材预览",
    );
    let node = anchor;
    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      const text = cleanText(node.innerText);
      if (text.length < 16000 && /商品标题/.test(text) && /主图/.test(text) && /SKU图/.test(text))
        return node;
    }
    return null;
  };
  let materialModule = findModule(), openedByParser = false;
  if (!materialModule) {
    const buttons = [...document.querySelectorAll("button")].filter(
      (node) => cleanText(node.innerText) === "立即铺货" && node.getBoundingClientRect().width > 0,
    );
    const entry = buttons.find((node) => {
      let parent = node.parentElement;
      for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement)
        if (/密文代发|分销代发/.test(cleanText(parent.innerText))) return true;
      return false;
    });
    if (entry) {
      entry.click();
      openedByParser = true;
      for (let attempt = 0; attempt < 12 && !materialModule; attempt += 1) {
        await wait(250);
        materialModule = findModule();
      }
    }
  }
  if (!materialModule) return null;
  const lines = String(materialModule.innerText || "").split(/\r?\n/).map(cleanText).filter(Boolean),
    candidates = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index] !== "商品标题") continue;
    for (let offset = 1; offset <= 3; offset += 1) {
      const candidate = cleanProductTitle(lines[index + offset]);
      if (candidate.length >= 4 && candidate.length <= 300 && !/^(?:主图|SKU图|商品属性|详情图)/.test(candidate)) {
        candidates.push(candidate);
        break;
      }
    }
  }
  const title = candidates.at(-1) ?? null;
  if (openedByParser) {
    const close = [...materialModule.querySelectorAll("button,[role=button]")].find((node) =>
      /^(?:×|关闭)$/.test(cleanText(node.innerText || node.getAttribute("aria-label"))),
    );
    close?.click();
  }
  return title;
}

function reportReviewParseStatus(status) {
  try { chrome.runtime.sendMessage({ type: "DETAIL_REVIEW_STATUS", status }); } catch {}
}

function visiblePublishControl(pattern, root = document) {
  return [...root.querySelectorAll("button,a,[role=button],label")].find((node) => {
    const rect = node.getBoundingClientRect(), text = cleanText(node.innerText || node.textContent).replace(/\s+(?=[（(])/g, "");
    return rect.width > 0 && rect.height > 0 && pattern.test(text);
  });
}

async function startDefaultPublish() {
  const stages = [];
  const publishEntries = [...document.querySelectorAll("button,a,[role=button]")].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && cleanText(node.innerText || node.textContent) === "立即铺货";
  });
  const entry = publishEntries.find((node) => {
    let parent = node.parentElement;
    for (let depth = 0; parent && depth < 8; depth += 1, parent = parent.parentElement) {
      const text = cleanText(parent.innerText);
      if (/密文代发|分销代发|铺货素材/.test(text)) return true;
      if (text.length > 12000) break;
    }
    return false;
  }) || (publishEntries.length === 1 ? publishEntries[0] : null);
  if (!entry) throw new Error("找不到“立即铺货”按钮，请确认当前是支持铺货的 1688 商品详情页");
  entry.click();
  stages.push("clicked_immediate_publish");

  const containingPanel = (anchor) => {
    let node = anchor;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
      const rect = node.getBoundingClientRect(), text = cleanText(node.innerText);
      const hasStoreSelector = node.querySelector?.('input[type="checkbox"],[role="checkbox"]');
      if (rect.width > 240 && rect.height > 100 && rect.right > innerWidth * 0.7 && text.length < 30000 && /确认店铺/.test(text) && (hasStoreSelector || /立即铺货/.test(text))) return node;
    }
    return null;
  };
  let panel = null;
  for (let attempt = 0; attempt < 20 && !panel; attempt += 1) {
    await wait(250);
    panel = [...document.querySelectorAll('[role="dialog"],.next-dialog,.next-overlay-wrapper,.ant-modal,.ant-drawer,.ant-drawer-content-wrapper')].find((node) => {
      const rect = node.getBoundingClientRect(), text = cleanText(node.innerText);
      return rect.width > 0 && rect.height > 0 && /确认店铺/.test(text);
    }) || null;
    if (!panel) {
      const confirmAnchor = visiblePublishControl(/^立即铺货(?:[（(]单店[）)])?$/);
      panel = confirmAnchor ? containingPanel(confirmAnchor) : null;
    }
    if (!panel) {
      const titleAnchor = [...document.querySelectorAll("div,span,h1,h2,h3,h4")].find((node) => {
        const rect = node.getBoundingClientRect(), text = cleanText(node.textContent);
        return rect.width > 0 && rect.height > 0 && text === "确认店铺";
      });
      panel = titleAnchor ? containingPanel(titleAnchor) : null;
    }
  }
  if (!panel) return { ok: true, stages, needsFrameConfirmation: true };

  const nativeChecks = [...panel.querySelectorAll('input[type="checkbox"]')].filter((input) => !input.disabled);
  const semanticChecks = [...panel.querySelectorAll('[role="checkbox"]')].filter((node) => node.getAttribute("aria-disabled") !== "true");
  const uncheckedNative = nativeChecks.find((input) => !input.checked && /淘宝|店铺|铺货/.test(cleanText(input.closest("label")?.innerText || input.parentElement?.parentElement?.innerText || panel.innerText)));
  const uncheckedSemantic = semanticChecks.find((node) => node.getAttribute("aria-checked") !== "true" && /淘宝|店铺|铺货/.test(cleanText(node.closest("label")?.innerText || node.parentElement?.parentElement?.innerText || panel.innerText)));
  const storeSelected = () => [...panel.querySelectorAll('input[type="checkbox"]')].some((input) => input.checked || input.closest(".ant-checkbox")?.classList.contains("ant-checkbox-checked")) || [...panel.querySelectorAll('[role="checkbox"]')].some((node) => node.getAttribute("aria-checked") === "true");
  if (uncheckedNative) {
    for (let attempt = 0; attempt < 3 && !storeSelected(); attempt += 1) {
      const currentCheckbox = [...panel.querySelectorAll('input[type="checkbox"]')].find((input) => !input.disabled && !input.checked);
      if (!currentCheckbox) break;
      currentCheckbox.focus();
      currentCheckbox.click();
      await wait(350);
    }
  } else if (uncheckedSemantic) {
    for (let attempt = 0; attempt < 3 && !storeSelected(); attempt += 1) {
      const currentCheckbox = [...panel.querySelectorAll('[role="checkbox"]')].find((node) => node.getAttribute("aria-disabled") !== "true" && node.getAttribute("aria-checked") !== "true");
      if (!currentCheckbox) break;
      currentCheckbox.focus();
      currentCheckbox.click();
      await wait(350);
    }
  }
  else if (!nativeChecks.some((input) => input.checked) && !semanticChecks.some((node) => node.getAttribute("aria-checked") === "true"))
    throw new Error("“确认店铺”抽屉中未找到可勾选的淘宝店铺");
  for (let attempt = 0; attempt < 20 && !storeSelected(); attempt += 1) await wait(250);
  if (!storeSelected()) throw new Error("已找到淘宝店铺，但自动勾选未生效");
  stages.push("checked_default_store");

  const confirm = visiblePublishControl(/^立即铺货(?:[（(]单店[）)])?$/, panel);
  if (!confirm) throw new Error("“确认店铺”抽屉中找不到底部“立即铺货”按钮");
  for (let attempt = 0; attempt < 20 && (confirm.disabled || confirm.getAttribute("aria-disabled") === "true"); attempt += 1) await wait(250);
  if (confirm.disabled || confirm.getAttribute("aria-disabled") === "true") throw new Error("店铺已勾选，但底部“立即铺货”按钮仍未启用");
  confirm.click();
  stages.push("confirmed_publish");
  return { ok: true, stages, submittedAt: new Date().toISOString(), currentUrl: location.href };
}

function emptyProductReviewFacts(status) {
  return { reviewParseStatus: status, productRating: null, totalReviewCount: null,
    totalReviewCountDisplay: null, productReviewCount: null, productReviewCountDisplay: null,
    positiveReviewCount: null, positiveReviewCountDisplay: null, positiveReviewRate: null,
    productRepurchaseRate: null, aiSelectionIndex: null };
}

function reviewMetric(pattern, text) {
  const match = pattern.exec(text || ""), number = Number(match?.[1]);
  if (!match || !Number.isFinite(number)) return { value: null, display: null };
  return { value: Math.round(number * (match[2] === "万" ? 10000 : 1)), display: `${match[1]}${match[2] || ""}${match[3] || ""}` };
}

function compactChineseCount(value) {
  const match = String(value || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(万)?\s*(\+)?/);
  if (!match) return null;
  const number = Number(match[1]) * (match[2] ? 10000 : 1);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function criticalPageRuleFacts(bodyText) {
  // The product action bar renders counts as `收藏 (84)`. Do not treat
  // shop-follow text as this product-level metric.
  const favoriteMatch = /(?:商品)?收藏(?:人数|数量|数)?\s*[（(]?\s*([\d,.]+\s*万?\s*\+?)\s*[）)]?/.exec(bodyText)
    || /([\d,.]+\s*万?\s*\+?)\s*(?:人)?收藏(?:该商品|商品)?/.exec(bodyText);
  const explicitlyInvalid = /商品已下架|商品不存在|已失效|暂不支持购买|无法购买|商品已删除/.test(bodyText);
  const purchasable = Boolean(document.querySelector('button[class*="buy"],button[class*="order"],[class*="add-cart"],[class*="purchase"]'))
    || /立即订购|立即下单|加入进货单|加入采购车/.test(bodyText);
  return { productFavoriteCount: compactChineseCount(favoriteMatch?.[1]), productValid: explicitlyInvalid ? false : purchasable ? true : null };
}

function structuredProductReviewFacts() {
  const products = [], visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6) return;
    if (String(value["@type"] || "").toLowerCase() === "product") products.push(value);
    Object.values(value).forEach((child) => visit(child, depth + 1));
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visit(JSON.parse(script.textContent || "null")); } catch {}
  }
  for (const product of products) {
    const aggregate = product.aggregateRating;
    if (!aggregate || typeof aggregate !== "object") continue;
    const rating = Number(aggregate.ratingValue), count = Number(aggregate.reviewCount ?? aggregate.ratingCount);
    if (!Number.isFinite(rating) && !Number.isFinite(count)) continue;
    return { productRating: rating >= 0 && rating <= 5 ? rating : null,
      totalReviewCount: Number.isFinite(count) && count >= 0 ? Math.round(count) : null,
      totalReviewCountDisplay: Number.isFinite(count) && count >= 0 ? String(count) : null };
  }
  return null;
}

function nodesWithOwnText(pattern, limit = 80) {
  const nodes = [], seen = new Set(), walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode()) && nodes.length < limit) {
    if (!pattern.test(cleanText(textNode.nodeValue))) continue;
    const element = textNode.parentElement;
    if (element && !seen.has(element)) { seen.add(element); nodes.push(element); }
  }
  return nodes;
}

function productReviewAnchors() {
  return nodesWithOwnText(/^(?:商品评价|商品评论|累计评价)(?:\s*\([^)]*\))?$/, 40);
}

function findProductReviewModule() {
  const anchors = productReviewAnchors();
  const candidates = [];
  for (const anchor of anchors) {
    let node = anchor;
    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 12000) break;
      const hits = [/(?:\d+(?:\.\d+)?)(?:万)?\+?\s*条评价/, /人好评/, /好评率/, /商品复购率/, /AI\s*严选指数/i]
        .filter((pattern) => pattern.test(text)).length;
      const hinted = /review|comment|evaluate|evaluation|rate/i.test(String(node.className || ""));
      if (hits || hinted) candidates.push({ node, hits, hinted, length: text.length, depth });
    }
  }
  candidates.sort((a, b) => b.hits - a.hits || Number(b.hinted) - Number(a.hinted) || a.length - b.length || a.depth - b.depth);
  return candidates[0]?.node || anchors[0]?.parentElement || null;
}

function safeReviewControl(node) {
  if (!node) return false;
  const role = node.getAttribute("role"), href = node.getAttribute("href");
  if (node.tagName === "BUTTON" || role === "tab" || role === "button") return true;
  if (node.tagName !== "A") return false;
  return !href || href === "#" || /^javascript:/i.test(href);
}

async function loadProductReviewModule() {
  reportReviewParseStatus("正在定位商品评价模块");
  let reviewModule = findProductReviewModule();
  const entry = productReviewAnchors().find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (!reviewModule && !entry) return null;
  reportReviewParseStatus("正在加载商品评价");
  (entry || reviewModule)?.scrollIntoView({ block: "center", behavior: "instant" });
  await wait(500);
  if (safeReviewControl(entry)) {
    entry.click(); await wait(700);
  }
  reviewModule = findProductReviewModule() || reviewModule;
  const expand = [...(reviewModule?.querySelectorAll("a,button,[role=button]") || [])].find((node) =>
    /^(?:查看全部评价|全部评价|展开评价)$/.test(cleanText(node.textContent)));
  if (safeReviewControl(expand)) { expand.click(); await wait(700); reviewModule = findProductReviewModule() || reviewModule; }
  return reviewModule;
}

async function extractProductReviewFacts(embeddedReview = null) {
  const structured = embeddedReview?.productRating != null || embeddedReview?.totalReviewCount != null
    ? embeddedReview
    : structuredProductReviewFacts();
  let reviewModule;
  try { reviewModule = await loadProductReviewModule(); }
  catch { reportReviewParseStatus("商品评价加载失败"); return emptyProductReviewFacts("商品评价加载失败"); }
  if (!reviewModule && !structured) { reportReviewParseStatus("商品评价模块不存在"); return emptyProductReviewFacts("商品评价模块不存在"); }
  reportReviewParseStatus("正在解析商品评分");
  const text = cleanText(reviewModule?.innerText || reviewModule?.textContent),
    total = reviewMetric(/(\d+(?:\.\d+)?)(万)?(\+)?\s*条评价/, text),
    positive = reviewMetric(/(\d+(?:\.\d+)?)(万)?(\+)?\s*人好评/, text),
    ratingNodes = [...(reviewModule?.querySelectorAll("[class*=score],[class*=rating],[class*=star],[aria-label*=分],[title*=分]") || [])],
    ratingCandidates = ratingNodes.flatMap((node) => {
      const evidence = cleanText([node.textContent, node.getAttribute("aria-label"), node.getAttribute("title"), node.getAttribute("data-score"), node.getAttribute("data-rating")].filter(Boolean).join(" "));
      const values = [...evidence.matchAll(/(?:评分|商品评分|星级)?\s*[：:]?\s*([0-5](?:\.\d+)?)(?:\s*分)?/g)].map((match) => Number(match[1]));
      const width = /width\s*:\s*(\d+(?:\.\d+)?)%/.exec(node.getAttribute("style") || "")?.[1];
      if (width) values.push(Number(width) / 20);
      return values.filter((value) => Number.isFinite(value) && value >= 0 && value <= 5);
    }),
    adjacentRating = [...(reviewModule?.querySelectorAll("span,div,strong,b,em") || [])]
      .map((node) => cleanText(node.textContent))
      .filter((value) => /^[0-5](?:\.\d+)$/.test(value))
      .map(Number)
      .find((value) => Number.isFinite(value) && value >= 0 && value <= 5),
    combined = Number(/([0-5](?:\.\d+)?)\s*[（(]\s*\d+(?:\.\d+)?(?:万)?\+?\s*条评价/.exec(text)?.[1]),
    labeled = Number(/(?:商品评分|综合评分|评分)\s*[：:]?\s*([0-5](?:\.\d+)?)/.exec(text)?.[1]),
    rating = [ratingCandidates[0], combined, labeled, adjacentRating, structured?.productRating].find((value) => Number.isFinite(value) && value >= 0 && value <= 5) ?? null,
    numberFrom = (pattern) => { const value = Number(pattern.exec(text)?.[1]); return Number.isFinite(value) ? value : null; };
  const facts = { reviewParseStatus: "商品评价解析完成", productRating: rating,
    totalReviewCount: total.value ?? structured?.totalReviewCount ?? null,
    totalReviewCountDisplay: total.display ?? structured?.totalReviewCountDisplay ?? null,
    productReviewCount: positive.value, productReviewCountDisplay: positive.display ? `${positive.display}人好评` : null,
    positiveReviewCount: positive.value, positiveReviewCountDisplay: positive.display ? `${positive.display}人好评` : null,
    positiveReviewRate: numberFrom(/好评率\s*[：:]?\s*(\d+(?:\.\d+)?)%/) ?? structured?.positiveReviewRate ?? null,
    productRepurchaseRate: numberFrom(/商品复购率\s*[：:]?\s*(\d+(?:\.\d+)?)%/),
    aiSelectionIndex: numberFrom(/AI\s*严选指数\s*[：:]?\s*(\d+(?:\.\d+)?)/i) };
  reportReviewParseStatus("商品评价解析完成");
  return facts;
}

function visibleImageUrls(selector = "img") {
  return [...new Set(
    [...document.querySelectorAll(selector)]
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 35 && rect.height >= 35;
      })
      .map((image) => image.currentSrc || image.src)
      .filter((url) => /^https?:/i.test(url || "")),
  )];
}

function extractProductAttributes() {
  const result = {};
  const containers = document.querySelectorAll(
    "[class*=attribute],[class*=parameter],[class*=property],[class*=params]",
  );
  for (const container of containers) {
    const text = String(container.innerText || "");
    for (const line of text.split(/\r?\n/).map(cleanText).filter(Boolean)) {
      const match = /^([^：:]{1,24})[：:]\s*(.{1,100})$/.exec(line);
      if (!match || /^(?:价格|库存|运费|优惠|服务)$/.test(match[1])) continue;
      if (!result[match[1]]) result[match[1]] = match[2];
      if (Object.keys(result).length >= 40) return result;
    }
  }
  return result;
}

function textAround(anchorPattern, maxLength = 1200) {
  const text = cleanText(document.body.innerText);
  const match = anchorPattern.exec(text);
  return match ? text.slice(match.index, match.index + maxLength) : "";
}

function smallestModule({ selector = "div,section", anchorPattern, requiredPatterns = [], maxDepth = 7 }) {
  const candidates = [];
  for (const anchor of document.querySelectorAll(selector)) {
    const anchorText = cleanText(anchor.textContent);
    if (!anchorPattern.test(anchorText)) continue;
    let node = anchor;
    for (let depth = 0; node && depth <= maxDepth; depth += 1, node = node.parentElement) {
      const text = cleanText(node.innerText);
      if (!text || text.length > 2400) continue;
      if (requiredPatterns.every((pattern) => pattern.test(text))) {
        candidates.push({ node, text, length: text.length });
        break;
      }
    }
  }
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0] || null;
}

function parseDisplayMetric(pattern, text) {
  const match = pattern.exec(text);
  if (!match) return { value: null, display: null };
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return { value: null, display: null };
  const unit = match[2] === "万" ? "万" : "";
  const plus = match[3] ? "+" : "";
  return {
    value: Math.round(numeric * (unit ? 10000 : 1)),
    display: `${match[1]}${unit}${plus}`,
  };
}

function extractOfferPriceFacts(bodyText, priceScopes = []) {
  const topText = [...priceScopes, bodyText.slice(0, 15000)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 15000)
    .replace(/([¥￥])\s+/g, "$1")
    .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");
  const rangePatterns = [
    /[¥￥](\d+(?:\.\d+)?)[^¥￥\d]{0,40}[¥￥](\d+(?:\.\d+)?)[^。；;]{0,60}\d+\s*(?:件|个|只|套)\s*起批/,
    /(?:\d+\s*(?:件|个|只|套)\s*起批[^¥￥]{0,80})?[¥￥]\s*(\d+(?:\.\d+)?)\s*(?:～|~|至|—|–|-)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/,
    /[¥￥]\s*(\d+(?:\.\d+)?)\s*(?:～|~|至|—|–|-)\s*[¥￥]?\s*(\d+(?:\.\d+)?)[^\d]{0,80}\d+\s*(?:件|个|只|套)\s*起批/,
  ];
  let range = null;
  for (const pattern of rangePatterns) {
    const match = pattern.exec(topText);
    if (match) {
      range = [Number(match[1]), Number(match[2])].sort((a, b) => a - b);
      break;
    }
  }
  const single = /(?:\d+\s*(?:件|个|只|套)\s*起批[^¥￥]{0,80})[¥￥]\s*(\d+(?:\.\d+)?)/.exec(topText);
  const newcomer = /(?:新人价|新人专享|新人首单)[^¥￥\d]{0,20}[¥￥]\s*(\d+(?:\.\d+)?)\s*(起)?/.exec(topText);
  const min = range?.[0] ?? (single ? Number(single[1]) : null);
  const max = range?.[1] ?? min;
  return {
    offerPriceMin: Number.isFinite(min) ? min : null,
    offerPriceMax: Number.isFinite(max) ? max : null,
    offerPriceDisplay: min == null ? null : min === max ? `¥${min}` : `¥${min}～${max}`,
    newcomerPrice: newcomer ? Number(newcomer[1]) : null,
    newcomerPriceDisplay: newcomer ? `新人 ¥${newcomer[1]}${newcomer[2] ? "起" : ""}` : null,
  };
}

async function hydrateDetailPage() {
  const start = scrollY;
  const height = Math.max(document.documentElement.scrollHeight, innerHeight);
  for (const ratio of [0.25, 0.5, 0.75, 1]) {
    scrollTo({ top: Math.round(height * ratio), behavior: "instant" });
    await wait(650);
  }
  const anchors = nodesWithOwnText(/^(?:密文代发|颜色|款式|型号|规格|尺寸|商品评价)$/, 24);
  for (const anchor of anchors.slice(0, 8)) {
    anchor.scrollIntoView({ block: "center", behavior: "instant" });
    await wait(500);
  }
  scrollTo({ top: start, behavior: "instant" });
  await wait(650);
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
      imageCandidates = [...(card?.querySelectorAll("img") || [])].flatMap((node) =>
        [node.currentSrc, node.src, node.getAttribute("data-src"), node.getAttribute("data-lazy-src"), node.getAttribute("data-original")]),
      normalizedImages = [...new Set(imageCandidates.filter(Boolean).map((url) =>
        String(url).startsWith("//") ? `https:${url}` : String(url)))],
      image = normalizedImages.find((url) => /\/img\/ibank\//i.test(url)) ||
        normalizedImages.find((url) =>
          /^https?:\/\//i.test(url) && !/(?:logo|icon|avatar|badge|label|qrcode|tfs\/|gw\.alicdn)/i.test(url)) || null,
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
      ...(image ? { imageUrl: image } : {}),
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
      moduleEvidence = (() => {
        const values = [];
        let node = card;
        for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement)
          values.push(String(node.className || ""), cleanText(node.getAttribute?.("aria-label")));
        return values.join(" ");
      })(),
      text = cleanText(card?.innerText || anchor.innerText || "");
    if (/recommend|guess|hot|rank|carousel|banner|sidebar|similar|猜你喜欢|推荐/i.test(moduleEvidence)) continue;
    if (!/[¥￥]\s*\d/.test(text) || text.length > 1800) continue;
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

function searchResultsScrollRoot() {
  const offerHref = /(?:offer\/|offerId[=/])\d{8,}/i,
    candidates = [...document.querySelectorAll("main,section,div")].flatMap((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width < 500 || rect.height < 300 || node.scrollHeight <= node.clientHeight + 120) return [];
      const overflow = getComputedStyle(node).overflowY;
      if (!/(?:auto|scroll)/.test(overflow)) return [];
      const offerLinks = [...node.querySelectorAll("a[href]")]
        .filter((link) => offerHref.test(link.href || link.getAttribute("href") || "")).length;
      return offerLinks >= 2 ? [{ node, offerLinks, area: rect.width * rect.height }] : [];
    });
  candidates.sort((a, b) => b.offerLinks - a.offerLinks || b.area - a.area);
  return candidates[0]?.node || document.scrollingElement || document.documentElement;
}

function moveSearchScroll(root, top) {
  if (root === document.scrollingElement || root === document.documentElement || root === document.body)
    scrollTo({ top, behavior: "instant" });
  else {
    root.scrollTop = top;
    root.dispatchEvent(new Event("scroll", { bubbles: true }));
  }
}

function findSearchNextPageControl() {
  const selectors = [
      'a[rel="next"]',
      '[class*=pagination] a[class*=next]',
      '[class*=pagination] button[class*=next]',
      '[class*=pagination] [aria-label*=下一页]',
      '[class*=pagination] [title*=下一页]',
      '[class*=pager] a[class*=next]',
      '[class*=pager] button[class*=next]',
      '[class*=paging] a[class*=next]',
      '[class*=paging] button[class*=next]',
      '[class*=page] [aria-label*=下一页]',
      '[class*=page] [title*=下一页]',
      'a[aria-label*=下一页]',
      'button[aria-label*=下一页]',
      'a[title*=下一页]',
      'button[title*=下一页]',
    ],
    paginationRoots = [...document.querySelectorAll('[class*=pagination],[class*=pager],[class*=paging],[class*=pagebar],[role=navigation]')]
      .filter((root) => [...root.querySelectorAll('a,button,[role=button],li,div,span')]
        .filter((node) => /^\d+$/.test(cleanText(node.textContent))).length >= 2),
    candidates = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))].flatMap((element) => {
      const label = cleanText([
          element.textContent,
          element.getAttribute("title"),
          element.getAttribute("aria-label"),
          element.getAttribute("rel"),
          element.className,
        ].filter(Boolean).join(" ")),
        rect = element.getBoundingClientRect(),
        semantic = /下一页|下一頁|next/i.test(label);
      if (rect.width <= 8 || rect.height <= 8 || !semantic) return [];
      const disabled = element.getAttribute("aria-disabled") === "true" ||
        /disabled|forbidden/.test(String(element.className || ""));
      if (disabled) return [];
      const paginationParent = element.closest(
        '[class*=pagination],[class*=pager],[class*=paging],[class*=pagebar],[role=navigation]',
      );
      if (!paginationParent) return [];
      const clickable = element.closest("a,button,[role=button]") || element;
      const anchor = clickable.closest("a[href]");
      if (anchor && /^https?:/i.test(anchor.href || "")) {
        const target = new URL(anchor.href, location.href);
        if (target.hostname !== location.hostname) return [];
      }
      return [{ element: clickable, score: 100 + rect.top / 10000 }];
    });
  const pageNumber = (url) => Number(["beginPage", "page", "pageNo", "pageNum", "currentPage", "p"]
      .map((key) => url.searchParams.get(key)).find(Boolean)),
    currentUrl = new URL(location.href),
    activePage = paginationRoots.flatMap((root) => [...root.querySelectorAll('[aria-current=page],[class*=active],[class*=current],[class*=selected]')])
      .map((node) => Number(cleanText(node.textContent))).find(Number.isFinite),
    currentPage = pageNumber(currentUrl) || activePage || 1;
  for (const root of paginationRoots) {
    for (const anchor of root.querySelectorAll('a[href]')) {
      const target = new URL(anchor.href, location.href), targetPage = pageNumber(target);
      const rect = anchor.getBoundingClientRect();
      if (target.hostname !== location.hostname || !Number.isFinite(targetPage) || targetPage <= currentPage || rect.width <= 8 || rect.height <= 8) continue;
      candidates.push({ element: anchor, score: 90 - (targetPage - currentPage) });
    }
    // 1688 also renders icon-only SPA pagination buttons without a useful URL.
    // Only accept the first enabled control after the active page inside the
    // verified pagination container, never an arbitrary page arrow.
    const controls = [...root.querySelectorAll('a,button,[role=button]')], activeIndex = controls.findIndex((node) =>
      node.getAttribute("aria-current") === "page" || /active|current|selected/.test(String(node.className || "")));
    if (activeIndex >= 0) {
      const nextControl = controls.slice(activeIndex + 1).find((node) => {
        const rect = node.getBoundingClientRect(), label = cleanText(`${node.textContent || ""} ${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""} ${node.className || ""}`);
        return rect.width > 8 && rect.height > 8 && node.getAttribute("aria-disabled") !== "true" && !/disabled|forbidden/.test(String(node.className || "")) && (!/^\d+$/.test(label) || Number(label) > currentPage);
      });
      if (nextControl) candidates.push({ element: nextControl, score: 80 });
    }
    const nextPageNumber = String(currentPage + 1);
    const numberedControl = [...root.querySelectorAll('a,button,[role=button],li,div,span')]
      .filter((node) => cleanText(node.textContent) === nextPageNumber)
      .map((node) => node.closest('a,button,[role=button]') || node)
      .find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 8 && rect.height > 8 && node.getAttribute("aria-disabled") !== "true" && !/disabled|forbidden/.test(String(node.className || ""));
      });
    if (numberedControl) candidates.push({ element: numberedControl, score: 110 });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.element || null;
}

async function settleSearchResultsAtBottom(scrollRoot, maxRounds = 12) {
  let previousHeight = -1, previousCount = -1, stableRounds = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    moveSearchScroll(scrollRoot, scrollRoot.scrollHeight);
    await wait(1800);
    const height = scrollRoot.scrollHeight,
      count = extractSearchItems().length;
    stableRounds = height === previousHeight && count === previousCount ? stableRounds + 1 : 0;
    previousHeight = height;
    previousCount = count;
    if (stableRounds >= 4) break;
  }
}

async function hydrateSearchResults(targetCount = 30) {
  const accumulated = new Map();
  let previousCount = 0, stableRounds = 0;
  const startedAt = performance.now(), minimumLoadWindow = 20_000, maximumLoadWindow = 55_000;
  const scrollRoot = searchResultsScrollRoot();
  moveSearchScroll(scrollRoot, 0);
  await wait(2500);
  for (let round = 0; round < 50; round += 1) {
    for (const item of extractSearchItems())
      accumulated.set(item.externalId || item.sourceUrl, item);
    const viewport = scrollRoot === document.scrollingElement || scrollRoot === document.documentElement || scrollRoot === document.body
        ? innerHeight : scrollRoot.clientHeight,
      currentTop = scrollRoot === document.scrollingElement || scrollRoot === document.documentElement || scrollRoot === document.body
        ? scrollY : scrollRoot.scrollTop,
      height = Math.max(scrollRoot.scrollHeight, viewport),
      nextTop = Math.min(Math.max(0, height - viewport), currentTop + viewport * 0.65);
    moveSearchScroll(scrollRoot, nextTop);
    await wait(1800);
    for (const item of extractSearchItems())
      accumulated.set(item.externalId || item.sourceUrl, item);
    const count = accumulated.size, nextHeight = Math.max(scrollRoot.scrollHeight, viewport),
      atBottom = nextTop >= Math.max(0, nextHeight - viewport - 4);
    stableRounds = atBottom && count === previousCount && nextHeight === height ? stableRounds + 1 : 0;
    previousCount = count;
    if (count >= Math.max(1, targetCount)) break;
    if (stableRounds >= 8 && performance.now() - startedAt >= minimumLoadWindow) break;
    if (performance.now() - startedAt >= maximumLoadWindow) break;
  }
  return [...accumulated.values()];
}

async function applySearchFilters(filters) {
  const changed = [];
  const missing = [];
  const expandSearchFilters = async () => {
    const controls = [...document.querySelectorAll("button,a,[role=button]")]
      .filter((node) => visibleElement(node))
      .map((node) => ({
        node,
        label: cleanText(`${node.textContent || ""} ${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`),
      }));
    const control = controls.find(({ node, label }) =>
      node.getAttribute("aria-expanded") === "false" && /筛选|更多条件|全部条件/.test(label)) ||
      controls.find(({ label }) => /^(?:展开筛选|展开条件|更多筛选|更多条件|全部筛选)$/.test(label));
    if (!control) return false;
    control.node.scrollIntoView({ block: "center", behavior: "instant" });
    control.node.click();
    await wait(800);
    changed.push("展开筛选");
    return true;
  };
  const clickText = (label) => {
    const node = [...document.querySelectorAll("a,button,label,[role=button],span")]
      .filter((item) => visibleElement(item))
      .find((item) => cleanText(item.textContent) === label);
    if (!node) {
      missing.push(label);
      return false;
    }
    (node.closest("a,button,label,[role=button]") || node).click();
    changed.push(label);
    return true;
  };
  const visibleElement = (node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const fillNear = (label, values) => {
    const labelNode = [...document.querySelectorAll("div,span,label")]
      .filter(visibleElement)
      .find((node) => cleanText(node.textContent) === label);
    if (!labelNode) return;
    let container = labelNode.parentElement;
    for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
      const inputs = [...container.querySelectorAll("input")].filter(visibleElement);
      if (inputs.length >= values.filter(Boolean).length) {
        values.forEach((value, index) => {
          if (!value || !inputs[index]) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(inputs[index], String(value));
          inputs[index].dispatchEvent(new Event("input", { bubbles: true }));
          inputs[index].dispatchEvent(new Event("change", { bubbles: true }));
        });
        changed.push(label);
        return;
      }
    }
  };
  await expandSearchFilters();
  if (filters.sort && filters.sort !== "综合") clickText(filters.sort);
  fillNear("价格", [filters.priceMin, filters.priceMax]);
  fillNear("起订量", [filters.minOrder]);
  fillNear("店铺商品数", [filters.shopProductMin, filters.shopProductMax]);
  for (const value of [filters.region, filters.merchantFeature, filters.businessMode])
    if (value) {
      clickText(String(value));
      await wait(300);
    }
  for (const flag of Array.isArray(filters.flags) ? filters.flags : []) {
    clickText(String(flag));
    await wait(300);
  }
  for (const value of [filters.encryptedWaybill, filters.latePickupCompensation])
    if (value) {
      clickText(String(value));
      await wait(300);
    }
  const rateSelections = [
    ["24H支揽率", filters.pickup24Rate],
    ["48H支揽率", filters.pickup48Rate],
  ];
  for (const [label, value] of rateSelections) {
    if (!value) continue;
    if (clickText(label)) {
      await wait(350);
      clickText(String(value));
    }
  }
  if (filters.mergeSuppliers) clickText("合并供应商");
  return { changed, missing };
}

async function extractDetails(source, factsOnly = false) {
  // background gives one page command 90s. Keep a safety margin so a large SKU
  // matrix can return partial, attributable data instead of losing the whole Offer.
  const detailDeadline = Date.now() + 70000;
  const detailBudgetAvailable = () => Date.now() < detailDeadline;
  const embeddedState = extractEmbeddedOfferState(),
    embeddedFacts = embeddedOfferFacts(embeddedState),
    structuredVariants = embeddedSkuVariants(embeddedState, source.externalId);
  await hydrateDetailPage();
  const materialPreviewTitle = embeddedFacts.title ? null : await extractMaterialPreviewTitle();
  const productReviewFacts = await extractProductReviewFacts(embeddedFacts.review);
  const bodyText = cleanText(document.body.innerText),
    supplierName = embeddedFacts.supplierName || extractSupplierName(),
    pageTitle = embeddedFacts.title || materialPreviewTitle || extractPageTitle(supplierName),
    titleBadgeFacts = embeddedFacts.hasSelectionTitle == null
      ? fixedTitleBadgeFacts(pageTitle)
      : { hasSelectionTitle: embeddedFacts.hasSelectionTitle, selectionTitle: embeddedFacts.selectionTitle },
    pageImage = embeddedFacts.mainImages[0] ||
      document.querySelector('meta[property="og:image"]')?.content ||
      document.querySelector('meta[name="og:image"]')?.content ||
      null,
    fulfillmentModule = smallestModule({
      anchorPattern: /送至/,
      requiredPatterns: [/运费|包邮/, /退货|包赔|必赔|预计|承诺/],
      maxDepth: 8,
    }) || smallestModule({
      anchorPattern: /退货包运费|品质不符包赔|晚发必赔|晚到必赔/,
      requiredPatterns: [/运费|送至|预计|承诺/],
      maxDepth: 8,
    }),
    fulfillmentText = fulfillmentModule?.text || "",
    shippingText = /运费\s*[¥￥]\s*(\d+(?:\.\d+)?)\s*起?/.exec(fulfillmentText)?.[1],
    pricingContext = {
      shippingFee: null,
      shippingQuote: shippingText ? Number(shippingText) : null,
      promotionDiscount: null,
      promotionText: /新人价|店铺优惠|券后价/.test(bodyText)
        ? "页面存在活动优惠，需在结算页核实"
        : null,
      shippingScope: shippingText ? "OFFER_QUOTE_ADDRESS_DEPENDENT" : "UNKNOWN",
    };

  const metricNumber = (pattern) => {
      const match = pattern.exec(bodyText);
      if (!match) return null;
      const value = Number(match[1]);
      if (!Number.isFinite(value)) return null;
      return Math.round(value * (match[2] === "万" ? 10000 : 1));
    },
    percentValue = (pattern) => {
      const value = Number(pattern.exec(bodyText)?.[1]);
      return Number.isFinite(value) ? value : null;
    },
    textValue = (pattern) => cleanText(pattern.exec(bodyText)?.[1] || "") || null,
    shopHeaderAnchor = supplierName
      ? [...document.querySelectorAll("div,span,h1,h2,h3,h4")].find((node) => cleanText(node.textContent) === supplierName)
      : null,
    shopHeaderModule = (() => {
      let node = shopHeaderAnchor;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const text = cleanText(node.innerText);
        if (/品质达标率|供应链/.test(text) && /入驻|经营|主营/.test(text)) return node;
      }
      return shopHeaderAnchor?.parentElement ?? null;
    })(),
    shopHeaderText = cleanText(shopHeaderModule?.innerText),
    shopHeaderEvidence = [
      shopHeaderText,
      ...[...(shopHeaderModule?.querySelectorAll("img,[title],[aria-label]") ?? [])].flatMap((node) => [
        node.getAttribute("alt"),
        node.getAttribute("title"),
        node.getAttribute("aria-label"),
      ]),
    ].filter(Boolean).join(" "),
    merchantFeatures = [...new Set([
      ...(embeddedFacts.merchantFeatures || []),
      ...[...shopHeaderEvidence.matchAll(/(源头旗舰|超级工厂|全球供|实力工厂|实力商家|深度验厂|源头工厂|诚信通商家)/g)].map((match) => match[1]),
    ])].join(" · ") || null,
    merchantType = merchantFeatures,
    couponText = textValue(/((?:满\s*\d+(?:\.\d+)?\s*减\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*元优惠券|领券(?:立减)?\s*\d+(?:\.\d+)?\s*元))/),
    galleryImages = embeddedFacts.mainImages.length ? embeddedFacts.mainImages : visibleImageUrls(
      "[class*=gallery] img,[class*=preview] img,[class*=thumbnail] img,[class*=main-image] img,[class*=image-list] img",
    ).filter((url) => !/avatar|logo|icon|qrcode|badge|label|tfs\/|gw\.alicdn/i.test(url)),
    detailImages = visibleImageUrls(
      "[class*=detail] img,[class*=desc] img,[class*=content] img,[class*=description] img",
    ).filter((url) => !/avatar|logo|icon|qrcode/i.test(url)),
    productAttributes = extractProductAttributes(),
    productCategory = embeddedFacts.productCategory || ["产品类别", "产品类目", "商品类目", "类目", "品类"]
      .map((key) => cleanText(productAttributes[key]))
      .find(Boolean) || null,
    priceScopes = [...document.querySelectorAll("div,section")]
      .map((node) => cleanText(node.innerText))
      .filter((text) => text.length >= 8 && text.length <= 500 && /[¥￥]\s*\d/.test(text) && /(?:起批|起订)/.test(text))
      .filter((text) => !/密文代发|一件代发价|新人价|新人专享/.test(text))
      .sort((a, b) => {
        const aHasRange = /[¥￥]\s*\d+(?:\.\d+)?\s*(?:～|~|至|—|–|-)\s*[¥￥]?\s*\d/.test(a);
        const bHasRange = /[¥￥]\s*\d+(?:\.\d+)?\s*(?:～|~|至|—|–|-)\s*[¥￥]?\s*\d/.test(b);
        return Number(bHasRange) - Number(aHasRange) || a.length - b.length;
      })
      .slice(0, 8),
    dropshipAnchor = [...document.querySelectorAll("div,span,h1,h2,h3,h4")].find((node) => cleanText(node.textContent) === "密文代发"),
    dropshipModule = document.querySelector(".module-od-consign") || (() => {
      let node = dropshipAnchor;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const text = cleanText(node.innerText);
        if (/近\s*30\s*(?:天|日)代发|代发品质|铺货分销商/.test(text)) return node;
      }
      return dropshipAnchor?.parentElement ?? null;
    })(),
    dropshipText = cleanText(dropshipModule?.innerText),
    capabilities = {
      dropshipping: /一件代发|代发下单|立即铺货/.test(dropshipText) ? true : null,
      encryptedDropshipping: /密文代发/.test(dropshipText) ? true : null,
      returnShipping: /退货包运费/.test(fulfillmentText) ? true : null,
      onePiecePrice: /1件价格|1件起批|1件起订/.test(dropshipText) ? true : null,
    },
    dropshipPlatformNodes = [...(dropshipModule?.querySelectorAll("img,[title],[aria-label]") ?? [])]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const anchorRect = dropshipAnchor?.getBoundingClientRect();
        return !anchorRect || (Math.abs(rect.top - anchorRect.top) < 120 && rect.left >= anchorRect.left - 20);
      }),
    salesMetric = parseDisplayMetric(/(?:近\s*30\s*(?:天|日)(?:销量|成交)|月销|已售)\s*[：:]?\s*(\d+(?:\.\d+)?)(万)?(\+)?/, bodyText),
    dropshipMetric = parseDisplayMetric(/近\s*30\s*(?:天|日)代发(?:数量|量)?\s*[：:]?\s*(\d+(?:\.\d+)?)(万)?(\+)?/, dropshipText),
    dropship7DayMetric = parseDisplayMetric(/近\s*7\s*(?:天|日)代发(?:数量|量)?\s*[：:]?\s*(\d+(?:\.\d+)?)(万)?(\+)?/, dropshipText),
    downstreamListingMetric = parseDisplayMetric(/(?:下游铺货数|铺货商品数)\s*[：:]?\s*(\d+(?:\.\d+)?)(万)?(\+)?/, dropshipText),
    distributorMetric = parseDisplayMetric(/铺货分销商(?:数)?\s*[：:]?\s*(\d+(?:\.\d+)?)(万)?(\+)?/, dropshipText),
    offerPriceFacts = extractOfferPriceFacts(bodyText, priceScopes),
    decisionFacts = {
      pickup24Rate: dropshipText ? (() => { const value = Number(/24\s*(?:H|小时)\s*(?:揽收|支揽|发货)率\s*(\d+(?:\.\d+)?)%/i.exec(dropshipText)?.[1]); return Number.isFinite(value) ? value : null; })() : null,
      pickup48Rate: dropshipText ? (() => { const value = Number(/48\s*(?:H|小时)\s*(?:揽收|支揽|发货)率\s*(\d+(?:\.\d+)?)%/i.exec(dropshipText)?.[1]); return Number.isFinite(value) ? value : null; })() : null,
      shippingOrigin: cleanText(
        /(?:发货地|发货地址)\s*[：:]?\s*([^\s，,；;]{2,20})/.exec(fulfillmentText)?.[1] ||
        /([\u4e00-\u9fa5]{2,12})\s*送至\s*[\u4e00-\u9fa5]{2,20}/.exec(fulfillmentText)?.[1]
      ) || null,
      estimatedDelivery: cleanText(/((?:承诺|预计)\s*\d+\s*天[^，。；;|]{0,24}?(?:送达|到达|达))/.exec(fulfillmentText)?.[1]) || null,
      lateDeliveryCompensation: /晚到必赔|晚发必赔/.test(fulfillmentText) ? true : null,
      fastRefund: /极速退款/.test(fulfillmentText) ? true : null,
      dropshipQualityRate: dropshipText ? (() => { const value = Number(/代发品质(?:达标)?率\s*(\d+(?:\.\d+)?)%/.exec(dropshipText)?.[1]); return Number.isFinite(value) ? value : null; })() : null,
      dropship30DayVolume: dropshipMetric.value,
      dropship30DayVolumeDisplay: dropshipMetric.display,
      dropship7DayVolume: dropship7DayMetric.value,
      dropship7DayVolumeDisplay: dropship7DayMetric.display,
      downstreamListingCount: downstreamListingMetric.value,
      downstreamListingCountDisplay: downstreamListingMetric.display,
      distributorCount: distributorMetric.value,
      distributorCountDisplay: distributorMetric.display,
      dropshipBuyerRetentionRate: (() => { const value = Number(/代发买家留货率\s*(\d+(?:\.\d+)?)%/.exec(dropshipText)?.[1]); return Number.isFinite(value) ? value : null; })(),
      dropshipHeat: cleanText(/商家代发热度\s*[：:]?\s*([^\s，,；;]{1,20})/.exec(dropshipText)?.[1]) || null,
      dropshipRank: cleanText(/([^\n。；;]{2,30}代发商家榜\s*第\s*\d+\s*名)/.exec(dropshipText)?.[1]) || null,
      dropshipPlatforms: (() => {
        const labeled = cleanText(/(?:支持平台|代发平台)\s*[：:]?\s*([^。；;]{2,100})/.exec(dropshipText)?.[1]);
        if (labeled) return labeled;
        const aliases = [
          ["淘宝", /淘宝|taobao|tb(?:icon)?/i],
          ["拼多多", /拼多多|pinduoduo|pdd/i],
          ["京东", /京东|jingdong|jd(?:icon)?/i],
          ["抖音", /抖音|douyin|tiktok/i],
          ["快手", /快手|kuaishou|kwai/i],
          ["天猫", /天猫|tmall/i],
          ["小红书", /小红书|xiaohongshu|redbook/i],
          ["视频号", /视频号|weixin.?channel|wechat.?channel/i],
        ];
        const platforms = dropshipPlatformNodes.flatMap((node) => {
          const evidence = [
            node.getAttribute("alt"),
            node.getAttribute("title"),
            node.getAttribute("aria-label"),
            node.getAttribute("src"),
            node.getAttribute("class"),
          ].filter(Boolean).join(" ");
          return aliases.filter(([, pattern]) => pattern.test(evidence)).map(([name]) => name);
        });
        return platforms.length ? [...new Set(platforms)].join("、") : null;
      })(),
      onePiecePrice: (() => { const value = Number(/(?:1\s*件(?:价格|包邮)?|一件代发价)\s*[：:]?\s*[¥￥]\s*(\d+(?:\.\d+)?)/.exec(dropshipText)?.[1]); return Number.isFinite(value) ? value : null; })(),
      ...productReviewFacts,
      qualityCompensation: /品质不符包赔|品质赔付/.test(fulfillmentText) ? true : null,
      inventoryStable: /库存稳定|近期无断供/.test(bodyText) ? true : null,
      recentStockout: /近期(?:断供|缺货)|近期有断供/.test(bodyText) ? true : null,
      merchantType,
      merchantFeatures,
      productCategory,
      productCategoryId: embeddedFacts.productCategoryId,
      hasSelectionTitle: titleBadgeFacts.hasSelectionTitle,
      selectionTitle: titleBadgeFacts.selectionTitle,
      merchantLevel: cleanText(/((?:一|二|三|四|五|六|七)星供应链)/.exec(shopHeaderText)?.[1]) || null,
      mainCategory: cleanText(/主营\s*[：:]?\s*([^\s，,；;|]{2,30})/.exec(shopHeaderText)?.[1]) || null,
      shopPickup48Rate: (() => { const value = Number(/48\s*(?:H|小时)\s*支揽率\s*(\d+(?:\.\d+)?)%/i.exec(shopHeaderText)?.[1]); return Number.isFinite(value) ? value : null; })(),
      sampleSupported: /(?:支持拿样|申请拿样|申请样品|样品服务)/.test(bodyText) ? true : null,
      newcomerOffer: /(?:新人首单优惠|新人专享|新人价)/.test(bodyText) ? true : null,
      ...offerPriceFacts,
      firstOrderOffer: /(?:首单优惠|新客首单)/.test(bodyText) ? true : null,
      couponText,
      salesCount: salesMetric.value,
      salesDisplay: salesMetric.display,
    };
  const skuImages = visibleImageUrls(
    '[class*="sku"] img, [class*="spec"] img, [class*="sale-prop"] img, [class*="sku-item"] img',
  ).filter((url) => !galleryImages.includes(url));

  if (factsOnly) {
    const moqText = /(\d+)\s*(?:件|个|只|套)\s*(?:起批|起订|起)/.exec(
        bodyText,
      )?.[1],
      minOrderQuantity = moqText ? Number(moqText) : null,
      stockText = /(?:库存|可售)\s*[：:]?\s*(\d+)/.exec(bodyText)?.[1],
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
        shopAge: Number(/(?:入驻|经营|诚信通)\s*(\d+)\s*年/.exec(bodyText)?.[1]) || null,
        qualityRate:
          Number(/品质达标率\s*(\d+(?:\.\d+)?)%/.exec(bodyText)?.[1]) || null,
        repurchaseRate: embeddedFacts.storeRepurchaseRate ||
          Number(/(?:店铺)?回头率\s*(\d+(?:\.\d+)?)%/.exec(bodyText)?.[1]) ||
          null,
        deliveryRate: decisionFacts.shopPickup48Rate,
        ...decisionFacts,
        ...criticalPageRuleFacts(bodyText),
        stock: stockText ? Number(stockText) : null,
        imageCount: galleryImages.length || (pageImage ? 1 : null),
        hasVideo:
          Boolean(document.querySelector("video")) ||
          /(?:主图视频|商品视频)/.test(bodyText)
            ? true
            : null,
        inspection: null,
      };
    return {
      offerId: source.id,
      externalId: source.externalId,
      title: pageTitle,
      imageUrl: pageImage,
      supplierName,
      parserVersion: chrome.runtime.getManifest().version,
      capabilities,
      pricingContext,
      offerFacts,
      detailImages,
      mainImages: galleryImages,
      skuImages,
      productAttributes,
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
  for (let attempt = 0; !structuredVariants.length && attempt < 12; attempt += 1) {
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
  const variants = [...structuredVariants];
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
  const sectionLabels = (structuredVariants.length ? [] : [...document.querySelectorAll("div,span,label")])
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
    // 没有识别到真实“颜色/款式/型号”模块时，禁止把整页商品图、详情图
    // 当成 SKU 逐个点击；此类页面交给 directSkuRows/textSpecRows 解析。
    colorOptions = scoped.length >= 2 ? scoped : colorLabel ? global : [];
    if (colorOptions.length >= 2) break;
    if (!colorLabel) break;
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
  const directSkuRows = () => {
    const hasPair = (text) =>
        /[¥￥]\s*\d+(?:\.\d+)?/.test(text) &&
        /(?:库存|可售|可售库存|剩余)\s*[：:]?\s*\d+/.test(text),
      candidates = [...document.querySelectorAll("li,div,[role=button]")].filter(
        (node) => {
          const text = readable(node.innerText), rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height >= 24 && rect.height < 150 &&
            text.length >= 6 && text.length < 220 && hasPair(text) && !noise.test(text);
        },
      );
    return candidates.filter(
      (node) => ![...node.children].some((child) => hasPair(readable(child.innerText))),
    );
  };
  // 1688 新版会把已选 SKU 的名称、价格和库存拆到不同节点。
  // 每次点击后，只在规格模块范围内分别读取价格与库存并绑定当前 SourceSKU。
  const selectedSkuState = () => {
    const orderButton = [...document.querySelectorAll("button")].find((node) =>
        /^(?:立即下单|加采购车)$/.test(readable(node.innerText)),
      ),
      purchaseModule = (() => {
        let node = orderButton?.parentElement ?? null,
          best = null;
        for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
          const text = readable(node.innerText);
          if (text.length < 12000 && /[¥￥]\s*\d/.test(text)) best = node;
          if (text.length >= 12000) break;
        }
        return best;
      })(),
      root = purchaseModule ?? document,
      evidence = [...root.querySelectorAll("div,span,li,[role=button]")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (!specLabel) return true;
        return rect.top >= colorTop - 80 && rect.top < specBottom + 520;
      })
      .map((node) => ({
        node,
        text: readable(node.innerText || node.textContent),
        rect: node.getBoundingClientRect(),
      }))
      .filter((item) => item.text && item.text.length < 320),
      stockEvidence = evidence
        .filter((item) => /(?:库存|可售|可售库存|剩余)\s*[：:]?\s*\d+/.test(item.text))
        .sort((a, b) => a.text.length - b.text.length)[0],
      coupledText = stockEvidence
        ? (() => {
            let node = stockEvidence.node;
            for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
              const text = readable(node.innerText);
              if (text.length < 700 && /[¥￥]\s*\d/.test(text)) return text;
            }
            return stockEvidence.text;
          })()
        : "",
      compact = [...new Set(evidence.map((item) => item.text))].join(" "),
      priceMatches = [...(coupledText || compact).matchAll(/[¥￥]\s*(\d+(?:\.\d+)?)/g)],
      priceMatch = priceMatches.at(-1) ?? null,
      stockMatch = /(?:库存|可售|可售库存|剩余)\s*[：:]?\s*(\d+)/.exec(
        stockEvidence?.text ?? compact,
      );
    return {
      price: priceMatch ? Number(priceMatch[1]) : null,
      stock: stockMatch ? Number(stockMatch[1]) : null,
      rawPriceText: priceMatch?.[0] ?? null,
      contextText: coupledText,
    };
  };
  const waitForSelectedSkuState = async (expectedName = "") => {
    const matchesSelection = (state) => {
        if (!expectedName) return true;
        const normalized = readable(expectedName).replace(/[【】\[\]()（）]/g, "");
        const tokens = normalized.split(/[\s/]+/).filter((token) => token.length >= 2);
        const context = readable(state?.contextText);
        return tokens.length === 0 || (context && tokens.every((token) => context.includes(token)));
      },
      empty = { price: null, stock: null, rawPriceText: null, contextText: "" };
    let current = selectedSkuState(),
      best = matchesSelection(current) ? current : empty;
    for (let attempt = 0; attempt < 5 && detailBudgetAvailable(); attempt += 1) {
      if (best.price != null && best.stock != null) break;
      await wait(250);
      current = selectedSkuState();
      if (!matchesSelection(current)) continue;
      best = {
        price: current.price ?? best.price,
        stock: current.stock ?? best.stock,
        rawPriceText: current.rawPriceText ?? best.rawPriceText,
        contextText: current.contextText ?? best.contextText,
      };
    }
    return best;
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
  const visibleSkuRows = variants.length ? [] : directSkuRows();
  if (!variants.length && visibleSkuRows.length >= 2) {
    for (const row of visibleSkuRows.slice(0, 80)) {
      const local = readable(row.innerText),
        pair = /[¥￥]\s*(\d+(?:\.\d+)?)[\s\S]{0,100}?(?:库存|可售|可售库存|剩余)\s*[：:]?\s*(\d+)/.exec(local);
      if (!pair) continue;
      const variantName = local
        .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, "")
        .replace(/(?:库存|可售|可售库存|剩余)\s*[：:]?\s*\d+\s*个?/g, "")
        .replace(/(?:^|\s)[−-]\s*\d+\s*\+\s*$/g, "")
        .replace(/(?:^|\s)[-+]?\s*\d+\s*$/g, "")
        .replace(/^(?:颜色|款式|型号|规格|尺寸)\s*/, "")
        .trim();
      if (!variantName || noise.test(variantName)) continue;
      const imageNode = row.querySelector?.("img");
      variants.push({
        sourceVariantId: `${source.externalId}:row:${variants.length + 1}`,
        variantName,
        specValues: [variantName],
        rawSpecText: variantName,
        rawPriceText: `¥${pair[1]}`,
        price: Number(pair[1]),
        stock: Number(pair[2]),
        image: imageNode?.currentSrc || imageNode?.src || null,
        minOrderQuantity: null,
        priceSource: "SKU_PRICE",
        nodeType: "SKU_SPEC",
      });
    }
  }
  const hasChildOptions = colorOptions.length >= 2;
  if (!variants.length && hasChildOptions) {
    reportReviewParseStatus("正在解析 SourceSKU");
    for (const [
      colorName,
      { node: colorNode, image: colorImage },
    ] of colorOptions) {
      if (!detailBudgetAvailable()) break;
      try {
        colorImage.click();
        await wait(500);
      } catch {}
      const selectedColorState = await waitForSelectedSkuState(colorName),
        directRow = rowFor(colorImage),
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
          rawSingleSpecName =
            (sizeRows.length === 1
              ? readable(sizeRows[0].innerText)
              : textSnapshot?.name ?? "")
              .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, "")
              .replace(/(?:库存|可售)\s*\d+\s*个?/g, "")
              .replace(/[-+]?\s*\d+\s*$/, "")
              .replace(/^(?:规格|尺寸)\s*/, "")
              .trim(),
          primaryOptionMentions = colorOptions.filter(([name]) =>
            rawSingleSpecName.includes(name),
          ).length,
          singleSpecName =
            rawSingleSpecName &&
            !/^(?:如图[.。]?|默认(?:规格)?|标准(?:规格)?|均码|单一规格|其他)$/i.test(
              rawSingleSpecName,
            ) &&
            primaryOptionMentions <= 1
              ? rawSingleSpecName
              : null,
          variantName = singleSpecName
            ? `${colorName} / ${singleSpecName}`
            : colorName,
          image = colorImage.currentSrc || colorImage.src || null,
          price =
            textSnapshot?.price ??
            (rowSnapshot ? Number(rowSnapshot[1]) : selectedColorState.price),
          stock =
            textSnapshot?.stock ??
            (rowSnapshot ? Number(rowSnapshot[2]) : selectedColorState.stock);
        variants.push({
          sourceVariantId: `${source.externalId}:${variants.length + 1}`,
          variantName,
          specValues: singleSpecName
            ? [colorName, singleSpecName]
            : [colorName],
          rawSpecText: variantName,
          rawPriceText: price == null ? null : selectedColorState.rawPriceText ?? `¥${price}`,
          price,
          stock,
          image,
          minOrderQuantity: null,
          priceSource: price == null ? "UNKNOWN" : "SKU_PRICE",
          nodeType: "SKU_SPEC",
        });
        continue;
      }
      for (const sizeNode of sizeRows.slice(0, 40)) {
        if (!detailBudgetAvailable()) break;
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
          await wait(350);
        } catch {}
        const selectedSizeState = await waitForSelectedSkuState(
          `${colorName} ${sizeName}`,
        ),
          image = colorImage.currentSrc || colorImage.src || null,
          variantName = `${colorName} / ${sizeName}`;
        variants.push({
          sourceVariantId: `${source.externalId}:${variants.length + 1}`,
          variantName,
          specValues: [colorName, sizeName],
          rawSpecText: variantName,
          rawPriceText: selectedSizeState.rawPriceText ?? `¥${paired[1]}`,
          price: selectedSizeState.price ?? Number(paired[1]),
          stock: selectedSizeState.stock ?? Number(paired[2]),
          image,
          minOrderQuantity: null,
          priceSource: "SKU_PRICE",
          nodeType: "SKU_SPEC",
        });
      }
    }
  }
  if (!variants.length) {
    for (const spec of textSpecRows()) {
      variants.push({
        sourceVariantId: `${source.externalId}:${variants.length + 1}`,
        variantName: spec.name,
        specValues: [spec.name],
        rawSpecText: spec.name,
        rawPriceText: `¥${spec.price}`,
        price: spec.price,
        stock: spec.stock,
        image: null,
        minOrderQuantity: null,
        priceSource: "SKU_PRICE",
        nodeType: "SKU_SPEC",
      });
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
      if (!detailBudgetAvailable()) break;
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
      const selectedState = await waitForSelectedSkuState(variantName),
        paired = rowValues,
        priceText = selectedState.price ?? (paired ? Number(paired[1]) : null),
        stockText = selectedState.stock ?? (paired ? Number(paired[2]) : null),
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
        rawPriceText: priceText == null ? null : selectedState.rawPriceText ?? `¥${priceText}`,
        price: priceText,
        stock: stockText,
        image,
        minOrderQuantity: null,
        priceSource: priceText == null ? "UNKNOWN" : "SKU_PRICE",
        nodeType: "SKU_SPEC",
      });
    }
  if (!detailBudgetAvailable()) reportReviewParseStatus("SourceSKU解析达到时间上限，已保存可用数据");
  // SourceSKU 暂时无法完整展开时仍保存 Offer 级详情；不能让 SKU 解析阻塞
  // 价格、供应商、履约、店铺和素材等横向比较字段的回填。
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
      shopAge: Number(/(?:入驻|经营|诚信通)\s*(\d+)\s*年/.exec(bodyText)?.[1]) || null,
      qualityRate:
        Number(/品质达标率\s*(\d+(?:\.\d+)?)%/.exec(bodyText)?.[1]) || null,
      repurchaseRate:
        Number(/(?:店铺)?回头率\s*(\d+(?:\.\d+)?)%/.exec(bodyText)?.[1]) ||
        null,
      deliveryRate: decisionFacts.shopPickup48Rate,
      ...decisionFacts,
      ...criticalPageRuleFacts(bodyText),
      stock: knownStocks.length
        ? knownStocks.reduce((sum, value) => sum + Number(value), 0)
        : null,
      imageCount: galleryImages.length || (pageImage ? 1 : null),
      hasVideo:
        Boolean(document.querySelector("video")) ||
        /(?:主图视频|商品视频)/.test(bodyText)
          ? true
          : null,
      inspection: null,
    };
  return {
    offerId: source.id,
    externalId: source.externalId,
    title: pageTitle,
    imageUrl: pageImage,
    supplierName,
    parserVersion: chrome.runtime.getManifest().version,
    capabilities,
    pricingContext,
    offerFacts,
    detailImages,
    mainImages: galleryImages,
    skuImages,
    productAttributes,
    variants,
    capturedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_DEFAULT_PUBLISH") {
    void startDefaultPublish()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : "默认模板铺货失败" }));
    return true;
  }
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
    void hydrateSearchResults(Number(message.targetCount) || 30)
      .then((items) => sendResponse({ items }))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : cleanText(JSON.stringify(error)) || "搜索卡片解析失败" }));
    return true;
  }
  if (message?.type === "APPLY_FILTERS") {
    void applySearchFilters(message.filters || {})
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          error:
            typeof error?.message === "string"
              ? error.message
              : JSON.stringify(error) || "筛选应用失败",
        }),
      );
    return true;
  }
  if (message?.type === "NEXT_PAGE") {
    const scrollRoot = searchResultsScrollRoot();
    void settleSearchResultsAtBottom(scrollRoot).then(() => {
      const next = findSearchNextPageControl();
      if (next) {
        next.scrollIntoView({ block: "center", behavior: "instant" });
        next.click();
        sendResponse({ moved: true, method: "verified_pagination_control" });
        return;
      }
      sendResponse({ moved: false, reason: "verified_pagination_control_not_found" });
    }).catch(() => {
      sendResponse({ moved: false, reason: "pagination_control_failed" });
    });
    return true;
  }
  if (message?.type === "EXTRACT_DETAILS") {
    void extractDetails(message.offer, message.factsOnly === true)
      .then((detail) => sendResponse({ detail }))
      .catch((error) => sendResponse({
        error: error instanceof Error ? error.message : cleanText(JSON.stringify(error)) || "货源详情解析失败",
      }));
    return true;
  }
});
