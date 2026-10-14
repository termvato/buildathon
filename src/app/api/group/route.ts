import { cosineSimilarity } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { embedTexts } from "@/lib/embed";
import { ensureIndexes, getDb, VEC_INDEX } from "@/lib/db";
import { ImageAnalysis, type ProductGroup } from "@/lib/schemas";

export const maxDuration = 60;

const SIM_THRESHOLD = 0.9;

const Body = z.object({
  batchId: z.string().min(1),
  items: z.array(z.object({ imageId: z.string(), analysis: ImageAnalysis })).min(1).max(30),
});

const embedText = (a: ImageAnalysis) => `Product: ${a.product_guess}. ${a.description}`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { batchId, items[] }" }, { status: 400 });
  const { batchId, items } = parsed.data;
  const warnings: string[] = [];

  let embeddings: number[][] = [];
  try {
    embeddings = await embedTexts(items.map((i) => embedText(i.analysis)));
  } catch (err) {
    warnings.push(`Embedding failed, grouping by product name instead: ${String(err)}`);
  }

  // pairs[i] = indexes of items with cosine >= threshold
  const pairs: number[][] = items.map(() => []);
  let method: "vector-search" | "local-cosine" | "name-match" = "name-match";

  if (embeddings.length === items.length) {
    try {
      await ensureIndexes();
      const coll = (await getDb()).collection("items");
      await coll.insertMany(
        items.map((it, i) => ({
          batchId,
          imageId: it.imageId,
          ...it.analysis,
          embedding: embeddings[i],
          created_at: new Date(),
        })),
      );
      // Atlas indexes new docs asynchronously; wait until the whole batch is searchable.
      const results = await vectorGroups(coll, batchId, embeddings, items.length);
      if (results) {
        method = "vector-search";
        results.forEach((hits, i) => {
          for (const h of hits) {
            const j = items.findIndex((it) => it.imageId === h.imageId);
            // Atlas cosine score is normalised: score = (1 + cos) / 2
            if (j >= 0 && j !== i && 2 * h.score - 1 >= SIM_THRESHOLD) pairs[i].push(j);
          }
        });
      }
    } catch (err) {
      warnings.push(`Vector search unavailable, used local cosine: ${String(err)}`);
    }
    if (method !== "vector-search") {
      method = "local-cosine";
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++)
          if (cosineSimilarity(embeddings[i], embeddings[j]) >= SIM_THRESHOLD) pairs[i].push(j);
    }
  } else {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (norm(items[i].analysis.product_guess) === norm(items[j].analysis.product_guess)) pairs[i].push(j);
  }

  // Union-find over similarity edges.
  const parent = items.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  pairs.forEach((js, i) => js.forEach((j) => (parent[find(i)] = find(j))));

  const clusters = new Map<number, number[]>();
  items.forEach((_, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), i]));

  const rank = { high: 3, medium: 2, low: 1 } as const;
  const groups: ProductGroup[] = [...clusters.values()].map((idx, g) => {
    const best = idx
      .map((i) => items[i].analysis)
      .sort((a, b) => rank[b.confidence] - rank[a.confidence])[0];
    const components = [...new Set(idx.flatMap((i) => items[i].analysis.visible_components))];
    return {
      groupId: `${batchId}-${g}`,
      imageIds: idx.map((i) => items[i].imageId),
      product_guess: best.product_guess,
      is_known_product: best.is_known_product,
      confidence: best.confidence,
      visible_components: components.slice(0, 15),
      description: best.description,
    };
  });

  return NextResponse.json({ groups, method, threshold: SIM_THRESHOLD, warnings });
}

type Hit = { imageId: string; score: number };

async function vectorGroups(
  coll: import("mongodb").Collection,
  batchId: string,
  embeddings: number[][],
  n: number,
): Promise<Hit[][] | null> {
  const search = (vector: number[]) =>
    coll
      .aggregate<Hit>([
        {
          $vectorSearch: {
            index: VEC_INDEX,
            path: "embedding",
            queryVector: vector,
            filter: { batchId },
            numCandidates: Math.max(50, n * 10),
            limit: n,
          },
        },
        { $project: { _id: 0, imageId: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();

  for (let attempt = 0; attempt < 8; attempt++) {
    const probe = await search(embeddings[0]);
    if (probe.length >= n) return Promise.all(embeddings.map(search));
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}
