import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL_FAST } from "@/lib/claude/client";

type Args = { description?: string; image_url?: string };

const SYSTEM = `You identify household and commercial pests for a pest control service.
Reply in strict JSON with keys: species (string, common name), latin (string or null), confidence (0..1), severity_hint ("low"|"normal"|"high"), advice_key (short slug like "german-roach-sanitation").
If unsure, return confidence < 0.6 and your best guess. Never invent species names.`;

export async function identifyPest(args: Args): Promise<unknown> {
  if (!args.description && !args.image_url) {
    return { error: "Provide description or image_url" };
  }

  const client = anthropic();
  const content: Anthropic.Messages.ContentBlockParam[] = [];

  if (args.image_url) {
    const dataMatch = args.image_url.match(/^data:([^;]+);base64,(.+)$/);
    if (dataMatch) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: dataMatch[1] as Anthropic.Messages.Base64ImageSource["media_type"],
          data: dataMatch[2]
        }
      });
    } else if (/^https?:\/\//.test(args.image_url)) {
      content.push({
        type: "image",
        source: { type: "url", url: args.image_url }
      });
    } else {
      return { error: "image_url must be a data: or http(s): URL" };
    }
    content.push({ type: "text", text: "Identify this pest." });
  } else {
    content.push({ type: "text", text: `Identify this pest from the description: ${args.description}` });
  }

  const resp = await client.messages.create({
    model: MODEL_FAST,
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: "user", content }]
  });

  const text = resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { error: "model_no_json", raw: text };
    return JSON.parse(match[0]);
  } catch {
    return { error: "json_parse_failed", raw: text };
  }
}
