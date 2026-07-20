import { FlowEngine } from "../engine";
import { bookingFlow } from "./booking";
import { manageFlow } from "./manage";

// The registered flow graph. Adding a flow = one definition file + one entry here.
export const FLOWS = {
  [bookingFlow.id]: bookingFlow,
  [manageFlow.id]: manageFlow
} as const;

// Singleton engine over the registry — definitions are stateless, so one
// instance serves every request.
let _engine: FlowEngine | null = null;
export function flowEngine(): FlowEngine {
  if (!_engine) _engine = new FlowEngine(FLOWS);
  return _engine;
}
