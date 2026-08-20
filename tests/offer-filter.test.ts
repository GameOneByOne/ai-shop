import assert from "node:assert/strict";
import { filterOffer, type OfferFacts } from "../lib/sourcing/offer-filter.ts";

const complete: OfferFacts = {
  price: 5.9,
  onePieceDelivery: true,
  minOrderQuantity: 1,
  blindShipping: true,
  returnShipping: true,
  noReasonReturn: true,
  shopAge: 3,
  qualityRate: 100,
  repurchaseRate: 63,
  deliveryRate: 99,
  stock: 35_000,
  imageCount: 8,
  hasVideo: true,
  inspection: true,
};

assert.equal(filterOffer(complete).status, "PASS");
assert.deepEqual(filterOffer({ ...complete, onePieceDelivery: false }).hardFailures, ["不支持一件代发"]);
assert.equal(filterOffer({ ...complete, minOrderQuantity: 100 }).status, "REJECT");
assert.equal(filterOffer({ ...complete, price: null }).status, "REJECT");
assert.equal(filterOffer({ ...complete, stock: 49 }).status, "RISK");
assert.equal(filterOffer({ ...complete, stock: null }).status, "RISK");
assert.equal(filterOffer({ ...complete, onePieceDelivery: null }).status, "RISK");

console.log("OfferFilterEngine 回归通过");
