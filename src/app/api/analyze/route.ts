import { NextResponse } from "next/server";
import { z } from "zod";
import { claudeJson } from "@/lib/claude";
import { ImageAnalysis } from "@/lib/schemas";

export const maxDuration = 60;

const Body = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z.string().min(100),
});

const SYSTEM = `You identify physical products from phone photos for a hardware teardown tool.
Name the most specific product you can (brand + model + generation when visible).
Set is_known_product=true only for a mass-market commercial product; prototypes, DIY builds, robots and unbranded hardware are false.
visible_components: concrete parts you can actually see (e.g. "Raspberry Pi 4", "NEMA 17 stepper motor", "18650 battery pack", "USB-C port"), max 12.
description: 1-2 sentences describing the object itself (not the background or angle), so photos of the same product from different angles read alike.`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { mediaType, data }" }, { status: 400 });
  try {
    const analysis = await claudeJson({
      schema: ImageAnalysis,
      system: SYSTEM,
      prompt: "Identify the product in this photo.",
      images: [parsed.data],
    });
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("analyze failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
