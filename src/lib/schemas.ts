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
  qty: z.number(), // needed per finished unit
  unit_cost_gbp: z.number(), // price per piece at the quoted quantity
  moq: z.number().nullable(), // minimum order quantity, null if you can buy 1 / not applicable
  price_basis: z.string(), // e.g. "$5 each at MOQ 5 (JLCPCB)", "est. at 1M-unit volume"
  source_url: z.string().nullable(),
});
export type BomLine = z.infer<typeof BomLine>;

export type BomRow = BomLine & {
  line_cost_gbp: number; // qty * unit cost: cost per finished unit
  first_order_gbp: number; // what you actually pay for the first build, MOQ applied
};

// What Claude returns for a teardown; totals and margin are computed server-side.
export const BomExtraction = z.object({
  product: z.string(),
  bom: z.array(BomLine),
  retail_price_gbp: z.number().nullable(),
  confidence: Confidence,
  notes: z.string(),
});
export type BomExtraction = z.infer<typeof BomExtraction>;

export const ConnectionKind = z.enum(["power", "data", "signal", "mechanical", "rf"]);

export const Assembly = z.object({
  summary: z.string(),
  connections: z.array(
    z.object({ from: z.string(), to: z.string(), kind: ConnectionKind, detail: z.string() }),
  ),
  build_steps: z.array(z.string()),
  inferred_parts: z.array(z.string()),
  risks: z.array(z.string()),
});
export type Assembly = z.infer<typeof Assembly>;

export type Source = { title: string; url: string };

export type Product = {
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
  bom: BomRow[];
  total_build_cost_gbp: number; // per unit
  first_build_cost_gbp: number; // first unit incl. MOQs
  retail_price_gbp: number | null;
  margin_pct: number | null;
  confidence: Confidence;
  notes: string;
  sources: Source[];
  live_sources: boolean;
  warnings: string[];
  similar: SimilarTeardown[];
  assembly?: Assembly;
  created_at?: string;
};
