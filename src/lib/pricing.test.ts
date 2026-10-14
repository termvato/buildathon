import { describe, expect, it } from "vitest";
import { basketCsv, estimatePurchase, offerPurchase, optimiseBasket, unitAt, volumeCurve } from "./pricing";
import type { BomRow, Offer, Offers } from "./schemas";

const row = (part: string, qty: number, unit: number, moq: number | null = null): BomRow => ({
  part,
  supplier: "x",
  qty,
  unit_cost_gbp: unit,
  moq,
  price_basis: "",
  source_url: null,
  line_cost_gbp: qty * unit,
  first_order_gbp: unit * Math.max(qty, moq ?? 0),
});

const offer = (supplier: string, price: number, extra: Partial<Offer> = {}): Offer => ({
  supplier,
  url: `https://${supplier}.example/${price}`,
  title: `${supplier} listing`,
  unit_price_gbp: price,
  pack_qty: 1,
  price_breaks: [],
  in_stock: true,
  lead_time_days: null,
  ...extra,
});

describe("unitAt", () => {
  const breaks = [
    { min_qty: 1, unit_gbp: 10 },
    { min_qty: 10, unit_gbp: 8 },
    { min_qty: 100, unit_gbp: 5 },
  ];
  it("picks the highest break the quantity reaches", () => {
    expect(unitAt(breaks, 1)).toBe(10);
    expect(unitAt(breaks, 9)).toBe(10);
    expect(unitAt(breaks, 10)).toBe(8);
    expect(unitAt(breaks, 250)).toBe(5);
  });
  it("handles unsorted input and empty lists", () => {
    expect(unitAt([...breaks].reverse(), 50)).toBe(8);
    expect(unitAt([], 5)).toBeUndefined();
  });
});

describe("offerPurchase / estimatePurchase", () => {
  it("rounds up to whole packs", () => {
    const p = offerPurchase(offer("a", 1, { pack_qty: 10 }), 3);
    expect(p).toEqual({ orderQty: 10, unit: 1, cost: 10 });
  });
  it("applies MOQ when there is no listing", () => {
    const pcb = row("PCB", 1, 1.2, 5);
    expect(estimatePurchase(pcb, undefined, 1)).toEqual({ orderQty: 5, unit: 1.2, cost: 6 });
    expect(estimatePurchase(pcb, undefined, 8).orderQty).toBe(8);
  });
});

describe("optimiseBasket", () => {
  const bom = [row("Motor", 1, 5), row("Servo", 1, 5)];

  it("consolidates suppliers when shipping outweighs the price difference", () => {
    const offers: Offers = {
      mode: "parts",
      warnings: [],
      lines: [
        { line: 1, part: "Motor", volume_breaks: [], offers: [offer("cheap", 4), offer("hub", 5)] },
        { line: 2, part: "Servo", volume_breaks: [], offers: [offer("hub", 5)] },
      ],
      suppliers: [
        { name: "cheap", shipping_gbp: 4, free_over_gbp: null, delivery_days: 3 },
        { name: "hub", shipping_gbp: 3, free_over_gbp: null, delivery_days: 2 },
      ],
    };
    const b = optimiseBasket(bom, offers, 1);
    // cheapest-per-part: 4 + 5 + 4 + 3 shipping = 16; one supplier: 10 + 3 = 13
    expect(b.total).toBe(13);
    expect(b.orders.map((o) => o.supplier)).toEqual(["hub"]);
    expect(b.naiveTotal).toBe(16);
  });

  it("honours free-shipping thresholds and reports unsourced lines", () => {
    const offers: Offers = {
      mode: "parts",
      warnings: [],
      lines: [{ line: 1, part: "Motor", volume_breaks: [], offers: [offer("shop", 30)] }],
      suppliers: [{ name: "shop", shipping_gbp: 5, free_over_gbp: 25, delivery_days: 2 }],
    };
    const b = optimiseBasket(bom, offers, 1);
    expect(b.shipping).toBe(0);
    expect(b.unsourced.map((u) => u.part)).toEqual(["Servo"]);
    expect(b.unsourcedTotal).toBe(5);
    expect(basketCsv("Robot", b)).toContain('"(no listing found)","Servo"');
  });
});

describe("volumeCurve", () => {
  it("spreads MOQ over the run so per-unit cost falls with volume", () => {
    const bom = [row("PCB", 1, 1.2, 5)];
    const offers: Offers = { mode: "parts", warnings: [], suppliers: [], lines: [] };
    const curve = volumeCurve(bom, offers);
    expect(curve.map((c) => c.units)).toEqual([1, 10, 100, 1000]);
    expect(curve[0].perUnit).toBe(6); // 5 boards for 1 unit
    expect(curve[1].perUnit).toBe(1.2);
  });
});
