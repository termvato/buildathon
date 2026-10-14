import { NextResponse } from "next/server";
import { z } from "zod";
import { claudeJson } from "@/lib/claude";
import { ensureIndexes, getDb, VEC_INDEX } from "@/lib/db";
import { embedTexts } from "@/lib/embed";
import { BomExtraction, type SimilarTeardown, type Source, type Teardown } from "@/lib/schemas";
import { cachedSearch, type SearchHit } from "@/lib/tavily";

export const maxDuration = 120;

const Body = z.object({
  product_guess: z.string().min(1),
  is_known_product: z.boolean(),
  visible_components: z.array(z.string()),
  description: z.string(),
});

const SYSTEM = `You estimate hardware bills of materials (BOM) in GBP for a teardown tool.
Use the numbered web sources when they contain costs; otherwise give your best engineering estimate.
Rules:
- source_url must be copied exactly from the provided sources, or null if the line is your own estimate.
- est_cost_gbp is the per-unit component cost to the manufacturer (for known products) or the retail cost of buying the part (for prototypes). Convert USD at 0.79 GBP/USD.
- 6-15 lines; group minor parts into "Other components / assembly".
- retail_price_gbp: the UK retail price if it's a commercial product and you know it or a source states it, else null.
- confidence: high only if multiple sources give a BOM; low if mostly your own estimate.
- notes: one or two sentences on method and caveats.`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected a product group" }, { status: 400 });
  const product = parsed.data;
  const warnings: string[] = [];

  // 1. Web research (Tavily, cached in Mongo).
  const queries = product.is_known_product
    ? [
        `${product.product_guess} teardown bill of materials cost`,
        `${product.product_guess} cost to build components`,
        `${product.product_guess} UK price`,
      ]
    : product.visible_components.slice(0, 8).map((c) => `${c} price specs buy UK`);

  const results = await Promise.all(queries.map(cachedSearch));
  const failed = results.filter((r) => r === null).length;
  if (failed) warnings.push(`${failed}/${queries.length} web searches failed`);
  const cachedCount = results.filter((r) => r?.cached).length;

  const byUrl = new Map<string, SearchHit>();
  for (const r of results) for (const h of r?.hits ?? []) if (!byUrl.has(h.url)) byUrl.set(h.url, h);
  const hits = [...byUrl.values()].slice(0, 18);
  const liveSources = hits.length > 0;
  if (!liveSources) warnings.push("No web sources available; BOM is Claude's own estimate");

  // 2. Claude builds the BOM.
  const sourceBlock = hits.map((h, i) => `[S${i + 1}] ${h.title}\nURL: ${h.url}\n${h.content}`).join("\n\n");
  const prompt = `Product: ${product.product_guess}
Type: ${product.is_known_product ? "known commercial product" : "custom / prototype hardware"}
Description: ${product.description}
Visible components: ${product.visible_components.join(", ") || "none listed"}

Sources:
${sourceBlock || "(none - estimate from your own knowledge)"}

Build the BOM.`;

  let extraction: BomExtraction;
  try {
    extraction = await claudeJson({ schema: BomExtraction, system: SYSTEM, prompt, effort: "medium" });
  } catch (err) {
    console.error("teardown extraction failed", err);
    return NextResponse.json(
      { error: `BOM extraction failed: ${err instanceof Error ? err.message : String(err)}`, warnings },
      { status: 502 },
    );
  }

  // 3. Validate + compute numbers ourselves (don't trust model arithmetic or URLs).
  const allowed = new Set(byUrl.keys());
  const bom = extraction.bom.map((l) => ({
    ...l,
    est_cost_gbp: Math.max(0, Math.round(l.est_cost_gbp * 100) / 100),
    source_url: l.source_url && allowed.has(l.source_url) ? l.source_url : null,
  }));
  const total = Math.round(bom.reduce((s, l) => s + l.est_cost_gbp, 0) * 100) / 100;
  const retail = extraction.retail_price_gbp;
  const margin = retail && retail > 0 ? Math.round(((retail - total) / retail) * 1000) / 10 : null;
  const cited = new Set(bom.map((l) => l.source_url).filter(Boolean));
  const sources: Source[] = hits
    .filter((h) => cited.has(h.url))
    .concat(hits.filter((h) => !cited.has(h.url)).slice(0, 4))
    .map((h) => ({ title: h.title, url: h.url }));

  const teardown: Teardown = {
    product: extraction.product || product.product_guess,
    is_known_product: product.is_known_product,
    bom,
    total_build_cost_gbp: total,
    retail_price_gbp: retail,
    margin_pct: margin,
    confidence: liveSources ? extraction.confidence : "low",
    notes: extraction.notes,
    sources,
    live_sources: liveSources,
    warnings,
    similar: [],
    created_at: new Date().toISOString(),
  };
  if (cachedCount) teardown.notes += ` (${cachedCount}/${queries.length} searches served from cache)`;

  // 4. Similar past teardowns + store (best-effort: never fail the response).
  try {
    await ensureIndexes();
    const coll = (await getDb()).collection("teardowns");
    const partsNorm = bom.map((l) => normPart(l.part));
    const [embedding] = await embedTexts([`${teardown.product}. Parts: ${bom.map((l) => l.part).join(", ")}`]);
    teardown.similar = await findSimilar(coll, embedding, partsNorm, teardown.product).catch((err) => {
      warnings.push(`Similar search failed: ${String(err)}`);
      return [];
    });
    const { insertedId } = await coll.insertOne({
      ...teardown,
      similar: undefined,
      parts_norm: partsNorm,
      embedding,
      created_at: new Date(),
    });
    teardown.id = insertedId.toString();
  } catch (err) {
    warnings.push(`Not saved to MongoDB: ${String(err)}`);
  }

  return NextResponse.json({ teardown });
}

const normPart = (p: string) =>
  p.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

type StoredTeardown = {
  _id: import("mongodb").ObjectId;
  product: string;
  total_build_cost_gbp: number;
  retail_price_gbp: number | null;
  parts_norm: string[];
};

async function findSimilar(
  coll: import("mongodb").Collection,
  embedding: number[],
  partsNorm: string[],
  product: string,
): Promise<SimilarTeardown[]> {
  const [byVector, byParts] = await Promise.all([
    coll
      .aggregate<StoredTeardown & { score: number }>([
        { $vectorSearch: { index: VEC_INDEX, path: "embedding", queryVector: embedding, numCandidates: 100, limit: 8 } },
        { $project: { product: 1, total_build_cost_gbp: 1, retail_price_gbp: 1, parts_norm: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray(),
    coll
      .find<StoredTeardown>({ parts_norm: { $in: partsNorm } }, { projection: { embedding: 0, bom: 0 } })
      .limit(20)
      .toArray(),
  ]);

  const seen = new Map<string, SimilarTeardown>();
  const mine = new Set(partsNorm);
  for (const t of [...byVector, ...byParts]) {
    // Skip earlier runs of the same product so the panel shows *other* products.
    if (t.product.toLowerCase() === product.toLowerCase()) continue;
    const key = t.product.toLowerCase();
    const shared = (t.parts_norm ?? []).filter((p) => mine.has(p));
    const prev = seen.get(key);
    const score = "score" in t ? Math.round((2 * (t as { score: number }).score - 1) * 100) / 100 : null;
    if (!prev) {
      seen.set(key, {
        id: t._id.toString(),
        product: t.product,
        total_build_cost_gbp: t.total_build_cost_gbp,
        retail_price_gbp: t.retail_price_gbp,
        score,
        shared_parts: shared,
      });
    } else {
      prev.score ??= score;
      prev.shared_parts = [...new Set([...prev.shared_parts, ...shared])];
    }
  }
  return [...seen.values()]
    .filter((s) => s.shared_parts.length > 0 || (s.score ?? 0) >= 0.6)
    .sort((a, b) => b.shared_parts.length - a.shared_parts.length || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 4);
}
