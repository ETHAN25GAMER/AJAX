import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "@/lib/claude/client";

async function main() {
  const client = anthropic();
  console.log("→ provider:", process.env.ANTHROPIC_BASE_URL ?? "api.anthropic.com");
  console.log("→ model:   ", MODEL);

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 80,
    messages: [
      {
        role: "user",
        content: "Reply with exactly: pong from <model_name_you_are>. Nothing else."
      }
    ]
  });

  const text = resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  console.log("← reply:   ", text.trim());
  console.log("✅ wire is alive");
}

main().catch((err) => {
  console.error("❌ wire is broken:");
  console.error(err);
  process.exit(1);
});
