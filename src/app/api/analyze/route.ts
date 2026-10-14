import { NextResponse } from "next/server";
import { z } from "zod";
import { claudeJson } from "@/lib/claude";
import { ImageAnalysis } from "@/lib/schemas";

export const maxDuration = 60;

const Body = z.object({
  images: z
    .array(z.object({ mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().min(100) }))
    .min(1)
    .max(8),
});

const SYSTEM = `You identify physical products from phone photos for a hardware teardown tool.
All photos show the SAME single product from different angles, distances or close-ups. Combine what you see across all of them.
Name the most specific product you can (brand + model + generation when visible).
Set is_known_product=true only for a mass-market commercial product; prototypes, DIY builds, robots and unbranded hardware are false.
visible_components: concrete parts you can actually see across the photos (e.g. "Teensy 4.1", "N20 gear motor", "18650 cell", "USB-C port"), max 20, no duplicates.
description: 2-3 sentences on what the object is and how it appears to be built.`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { images: [{ mediaType, data }] } (1-8)" }, { status: 400 });
  try {
    const analysis = await claudeJson({
      schema: ImageAnalysis,
      system: SYSTEM,
      prompt: `Identify the product shown in these ${parsed.data.images.length} photo(s).`,
      images: parsed.data.images,
      effort: "medium",
    });
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("analyze failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
