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

// ---- Where to buy ----
export const PriceBreak = z.object({ min_qty: z.number(), unit_gbp: z.number() });
export type PriceBreak = z.infer<typeof PriceBreak>;

export const Offer = z.object({
  supplier: z.string(),
  url: z.string(),
  title: z.string(),
  unit_price_gbp: z.number(), // price per piece when buying 1 pack
  pack_qty: z.number(), // pieces per purchasable pack (1 if sold singly)
  price_breaks: z.array(PriceBreak), // per-piece prices at higher quantities, if listed
  in_stock: z.boolean().nullable(),
  lead_time_days: z.number().nullable(),
});
export type Offer = z.infer<typeof Offer>;

export const SupplierInfo = z.object({
  name: z.string(),
  shipping_gbp: z.number(),
  free_over_gbp: z.number().nullable(),
  delivery_days: z.number().nullable(),
});
export type SupplierInfo = z.infer<typeof SupplierInfo>;

export const OffersExtraction = z.object({
  lines: z.array(
    z.object({
      line: z.number(), // BOM line number (1-based); 0 = the whole product (known products)
      offers: z.array(Offer),
      volume_breaks: z.array(PriceBreak), // estimated per-piece price at 1/10/100/1000 pieces
    }),
  ),
  suppliers: z.array(SupplierInfo),
});
export type OffersExtraction = z.infer<typeof OffersExtraction>;

export type LineOffers = { line: number; part: string; offers: Offer[]; volume_breaks: PriceBreak[] };
export type Offers = {
  mode: "parts" | "product";
  lines: LineOffers[];
  suppliers: SupplierInfo[];
  warnings: string[];
};
