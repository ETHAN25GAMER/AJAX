// Deterministic MCQ flow engine — shared shapes.
//
// A flow is a graph of nodes. Two node behaviours:
//   * prompt nodes — compute an MCQ (buttons/list) or a text question, send it,
//     and WAIT. The resolved options are persisted into flow_state so a later
//     tap routes without recomputing anything (slot lists change; the message
//     the customer tapped must keep meaning what it said).
//   * action nodes — perform effects (call a booking tool, escalate), emit
//     any sends, and hand control to the next node immediately.
//
// The engine walks action nodes until it reaches a prompt node (or the flow
// ends), so one inbound tap can quote, branch, and present the next MCQ in a
// single pass. No LLM is involved anywhere in this file's world — free text at
// an MCQ node is the router's problem (lib/flows/router.ts).

export type FlowContext = {
  customerPhone: string; // E.164, from the verified webhook sender
  customerId: string;
};

// What the engine wants sent to the customer, in order.
export type Send =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: Array<{ id: string; title: string }> }
  | {
      kind: "list";
      body: string;
      buttonLabel: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    };

// Where an option leads: a node id in the same flow, a cross-flow jump, or end.
export type NextRef = string | { goto: { flow: string; node: string } } | { end: true };

export type PromptOption = { id: string; title: string; next: NextRef };

export type NodePrompt =
  | { kind: "mcq"; send: Send; options: PromptOption[] }
  | { kind: "text"; send: Send; field: string; next: NextRef };

export type ActionResult = {
  sends: Send[];
  next: NextRef;
  /** Merged into flow data before continuing. */
  data?: Record<string, unknown>;
};

export type FlowNode =
  | {
      kind: "prompt";
      prompt: (ctx: FlowContext, data: Record<string, unknown>) => Promise<NodePrompt>;
    }
  | {
      kind: "action";
      run: (ctx: FlowContext, data: Record<string, unknown>) => Promise<ActionResult>;
    };

export type FlowDef = {
  id: string;
  entry: string;
  nodes: Record<string, FlowNode>;
};

// Persisted on conversations.flow_state. `options`/`field`/`textNext` mirror
// the prompt the customer is currently looking at.
export type FlowState = {
  flow: string;
  node: string;
  data: Record<string, unknown>;
  options?: PromptOption[];
  field?: string;
  textNext?: NextRef;
  updated_at: string;
};

export type FlowInput =
  | { kind: "tap"; id: string; title: string }
  | { kind: "text"; text: string };

export type AdvanceResult =
  | { outcome: "sent"; sends: Send[]; state: FlowState | null }
  // Free text arrived at an MCQ node — the router must decide.
  | { outcome: "needs_router"; state: FlowState };
