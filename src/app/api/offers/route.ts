import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { claudeJson } from "@/lib/claude";
import { getDb } from "@/lib/db";
import { OffersExtraction, type LineOffers, type Offers } from "@/lib/schemas";
import { cachedSearch, type SearchHit } from "@/lib/tavily";

export const maxDuration = 120;

const Body = z.object({
  teardownId: z.string().optional(),
  product: z.string().min(1),
  is_known_product: z.boolean(),
  bom: z
    .array(z.object({ part: z.string(), supplier: z.string(), qty: z.number(), unit_cost_gbp: z.number(), moq: z.number().nullable() }))
    .min(1)
    .max(20),
});

// Prefer UK / maker-friendly shops; Tavily still returns others if these have nothing.
const SHOPS = [
  "thepihut.com", "shop.pimoroni.com", "coolcomponents.co.uk", "kitronik.co.uk", "uk.rs-online.com",
  "uk.farnell.com", "cpc.farnell.com", "mouser.co.uk", "digikey.co.uk", "lcsc.com", "jlcpcb.com",
  "pololu.com", "robotshop.com", "amazon.co.uk", "aliexpress.com", "ebay.co.uk",
];

const SYSTEM = `You extract real purchase listings from web search results for a hardware sourcing tool. Prices in GBP (USD x0.79, EUR x0.85).
For each numbered BOM line, return up to 3 offers found in THAT line's search results:
- url must be copied exactly from the results; never invent a listing. If no result is a buyable listing for the part, return no offers for that line.
- unit_price_gbp: price per piece when buying one pack; pack_qty: pieces per pack (1 if sold singly). Use only prices stated in the result text; skip offers with no visible price.
- price_breaks: per-piece quantity pricing if the listing shows it (e.g. 10+, 100+), else [].
- in_stock / lead_time_days: only if stated, else null.
For every line also return volume_breaks: your estimate of per-piece price buying 1, 10, 100 and 1000 pieces (min_qty 1,10,100,1000), based on the offers or typical distributor pricing. For custom PCBs/printed parts include the MOQ/setup effect.
suppliers: one entry per supplier you used: typical UK standard shipping cost, free-shipping threshold (null if none/unknown) and typical delivery days. These are estimates.`;

const PRODUCT_SYSTEM = `You extract real retail listings for a finished product from web search results. Prices in GBP.
Return a single line with line=0 and up to 5 offers (new, refurbished or used; say which in the title). url must be copied exactly from the results; skip results without a visible price.
volume_breaks: [{min_qty:1, unit_gbp:<typical retail>}].
suppliers: one entry per retailer used, with typical UK shipping cost, free-shipping threshold and delivery days (estimates).`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { product, bom[] }" }, { status: 400 });
  const b = parsed.data;
  const warnings: string[] = [];
  const mode: Offers["mode"] = b.is_known_product ? "product" : "parts";

  // 1. Search (cached in Mongo).
  const queries =
    mode === "product"
      ? [`buy ${b.product} UK price`, `${b.product} refurbished UK price`]
      : b.bom.map((l) => `buy ${l.part.replace(/\(.*?\)/g, "").slice(0, 90)} price UK`);
  const results = await Promise.all(
    queries.map((q) => cachedSearch(q, mode === "parts" ? { includeDomains: SHOPS, includeDomainsMode: "prefer" } : {})),
  );
  const failed = results.filter((r) => r === null).length;
  if (failed) warnings.push(`${failed}/${queries.length} searches failed`);

  const allowed = new Set<string>();
  const block = (hits: SearchHit[]) =>
    hits.map((h) => (allowed.add(h.url), `  - ${h.title}\n    URL: ${h.url}\n    ${h.content.slice(0, 700)}`)).join("\n");

  const prompt =
    mode === "product"
      ? `Product: ${b.product}\n\nSearch results:\n${block(results.flatMap((r) => r?.hits ?? []))}`
      : `Product: ${b.product}\n\n` +
        b.bom
          .map(
            (l, i) =>
              `LINE ${i + 1}: ${l.qty} x ${l.part} (BOM estimate £${l.unit_cost_gbp} each${l.moq ? `, MOQ ${l.moq}` : ""}, via ${l.supplier})\nResults:\n${block(results[i]?.hits ?? []) || "  (none)"}`,
          )
          .join("\n\n");

  // 2. Claude extracts listings.
  let extraction: OffersExtraction;
  try {
    extraction = await claudeJson({
      schema: OffersExtraction,
      system: mode === "product" ? PRODUCT_SYSTEM : SYSTEM,
      prompt,
      effort: "low",
    });
  } catch (err) {
    console.error("offers extraction failed", err);
    return NextResponse.json({ error: `Listing extraction failed: ${err instanceof Error ? err.message : String(err)}`, warnings }, { status: 502 });
  }

  // 3. Validate: real URLs only, sane numbers.
  const clean = (o: OffersExtraction["lines"][number]["offers"][number]) =>
    allowed.has(o.url) && o.unit_price_gbp > 0
      ? [{ ...o, pack_qty: Math.max(1, Math.round(o.pack_qty || 1)), price_breaks: o.price_breaks.filter((p) => p.min_qty > 0 && p.unit_gbp > 0) }]
      : [];
  const byLine = new Map(extraction.lines.map((l) => [l.line, l]));
  const lines: LineOffers[] =
    mode === "product"
      ? [{ line: 0, part: b.product, offers: (byLine.get(0)?.offers ?? extraction.lines[0]?.offers ?? []).flatMap(clean), volume_breaks: [] }]
      : b.bom.map((l, i) => {
          const x = byLine.get(i + 1);
          return {
            line: i + 1,
            part: l.part,
            offers: (x?.offers ?? []).flatMap(clean).slice(0, 3),
            volume_breaks: (x?.volume_breaks ?? []).filter((p) => p.min_qty > 0 && p.unit_gbp > 0),
          };
        });
  const dropped = extraction.lines.reduce((n, l) => n + l.offers.length, 0) - lines.reduce((n, l) => n + l.offers.length, 0);
  if (dropped > 0) warnings.push(`${dropped} listing(s) dropped: URL not in search results or no price`);

  const offers: Offers = { mode, lines, suppliers: extraction.suppliers, warnings };

  if (b.teardownId && ObjectId.isValid(b.teardownId)) {
    await getDb()
      .then((db) => db.collection("teardowns").updateOne({ _id: new ObjectId(b.teardownId) }, { $set: { offers } }))
      .catch((err) => console.error("offers not saved", err));
  }
  return NextResponse.json({ offers });
}
