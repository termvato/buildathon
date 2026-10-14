import { embedMany } from "ai";

// Via Vercel AI Gateway (same auth as Claude); 1536 dims.
const EMBED_MODEL = "openai/text-embedding-3-small";

export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  const { embeddings } = await embedMany({ model: EMBED_MODEL, values });
  return embeddings;
}
