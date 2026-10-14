import { z } from "zod";

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

export const ImageAnalysis = z.object({
  product_guess: z.string(),
  confidence: Confidence,
  is_known_product: z.boolean(),
  visible_components: z.array(z.string()),
  description: z.string(),
});
export type ImageAnalysis = z.infer<typeof ImageAnalysis>;

export const BomLine = z.object({
  part: z.string(),
  supplier: z.string(),
  est_cost_gbp: z.number(),
  source_url: z.string().nullable(),
});
export type BomLine = z.infer<typeof BomLine>;

// What Claude returns for a teardown; totals and margin are computed server-side.
export const BomExtraction = z.object({
  product: z.string(),
  bom: z.array(BomLine),
  retail_price_gbp: z.number().nullable(),
  confidence: Confidence,
  notes: z.string(),
});
export type BomExtraction = z.infer<typeof BomExtraction>;

export type Source = { title: string; url: string };

export type ProductGroup = {
  groupId: string;
  imageIds: string[];
  product_guess: string;
  is_known_product: boolean;
  confidence: Confidence;
  visible_components: string[];
  description: string;
};

export type SimilarTeardown = {
  id: string;
  product: string;
  total_build_cost_gbp: number;
  retail_price_gbp: number | null;
  score: number | null;
  shared_parts: string[];
};

export type Teardown = {
  id?: string;
  product: string;
  is_known_product: boolean;
  bom: BomLine[];
  total_build_cost_gbp: number;
  retail_price_gbp: number | null;
  margin_pct: number | null;
  confidence: Confidence;
  notes: string;
  sources: Source[];
  live_sources: boolean;
  warnings: string[];
  similar: SimilarTeardown[];
  created_at?: string;
};
