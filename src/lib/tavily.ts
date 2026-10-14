import { tavily } from "@tavily/core";
import { getDb } from "@/lib/db";

export type SearchHit = { title: string; url: string; content: string };

// Keyless mode (shared rate limit) when TAVILY_API_KEY is unset.
const client = tavily(process.env.TAVILY_API_KEY ? { apiKey: process.env.TAVILY_API_KEY } : {});

/** Tavily search with a MongoDB cache. Returns null if search is unavailable. */
export async function cachedSearch(query: string): Promise<{ hits: SearchHit[]; cached: boolean } | null> {
  const key = query.trim().toLowerCase();
  const cache = await getDb()
    .then((db) => db.collection<{ query: string; hits: SearchHit[]; at: Date }>("tavily_cache"))
    .catch(() => null);

  const hit = await cache?.findOne({ query: key }).catch(() => null);
  if (hit) return { hits: hit.hits, cached: true };

  try {
    const res = await client.search(query, { maxResults: 6, searchDepth: "basic" });
    const hits = res.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content.slice(0, 1500),
    }));
    await cache
      ?.updateOne({ query: key }, { $set: { query: key, hits, at: new Date() } }, { upsert: true })
      .catch(() => {});
    return { hits, cached: false };
  } catch (err) {
    console.error("tavily search failed", query, err);
    return null;
  }
}
