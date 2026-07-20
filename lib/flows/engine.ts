import type {
  AdvanceResult,
  FlowContext,
  FlowDef,
  FlowInput,
  FlowState,
  NextRef,
  NodePrompt,
  Send
} from "./types";

// Deterministic MCQ flow engine. Given the registered flows, a (possibly null)
// persisted state and one customer input, produce the sends and the new state.
// Pure over its inputs except what flow definitions themselves fetch (pricing,
// slots, lookups) — the decision logic here has no I/O and no LLM.

const MAX_ACTION_HOPS = 10; // guard against a definition cycling action nodes

export class FlowEngine {
  constructor(private flows: Record<string, FlowDef>) {}

  /** Open a flow at its entry (or a specific node) — e.g. the main menu. */
  async start(
    ctx: FlowContext,
    flowId: string,
    node?: string,
    data: Record<string, unknown> = {}
  ): Promise<{ sends: Send[]; state: FlowState | null }> {
    return this.enter(ctx, { flow: flowId, node: node ?? this.flow(flowId).entry }, data, []);
  }

  /** Handle one customer input against the persisted state. */
  async advance(ctx: FlowContext, state: FlowState, input: FlowInput): Promise<AdvanceResult> {
    // Text node: the typed message IS the answer.
    if (input.kind === "text" && state.field && state.textNext) {
      const data = { ...state.data, [state.field]: input.text.trim() };
      const r = await this.follow(ctx, state.flow, state.textNext, data, []);
      return { outcome: "sent", ...r };
    }

    // Free text at an MCQ node → router decides (webhook calls resolveOption /
    // restart afterwards).
    if (input.kind === "text") {
      return { outcome: "needs_router", state };
    }

    // Tap: exact match against the options the customer was shown. The tapped
    // id/title ride along in data (_tapped/_tappedTitle) so action nodes can
    // decode value-carrying ids (bk:slot:<iso>, bk:pest:<type>, …).
    const option = (state.options ?? []).find((o) => o.id === input.id);
    if (!option) {
      // Stale message (customer tapped an old MCQ) — re-present where they are.
      const r = await this.represent(ctx, state);
      return { outcome: "sent", ...r };
    }
    const data = { ...state.data, _tapped: option.id, _tappedTitle: option.title };
    const r = await this.follow(ctx, state.flow, option.next, data, []);
    return { outcome: "sent", ...r };
  }

  /** Router verdict "select this option" — same path as a real tap. */
  async selectOption(
    ctx: FlowContext,
    state: FlowState,
    optionId: string
  ): Promise<{ sends: Send[]; state: FlowState | null }> {
    const option = (state.options ?? []).find((o) => o.id === optionId);
    if (!option) return this.represent(ctx, state);
    const data = { ...state.data, _tapped: option.id, _tappedTitle: option.title };
    return this.follow(ctx, state.flow, option.next, data, []);
  }

  /** Re-send the prompt for the node the customer is parked on. */
  async represent(
    ctx: FlowContext,
    state: FlowState
  ): Promise<{ sends: Send[]; state: FlowState | null }> {
    return this.enter(ctx, { flow: state.flow, node: state.node }, state.data, []);
  }

  // --- internals -------------------------------------------------------------

  private flow(id: string): FlowDef {
    const f = this.flows[id];
    if (!f) throw new Error(`Unknown flow: ${id}`);
    return f;
  }

  private async follow(
    ctx: FlowContext,
    flowId: string,
    next: NextRef,
    data: Record<string, unknown>,
    sends: Send[]
  ): Promise<{ sends: Send[]; state: FlowState | null }> {
    if (typeof next === "object" && "end" in next) {
      return { sends, state: null };
    }
    if (typeof next === "object" && "goto" in next) {
      return this.enter(ctx, { flow: next.goto.flow, node: next.goto.node }, data, sends);
    }
    return this.enter(ctx, { flow: flowId, node: next }, data, sends);
  }

  private async enter(
    ctx: FlowContext,
    at: { flow: string; node: string },
    data: Record<string, unknown>,
    sends: Send[]
  ): Promise<{ sends: Send[]; state: FlowState | null }> {
    let flowId = at.flow;
    let nodeId = at.node;
    let currentData = data;

    for (let hops = 0; hops < MAX_ACTION_HOPS; hops++) {
      const node = this.flow(flowId).nodes[nodeId];
      if (!node) throw new Error(`Unknown node ${flowId}.${nodeId}`);

      if (node.kind === "action") {
        const result = await node.run(ctx, currentData);
        sends.push(...result.sends);
        currentData = { ...currentData, ...(result.data ?? {}) };
        const next = result.next;
        if (typeof next === "object" && "end" in next) return { sends, state: null };
        if (typeof next === "object" && "goto" in next) {
          flowId = next.goto.flow;
          nodeId = next.goto.node;
        } else {
          nodeId = next;
        }
        continue;
      }

      // Prompt node: send it and park.
      const prompt = await node.prompt(ctx, currentData);
      sends.push(prompt.send);
      return { sends, state: stateFor(flowId, nodeId, currentData, prompt) };
    }
    throw new Error(`Flow ${flowId} exceeded ${MAX_ACTION_HOPS} action hops (cycle?)`);
  }
}

function stateFor(
  flow: string,
  node: string,
  data: Record<string, unknown>,
  prompt: NodePrompt
): FlowState {
  const base = { flow, node, data, updated_at: new Date().toISOString() };
  if (prompt.kind === "mcq") return { ...base, options: prompt.options };
  return { ...base, field: prompt.field, textNext: prompt.next };
}

// Persisted jsonb → FlowState, defensively (schema could drift across deploys).
export function parseFlowState(raw: unknown): FlowState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<FlowState>;
  if (typeof s.flow !== "string" || typeof s.node !== "string") return null;
  return {
    flow: s.flow,
    node: s.node,
    data: s.data && typeof s.data === "object" ? (s.data as Record<string, unknown>) : {},
    options: Array.isArray(s.options) ? s.options : undefined,
    field: typeof s.field === "string" ? s.field : undefined,
    textNext: s.textNext,
    updated_at: typeof s.updated_at === "string" ? s.updated_at : new Date(0).toISOString()
  };
}
