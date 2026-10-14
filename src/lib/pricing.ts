import type { BomRow, LineOffers, Offer, Offers, PriceBreak, SupplierInfo } from "@/lib/schemas";

export const VOLUMES = [1, 10, 100, 1000] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Per-piece price for buying `qty` pieces, given quantity breaks. */
export function unitAt(breaks: PriceBreak[], qty: number): number | undefined {
  const sorted = [...breaks].sort((a, b) => a.min_qty - b.min_qty);
  if (!sorted.length) return undefined;
  let price = sorted[0].unit_gbp;
  for (const b of sorted) if (qty >= b.min_qty) price = b.unit_gbp;
  return price;
}

export type Purchase = { orderQty: number; unit: number; cost: number };

/** Cost of covering `need` pieces from one listing (rounded up to whole packs). */
export function offerPurchase(o: Offer, need: number): Purchase {
  const orderQty = Math.ceil(need / o.pack_qty) * o.pack_qty;
  const unit = unitAt([{ min_qty: 1, unit_gbp: o.unit_price_gbp }, ...o.price_breaks], orderQty) ?? o.unit_price_gbp;
  return { orderQty, unit: r2(unit), cost: r2(unit * orderQty) };
}

/** Estimated cost when there is no listing: volume-break estimate, else the BOM unit cost; MOQ applied. */
export function estimatePurchase(line: BomRow, lo: LineOffers | undefined, need: number): Purchase {
  const orderQty = Math.max(need, line.moq ?? 0);
  const unit = unitAt(lo?.volume_breaks ?? [], orderQty) ?? line.unit_cost_gbp;
  return { orderQty, unit: r2(unit), cost: r2(unit * orderQty) };
}

/** Parts cost per finished unit when building `units` units. */
export function volumeCurve(bom: BomRow[], offers: Offers) {
  return VOLUMES.map((units) => {
    let total = 0;
    bom.forEach((line, i) => {
      const lo = offers.lines.find((l) => l.line === i + 1);
      const need = line.qty * units;
      const fromOffers = (lo?.offers ?? []).map((o) => offerPurchase(o, need).cost);
      const est = estimatePurchase(line, lo, need).cost;
      // One-off builds use real listings when we have them; at volume, distributor pricing applies.
      total += fromOffers.length ? (units === 1 ? Math.min(...fromOffers) : Math.min(est, ...fromOffers)) : est;
    });
    return { units, total: r2(total), perUnit: r2(total / units) };
  });
}

export type BasketLine = { line: number; part: string; offer: Offer; purchase: Purchase };
export type SupplierOrder = {
  supplier: string;
  lines: BasketLine[];
  subtotal: number;
  shipping: number;
  delivery_days: number | null;
};
export type Basket = {
  units: number;
  orders: SupplierOrder[];
  unsourced: { line: number; part: string; purchase: Purchase }[];
  items: number;
  shipping: number;
  total: number; // sourced items + shipping
  unsourcedTotal: number;
  maxDays: number | null;
  naiveTotal: number; // cheapest listing per part, shipping from every shop it touches
};

const shippingFor = (s: SupplierInfo | undefined, subtotal: number) =>
  !s ? 4.99 : s.free_over_gbp != null && subtotal >= s.free_over_gbp ? 0 : s.shipping_gbp;

/** Cheapest way to buy everything for `units` builds, shipping included (exhaustive over supplier subsets). */
export function optimiseBasket(bom: BomRow[], offers: Offers, units: number): Basket {
  const info = new Map(offers.suppliers.map((s) => [s.name.toLowerCase(), s]));
  const sup = (name: string) => info.get(name.toLowerCase());

  const sourced: { line: number; part: string; options: { offer: Offer; purchase: Purchase }[] }[] = [];
  const unsourced: Basket["unsourced"] = [];
  bom.forEach((line, i) => {
    const lo = offers.lines.find((l) => l.line === i + 1);
    const need = line.qty * units;
    const options = (lo?.offers ?? []).map((offer) => ({ offer, purchase: offerPurchase(offer, need) }));
    if (options.length) sourced.push({ line: i + 1, part: line.part, options });
    else unsourced.push({ line: i + 1, part: line.part, purchase: estimatePurchase(line, lo, need) });
  });

  const suppliers = [...new Set(sourced.flatMap((s) => s.options.map((o) => o.offer.supplier)))].slice(0, 14);

  const evaluate = (allowedSet: Set<string>) => {
    const orders = new Map<string, BasketLine[]>();
    for (const s of sourced) {
      const best = s.options
        .filter((o) => allowedSet.has(o.offer.supplier))
        .sort((a, b) => a.purchase.cost - b.purchase.cost)[0];
      if (!best) return null;
      orders.set(best.offer.supplier, [...(orders.get(best.offer.supplier) ?? []), { line: s.line, part: s.part, ...best }]);
    }
    let items = 0;
    let shipping = 0;
    const list: SupplierOrder[] = [...orders.entries()].map(([supplier, lines]) => {
      const subtotal = r2(lines.reduce((n, l) => n + l.purchase.cost, 0));
      const ship = shippingFor(sup(supplier), subtotal);
      items += subtotal;
      shipping += ship;
      return { supplier, lines, subtotal, shipping: ship, delivery_days: sup(supplier)?.delivery_days ?? null };
    });
    return { orders: list, items: r2(items), shipping: r2(shipping), total: r2(items + shipping) };
  };

  let best: ReturnType<typeof evaluate> = null;
  for (let mask = 1; mask < 1 << suppliers.length; mask++) {
    const set = new Set(suppliers.filter((_, i) => mask & (1 << i)));
    const res = evaluate(set);
    if (res && (!best || res.total < best.total || (res.total === best.total && res.orders.length < best.orders.length))) best = res;
  }
  const naive = evaluate(new Set(suppliers));
  const orders = (best?.orders ?? []).sort((a, b) => b.subtotal - a.subtotal);
  const days = orders.map((o) => o.delivery_days).filter((d): d is number => d != null);

  return {
    units,
    orders,
    unsourced,
    items: best?.items ?? 0,
    shipping: best?.shipping ?? 0,
    total: best?.total ?? 0,
    unsourcedTotal: r2(unsourced.reduce((n, u) => n + u.purchase.cost, 0)),
    maxDays: days.length ? Math.max(...days) : null,
    naiveTotal: naive?.total ?? 0,
  };
}

export function basketCsv(product: string, basket: Basket): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows: (string | number)[][] = [["Supplier", "BOM part", "Listing", "Order qty", "Unit GBP", "Line GBP", "URL"]];
  for (const o of basket.orders) {
    for (const l of o.lines) rows.push([o.supplier, l.part, l.offer.title, l.purchase.orderQty, l.purchase.unit, l.purchase.cost, l.offer.url]);
    rows.push([o.supplier, "Shipping (estimate)", "", "", "", o.shipping, ""]);
  }
  for (const u of basket.unsourced) rows.push(["(no listing found)", u.part, "estimate", u.purchase.orderQty, u.purchase.unit, u.purchase.cost, ""]);
  rows.push(["", `Total for ${basket.units} x ${product}`, "", "", "", (basket.total + basket.unsourcedTotal).toFixed(2), ""]);
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}
