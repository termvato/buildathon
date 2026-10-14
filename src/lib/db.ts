import type { Db } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";

export const EMBED_DIMS = 1536;
export const VEC_INDEX = "vec_idx";

// Atlas Vector Search index on "teardowns" (powers the similar-products panel).
export const vectorIndexDefinition = {
  fields: [
    { type: "vector", path: "embedding", numDimensions: EMBED_DIMS, similarity: "cosine" },
    { type: "filter", path: "batchId" },
  ],
};

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db("buildathon");
}

let ensured: Promise<void> | undefined;

/** Create collections + vector indexes if missing (idempotent, best-effort). */
export function ensureIndexes(): Promise<void> {
  ensured ??= (async () => {
    const db = await getDb();
    const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
    for (const name of ["teardowns", "tavily_cache"]) {
      if (!existing.has(name)) await db.createCollection(name);
    }
    await db.collection("tavily_cache").createIndex({ query: 1 }, { unique: true });
    for (const name of ["teardowns"]) {
      const coll = db.collection(name);
      const indexes = await coll.listSearchIndexes(VEC_INDEX).toArray();
      if (indexes.length === 0) {
        await coll.createSearchIndex({
          name: VEC_INDEX,
          type: "vectorSearch",
          definition: vectorIndexDefinition,
        });
      }
    }
  })().catch((err) => {
    ensured = undefined;
    throw err;
  });
  return ensured;
}
