import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { ConversationsClient, type ConversationListItem } from "./conversations-client";

export const metadata = { title: "Conversations" };
export const dynamic = "force-dynamic";

type RawRow = {
  id: string;
  customer_id: string;
  last_message_at: string;
  state_json: unknown;
  customers: {
    id: string;
    phone: string;
    name: string | null;
    address: string | null;
  } | null;
};

export default async function ConversationsPage({
  searchParams
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { id: selectedId } = await searchParams;

  const { data, error } = await supabase
    .from("conversations")
    .select("id, customer_id, last_message_at, state_json, customers(id, phone, name, address)")
    .order("last_message_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <div className="surface-paper min-h-dvh px-6 py-16 md:px-12">
        <div className="mx-auto max-w-2xl border border-destructive/40 bg-card px-6 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
            Database error
          </p>
          <p className="mt-2 text-sm text-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  const rows = ((data ?? []) as unknown) as RawRow[];

  const conversations: ConversationListItem[] = rows.map((r) => ({
    id: r.id,
    customer: r.customers,
    last_message_at: r.last_message_at,
    preview: extractPreview(r.state_json),
    state_json: r.state_json
  }));

  return <ConversationsClient initial={conversations} initialSelectedId={selectedId ?? null} />;
}

// Walks the conversation history backwards to find the most recent piece of
// human-readable text. Falls back to a tool name when the last turn is a
// tool call, or empty when the conversation is brand-new.
function extractPreview(state: unknown): { text: string; from: "user" | "assistant" | "tool" } | null {
  if (!Array.isArray(state)) return null;
  for (let i = state.length - 1; i >= 0; i--) {
    const msg = state[i] as { role?: string; content?: unknown };
    if (!msg || typeof msg !== "object") continue;
    const text = firstText(msg.content);
    if (text) {
      const from =
        msg.role === "user" || msg.role === "assistant" ? (msg.role as "user" | "assistant") : "tool";
      return { text, from };
    }
  }
  return null;
}

function firstText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string; name?: string };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) return b.text.trim();
  }
  return null;
}
