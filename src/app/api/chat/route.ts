import { generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

// Routed through Vercel AI Gateway: auth is automatic on Vercel (OIDC),
// and locally via VERCEL_OIDC_TOKEN from `vercel env pull`.
const MODEL = "anthropic/claude-sonnet-5.5";

const Body = z.object({ prompt: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { prompt: string }" }, { status: 400 });
  }
  try {
    const { text } = await generateText({ model: MODEL, prompt: parsed.data.prompt });
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
