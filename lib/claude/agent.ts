import type Anthropic from "@anthropic-ai/sdk";
import { formatInTimeZone } from "date-fns-tz";
import { anthropic, MODEL, IS_CLAUDE } from "./client";
import { loadSystemPrompt } from "./skills";
import { BUSINESS_TZ } from "@/lib/time";
import { TOOLS, dispatchTool, type ToolContext } from "./tools";

type MessageParam = Anthropic.Messages.MessageParam;

export type AgentInput = {
  history: MessageParam[];
  userText: string;
  mediaUrls: string[];
  ctx: ToolContext;
};

export type AgentOutput = {
  replyText: string;
  updatedHistory: MessageParam[];
};

const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_TURNS = 30;

export async function runAgent({ history, userText, mediaUrls, ctx }: AgentInput): Promise<AgentOutput> {
  const client = anthropic();
  const system = loadSystemPrompt();

  // Per-turn date anchor so the agent can resolve "today"/"tomorrow". All times
  // are India Standard Time (Asia/Kolkata, UTC+5:30, no DST). Kept as a separate,
  // uncached system block so the large cached prompt prefix above stays stable.
  const nowContext =
    `Current date/time: ${formatInTimeZone(new Date(), BUSINESS_TZ, "EEEE, d MMMM yyyy, HH:mm")} ` +
    `(India Standard Time, Asia/Kolkata, UTC+5:30). Interpret all dates and times the customer mentions in IST.`;

  const userContent: Anthropic.Messages.ContentBlockParam[] = [];
  if (userText) userContent.push({ type: "text", text: userText });
  for (const url of mediaUrls) {
    const block = mediaUrlToImageBlock(url);
    if (block) userContent.push(block);
  }
  if (userContent.length === 0) userContent.push({ type: "text", text: "(empty message)" });

  const messages: MessageParam[] = [...history, { role: "user", content: userContent }];

  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // thinking and cache_control are Anthropic-only — omit for Kimi/compat backends.
      ...(IS_CLAUDE ? { thinking: { type: "adaptive" } } : {}),
      system: [
        {
          type: "text",
          text: system,
          ...(IS_CLAUDE ? { cache_control: { type: "ephemeral" } } : {})
        },
        { type: "text", text: nowContext }
      ],
      tools: TOOLS,
      messages
    });

    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      finalText = resp.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      let result: unknown;
      try {
        result = await dispatchTool(block.name, block.input as Record<string, unknown>, ctx);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result)
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText) {
    finalText = "Sorry — I'm having trouble on my end. Let me get a human to help.";
  }

  const updatedHistory = trimHistory(messages);
  return { replyText: finalText, updatedHistory };
}

function trimHistory(messages: MessageParam[]): MessageParam[] {
  if (messages.length <= MAX_HISTORY_TURNS) return messages;
  // Cut only at a genuine user turn. A blind slice can strand a tool_result
  // whose matching assistant tool_use was trimmed away, or start the history
  // on an assistant turn — the API rejects both with a 400.
  let start = messages.length - MAX_HISTORY_TURNS;
  while (start < messages.length && !isPlainUserTurn(messages[start])) start++;
  return messages.slice(start);
}

function isPlainUserTurn(msg: MessageParam): boolean {
  if (msg.role !== "user") return false;
  if (typeof msg.content === "string") return true;
  return msg.content.every((b) => b.type !== "tool_result");
}

// The WhatsApp inbound code resolves Graph media IDs to base64 data: URLs before
// they reach the agent (lib/whatsapp/inbound.ts), so that's the only branch we
// need here.
function mediaUrlToImageBlock(url: string): Anthropic.Messages.ImageBlockParam | null {
  const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!dataMatch) return null;
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: dataMatch[1] as Anthropic.Messages.Base64ImageSource["media_type"],
      data: dataMatch[2]
    }
  };
}
