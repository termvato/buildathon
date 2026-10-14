"use client";

import { useMemo, useState } from "react";
import { basketCsv, optimiseBasket, VOLUMES, volumeCurve } from "@/lib/pricing";
import type { Offers, Teardown } from "@/lib/schemas";

const gbp = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 });
const vol = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));

export default function BuySection({ t, offers }: { t: Teardown; offers: Offers }) {
  if (offers.mode === "product") return <ProductListings offers={offers} />;
  return <PartsSourcing t={t} offers={offers} />;
}

function ProductListings({ offers }: { offers: Offers }) {
  const list = [...(offers.lines[0]?.offers ?? [])].sort((a, b) => a.unit_price_gbp - b.unit_price_gbp);
  if (!list.length) return <p className="mt-3 text-sm text-neutral-500">No priced listings found.</p>;
  return (
    <ul className="mt-3 divide-y divide-neutral-800/70 text-sm">
      {list.map((o, i) => (
        <li key={o.url} className="flex items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <a href={o.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
              {o.title}
            </a>
            <div className="text-xs text-neutral-500">
              {o.supplier}
              {o.in_stock === true && " · in stock"}
              {o.in_stock === false && " · out of stock"}
            </div>
          </div>
          <div className="shrink-0 text-right tabular-nums">
            {gbp(o.unit_price_gbp)}
            {i === 0 && <div className="text-xs text-emerald-400">Cheapest</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PartsSourcing({ t, offers }: { t: Teardown; offers: Offers }) {
  const [units, setUnits] = useState<number>(1);
  const curve = useMemo(() => volumeCurve(t.bom, offers), [t.bom, offers]);
  const basket = useMemo(() => optimiseBasket(t.bom, offers, units), [t.bom, offers, units]);
  const listed = offers.lines.filter((l) => l.offers.length).length;

  const downloadCsv = () => {
    const blob = new Blob([basketCsv(t.product, basket)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${t.product.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-x${units}-shopping-list.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mt-3 space-y-8">
      <p className="text-sm text-neutral-400">
        Live listings for <span className="text-neutral-200">{listed}</span> of {t.bom.length} parts. The rest are priced from estimates.
      </p>

      {/* Volume pricing */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">Parts cost per unit, by build volume</h4>
          <p className="mb-3 text-xs text-neutral-600">Parts only, excl. shipping. Price breaks and MOQs spread across the run. Estimates, click a bar to plan that volume.</p>
          <VolumeChart curve={curve} selected={units} onSelect={setUnits} />
          <table className="mt-3 w-full text-xs tabular-nums">
            <thead className="text-neutral-500">
              <tr>
                <th className="text-left font-medium">Units</th>
                {curve.map((c) => (
                  <th key={c.units} className="text-right font-medium">
                    {vol(c.units)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-neutral-300">
              <tr>
                <td className="text-neutral-500">Per unit</td>
                {curve.map((c) => (
                  <td key={c.units} className="text-right">
                    {gbp(c.perUnit)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-neutral-500">Total</td>
                {curve.map((c) => (
                  <td key={c.units} className="text-right">
                    {gbp(c.total)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Basket summary */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-neutral-500">Cheapest basket</h4>
            <div className="flex overflow-hidden rounded-lg border border-neutral-800 text-xs">
              {VOLUMES.map((v) => (
                <button
                  key={v}
                  onClick={() => setUnits(v)}
                  className={`px-2.5 py-1 ${v === units ? "bg-sky-500 text-black" : "text-neutral-400 hover:bg-neutral-900"}`}
                >
                  ×{vol(v)}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums">
            {gbp(basket.total + basket.unsourcedTotal)}
            <span className="ml-2 text-sm font-normal text-neutral-500">for {units} unit{units > 1 ? "s" : ""}</span>
          </p>
          <ul className="mt-2 space-y-1 text-sm text-neutral-400">
            <li>
              {basket.orders.length} supplier{basket.orders.length === 1 ? "" : "s"} · {gbp(basket.items)} parts + {gbp(basket.shipping)} shipping
            </li>
            {basket.unsourced.length > 0 && (
              <li>
                + {gbp(basket.unsourcedTotal)} estimated for {basket.unsourced.length} part{basket.unsourced.length > 1 ? "s" : ""} with no listing
              </li>
            )}
            {basket.maxDays != null && <li>Everything arrives in ~{basket.maxDays} days</li>}
            {basket.naiveTotal - basket.total > 0.5 && (
              <li className="text-emerald-400">
                Saves {gbp(basket.naiveTotal - basket.total)} vs buying each part at its cheapest shop
              </li>
            )}
          </ul>
          <button onClick={downloadCsv} className="mt-4 rounded-lg border border-sky-500/40 px-3 py-1.5 text-sm text-sky-300 hover:bg-sky-500/10">
            ⬇ Download shopping list (CSV)
          </button>
        </div>
      </div>

      {/* Orders per supplier */}
      <div>
        <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Shopping list, {units} unit{units > 1 ? "s" : ""}</h4>
        <div className="grid gap-3 md:grid-cols-2">
          {basket.orders.map((o) => (
            <div key={o.supplier} className="rounded-xl border border-neutral-800 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{o.supplier}</span>
                <span className="text-xs text-neutral-500">
                  {o.shipping === 0 ? "free shipping" : `${gbp(o.shipping)} shipping`}
                  {o.delivery_days != null && ` · ~${o.delivery_days}d`}
                </span>
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {o.lines.map((l) => (
                  <li key={l.line} className="flex justify-between gap-3">
                    <a href={l.offer.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sky-400 hover:underline" title={l.offer.title}>
                      {l.purchase.orderQty} × {l.offer.title}
                    </a>
                    <span className="shrink-0 tabular-nums text-neutral-300">{gbp(l.purchase.cost)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 border-t border-neutral-800 pt-1.5 text-right text-sm font-medium tabular-nums">{gbp(o.subtotal + o.shipping)}</div>
            </div>
          ))}
          {basket.unsourced.length > 0 && (
            <div className="rounded-xl border border-dashed border-neutral-800 p-3">
              <div className="font-medium text-neutral-400">No listing found (estimate)</div>
              <ul className="mt-2 space-y-1.5 text-sm text-neutral-400">
                {basket.unsourced.map((u) => (
                  <li key={u.line} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate" title={u.part}>
                      {u.purchase.orderQty} × {u.part}
                    </span>
                    <span className="shrink-0 tabular-nums">{gbp(u.purchase.cost)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* All listings */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-neutral-500 hover:text-neutral-300">
          All listings by part
        </summary>
        <div className="mt-3 space-y-3">
          {offers.lines
            .filter((l) => l.offers.length)
            .map((l) => {
              const cheapest = Math.min(...l.offers.map((o) => o.unit_price_gbp));
              const days = (s: string) => offers.suppliers.find((x) => x.name.toLowerCase() === s.toLowerCase())?.delivery_days ?? null;
              const fastestDays = Math.min(...l.offers.map((o) => o.lead_time_days ?? days(o.supplier) ?? 99));
              return (
                <div key={l.line} className="text-sm">
                  <div className="text-neutral-300">{l.part}</div>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {l.offers.map((o) => {
                      const d = o.lead_time_days ?? days(o.supplier);
                      return (
                        <li key={o.url}>
                          <a href={o.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:border-neutral-600">
                            <span className="text-neutral-300">{o.supplier}</span>
                            <span className="tabular-nums text-neutral-400">
                              {gbp(o.unit_price_gbp)}
                              {o.pack_qty > 1 && ` /${o.pack_qty}pk`}
                            </span>
                            {o.unit_price_gbp === cheapest && <span className="text-emerald-400">Cheapest</span>}
                            {d != null && d === fastestDays && l.offers.length > 1 && <span className="text-sky-400">Fastest</span>}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
        </div>
      </details>
    </div>
  );
}

function VolumeChart({
  curve,
  selected,
  onSelect,
}: {
  curve: { units: number; perUnit: number; total: number }[];
  selected: number;
  onSelect: (u: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 400;
  const H = 160;
  const pad = { l: 8, r: 8, t: 12, b: 22 };
  const max = Math.max(...curve.map((c) => c.perUnit), 1);
  const slot = (W - pad.l - pad.r) / curve.length;
  const bw = Math.min(56, slot - 16);
  const r = 4;
  const active = hover ?? curve.findIndex((c) => c.units === selected);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Parts cost per unit at 1, 10, 100 and 1000 units">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#3f3f46" strokeWidth={1} />
        {curve.map((c, i) => {
          const h = Math.max(2, ((H - pad.t - pad.b) * c.perUnit) / max);
          const x = pad.l + slot * i + (slot - bw) / 2;
          const y = H - pad.b - h;
          const isSel = c.units === selected;
          return (
            <g key={c.units} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSelect(c.units)} className="cursor-pointer">
              {/* oversized hit target */}
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              <path
                d={`M${x},${H - pad.b} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - pad.b} Z`}
                fill="#38bdf8"
                opacity={isSel ? 1 : hover === i ? 0.75 : 0.45}
              />
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={isSel ? "#e5e5e5" : "#737373"}>
                ×{vol(c.units)}
              </text>
            </g>
          );
        })}
      </svg>
      {active >= 0 && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs shadow-lg"
          style={{ left: `${((active + 0.5) / curve.length) * 100}%`, transform: "translateX(-50%)" }}
        >
          <div className="font-medium tabular-nums text-neutral-100">{gbp(curve[active].perUnit)} / unit</div>
          <div className="tabular-nums text-neutral-400">
            {gbp(curve[active].total)} for {vol(curve[active].units)}
          </div>
        </div>
      )}
    </div>
  );
}
