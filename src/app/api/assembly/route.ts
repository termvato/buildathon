import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { claudeJson } from "@/lib/claude";
import { getDb } from "@/lib/db";
import { Assembly } from "@/lib/schemas";

export const maxDuration = 120;

const Body = z.object({
  teardownId: z.string().optional(),
  product: z.string().min(1),
  is_known_product: z.boolean(),
  description: z.string(),
  bom: z.array(z.object({ part: z.string(), qty: z.number() })).min(1),
  images: z.array(z.string().min(100)).max(4).optional(), // small base64 JPEGs
});

const SYSTEM = `You are a hardware engineer explaining how a product fits together, for a teardown tool.
Given the photos, description and BOM, reason about the system architecture:
- summary: 2-4 sentences: what the core subsystems are and how the device works end to end.
- connections: the important links between BOM parts (use the BOM part names). kind = power (supply rails, include voltages), data (buses like I2C/SPI/UART/USB), signal (PWM, encoder, analog), mechanical (gears, fasteners, linkages), rf (antennas/radios). 6-14 connections, most important first.
- fitting_parts: the hardware and consumables needed to FIT THE BOM PARTS TOGETHER that are not already BOM lines: fasteners (e.g. "M3x8 socket screws"), standoffs, heat-set inserts, connectors and crimp terminals (e.g. "JST-SH 4-pin cables"), wire (gauge), solder, heat-shrink, adhesive/tape, thermal pads, cable ties. qty as text (e.g. "12", "~1m", "1 tube"). purpose = what it joins. est_cost_gbp = rough UK hobby price for that qty, or null. 5-12 items, most important first.
- build_steps: ordered steps to assemble and bring it up (for known products: how it is manufactured/assembled). 5-10 steps, each one sentence, mentioning which fitting parts and tools each step uses.
- tools: tools needed to build it (e.g. soldering iron, crimper for JST-SH, hex keys, 3D printer, multimeter, spudger, heat gun). essential=false for nice-to-haves. 4-10 items.
- inferred_parts: parts the system almost certainly needs that are NOT in the BOM (e.g. a buck converter, fuse, level shifter, firmware programmer). Empty if none.
- risks: likely failure points or design issues (current draw vs supply, heat, strain on wiring, MOQ/lead-time traps). 2-5 items.
Be concrete and brief. Say when something is an assumption from the photos.`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { product, bom[], ... }" }, { status: 400 });
  const b = parsed.data;

  const prompt = `Product: ${b.product} (${b.is_known_product ? "commercial product" : "custom / prototype hardware"})
Description: ${b.description}
BOM:
${b.bom.map((l) => `- ${l.qty} x ${l.part}`).join("\n")}

Explain how it fits together.`;

  let assembly: Assembly;
  try {
    assembly = await claudeJson({
      schema: Assembly,
      system: SYSTEM,
      prompt,
      images: (b.images ?? []).map((data) => ({ mediaType: "image/jpeg" as const, data })),
      effort: "medium",
    });
  } catch (err) {
    console.error("assembly failed", err);
    return NextResponse.json({ error: `Reasoning failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }

  if (b.teardownId && ObjectId.isValid(b.teardownId)) {
    await getDb()
      .then((db) => db.collection("teardowns").updateOne({ _id: new ObjectId(b.teardownId) }, { $set: { assembly } }))
      .catch((err) => console.error("assembly not saved", err));
  }
  return NextResponse.json({ assembly });
}
