import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

// Anthropic SDK client. In production this hits api.anthropic.com directly.
// In local dev we point it at a LiteLLM proxy (see litellm-config.yaml) that
// speaks Anthropic API format on the inbound side and forwards to Ollama.
// That way the agent loop in lib/claude/agent.ts can stay 100% Anthropic-shaped
// without any provider switch logic.
export function anthropic(): Anthropic {
  if (!_client) {
    const baseURL = process.env.ANTHROPIC_BASE_URL;
    const apiKey = process.env.ANTHROPIC_API_KEY ?? (baseURL ? "sk-local" : undefined);
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey, baseURL });
  }
  return _client;
}

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

// True when the active model is a first-party Claude model. Gates
// Anthropic-specific params (thinking, cache_control) that non-Claude compat
// backends (Kimi/Moonshot) silently drop or reject.
export const IS_CLAUDE = MODEL.startsWith("claude-");

// Vision/fast model — used by identify_pest. In dev with Ollama, point this at a
// multimodal model (llava, llama3.2-vision) via ANTHROPIC_MODEL_VISION.
export const MODEL_FAST = process.env.ANTHROPIC_MODEL_VISION ?? "claude-haiku-4-5";
