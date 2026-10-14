import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getVercelOidcToken } from "@vercel/oidc";
import type { z } from "zod";

// With ANTHROPIC_API_KEY set we call Anthropic directly; otherwise we route the
// same SDK through Vercel AI Gateway (Anthropic-compatible endpoint), authed by
// AI_GATEWAY_API_KEY or the Vercel OIDC token (automatic on Vercel).
const DIRECT = !!process.env.ANTHROPIC_API_KEY;
export const MODEL = DIRECT ? "claude-sonnet-5-5" : "anthropic/claude-sonnet-5.5";

async function getClient(): Promise<Anthropic> {
  if (DIRECT) return new Anthropic();
  const token = process.env.AI_GATEWAY_API_KEY ?? (await getVercelOidcToken());
  return new Anthropic({
    apiKey: null,
    authToken: token,
    baseURL: "https://ai-gateway.vercel.sh",
    maxRetries: 2,
  });
}

export type ImageInput = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };

/** One structured-output call. Throws on refusal / unparseable output. */
export async function claudeJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  images?: ImageInput[];
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<S>> {
  const client = await getClient();
  const content: Anthropic.ContentBlockParam[] = [
    ...(opts.images ?? []).map(
      (img): Anthropic.ImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data },
      }),
    ),
    { type: "text", text: opts.prompt },
  ];
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: opts.system,
    messages: [{ role: "user", content }],
    output_config: { effort: opts.effort ?? "low", format: zodOutputFormat(opts.schema) },
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request");
  if (response.parsed_output == null) {
    throw new Error(`No structured output (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output as z.infer<S>;
}
