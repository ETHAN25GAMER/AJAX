"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  Hand,
  Inbox,
  MessageSquare,
  Phone,
  Search,
  Send,
  User,
  Wrench,
  X
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/relative-time";
import { pauseAgent, resumeAgent, sendStaffReply } from "./actions";

export type ConversationListItem = {
  id: string;
  customer: {
    id: string;
    phone: string;
    name: string | null;
    address: string | null;
  } | null;
  last_message_at: string;
  preview: { text: string; from: "user" | "assistant" | "tool" } | null;
  state_json: unknown;
  agent_paused: boolean;
  paused_at: string | null;
};

export function ConversationsClient({
  initial,
  initialSelectedId
}: {
  initial: ConversationListItem[];
  initialSelectedId: string | null;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationListItem[]>(initial);
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabaseRef.current>["channel"]> | null>(
    null
  );

  if (!supabaseRef.current) supabaseRef.current = createSupabaseBrowserClient();

  // Server re-renders (revalidatePath after an action) hand down fresh rows.
  useEffect(() => setConversations(initial), [initial]);

  // Supabase Realtime: a customer replying, or another admin taking over /
  // replying, updates the conversations row — reflect it without a refresh.
  useEffect(() => {
    const supabase = supabaseRef.current!;
    let cancelled = false;

    (async () => {
      // RLS on the realtime stream uses the user's JWT, not the anon key.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      const channel = supabase
        .channel("conversations-inbox")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversations" },
          (payload) => {
            const next = payload.new as Pick<
              ConversationListItem,
              "id" | "last_message_at" | "state_json" | "agent_paused" | "paused_at"
            >;
            setConversations((prev) =>
              sortByRecency(
                prev.map((c) =>
                  c.id === next.id
                    ? {
                        ...c,
                        last_message_at: next.last_message_at,
                        state_json: next.state_json,
                        agent_paused: next.agent_paused,
                        paused_at: next.paused_at,
                        preview: extractPreview(next.state_json) ?? c.preview
                      }
                    : c
                )
              )
            );
          }
        )
        .subscribe();

      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      const ch = channelRef.current;
      if (ch) {
        supabaseRef.current?.removeChannel(ch);
        channelRef.current = null;
      }
    };
  }, []);

  const selectedId = search.get("id") ?? initialSelectedId;
  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = c.customer?.name?.toLowerCase() ?? "";
      const phone = c.customer?.phone?.toLowerCase() ?? "";
      const preview = c.preview?.text.toLowerCase() ?? "";
      return name.includes(q) || phone.includes(q) || preview.includes(q);
    });
  }, [conversations, query]);

  const select = useCallback(
    (id: string) => {
      const params = new URLSearchParams(search.toString());
      params.set("id", id);
      router.replace(`/admin/conversations?${params.toString()}`, { scroll: false });
      setMobileOpen(true);
    },
    [router, search]
  );

  const clearSelection = useCallback(() => {
    const params = new URLSearchParams(search.toString());
    params.delete("id");
    const next = params.toString();
    router.replace(`/admin/conversations${next ? `?${next}` : ""}`, { scroll: false });
    setMobileOpen(false);
  }, [router, search]);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto flex max-w-6xl flex-col px-5 py-10 md:px-10 md:py-14">
        <Header
          total={conversations.length}
          filtered={filtered.length}
          hasQuery={query.trim() !== ""}
        />

        <div className="mt-8 grid gap-6 md:grid-cols-[340px_1fr]">
          {/* List pane */}
          <aside
            className={cn(
              "flex flex-col border border-border bg-card",
              mobileOpen && "hidden md:flex"
            )}
          >
            <div className="border-b border-border p-3">
              <label className="relative block">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, phone, or message…"
                  className="w-full border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                />
              </label>
            </div>

            <ul className="max-h-[70dvh] overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  No conversations match.
                </li>
              ) : (
                filtered.map((c, i) => (
                  <ConversationListRow
                    key={c.id}
                    convo={c}
                    selected={c.id === selectedId}
                    index={i}
                    onSelect={() => select(c.id)}
                  />
                ))
              )}
            </ul>
          </aside>

          {/* Transcript pane */}
          <section
            className={cn(
              "border border-border bg-card",
              !mobileOpen && "hidden md:block",
              "min-h-[60dvh]"
            )}
          >
            {selected ? (
              <ConversationDetail convo={selected} onBack={clearSelection} />
            ) : (
              <DetailEmpty />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Header({
  total,
  filtered,
  hasQuery
}: {
  total: number;
  filtered: number;
  hasQuery: boolean;
}) {
  return (
    <header>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Customer history · Transcripts
      </p>
      <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
        Conversations.
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        {total === 0
          ? "No conversations yet."
          : hasQuery
          ? `Showing ${filtered} of ${total}.`
          : `${total} customer${total === 1 ? "" : "s"} on file.`}
      </p>
    </header>
  );
}

function ConversationListRow({
  convo,
  selected,
  index,
  onSelect
}: {
  convo: ConversationListItem;
  selected: boolean;
  index: number;
  onSelect: () => void;
}) {
  const name = convo.customer?.name?.trim() || null;
  const phone = convo.customer?.phone ?? "—";

  return (
    <li
      className={cn(
        "border-b border-border last:border-b-0 animate-card-in",
        selected && "bg-accent/40"
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full px-4 py-3 text-left transition-colors hover:bg-accent/40 focus:bg-accent/40 focus:outline-none"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "truncate text-[14px] leading-tight text-ink",
              name ? "font-serif text-[16px]" : "font-mono"
            )}
          >
            {convo.agent_paused && (
              <Hand
                className="mr-1.5 inline h-3 w-3 -translate-y-px text-primary"
                aria-label="Human takeover active"
              />
            )}
            {name ?? phone}
          </span>
          <RelativeTime
            as="time"
            iso={convo.last_message_at}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
          />
        </div>
        {name && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{phone}</p>
        )}
        {convo.preview && (
          <p
            className={cn(
              "mt-1.5 line-clamp-2 text-[12px] leading-snug",
              convo.preview.from === "assistant" ? "text-foreground/70" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "mr-1.5 font-mono text-[9px] uppercase tracking-[0.16em]",
                convo.preview.from === "assistant" ? "text-primary/80" : "text-muted-foreground/70"
              )}
            >
              {convo.preview.from === "user"
                ? "Cust"
                : convo.preview.from === "assistant"
                ? "Agent"
                : "Tool"}
            </span>
            {convo.preview.text}
          </p>
        )}
      </button>
    </li>
  );
}

function DetailEmpty() {
  return (
    <div className="flex h-full min-h-[60dvh] flex-col items-center justify-center px-8 py-16 text-center">
      <Inbox aria-hidden="true" className="h-8 w-8 text-muted-foreground/40" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        No conversation selected
      </p>
      <h2 className="mt-3 font-serif text-3xl italic text-ink">Pick one from the list.</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Tap a name on the left to read the full back-and-forth between the customer and the
        agent.
      </p>
    </div>
  );
}

function ConversationDetail({
  convo,
  onBack
}: {
  convo: ConversationListItem;
  onBack: () => void;
}) {
  const [showTools, setShowTools] = useState(false);

  const name = convo.customer?.name?.trim() || null;
  const phone = convo.customer?.phone ?? "—";
  const address = convo.customer?.address?.trim() ?? null;

  const turns = useMemo(() => parseTurns(convo.state_json), [convo.state_json]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-5 md:px-7 md:py-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to conversation list"
            className="md:hidden -ml-1 mt-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2
              className={cn(
                "leading-tight text-ink",
                name ? "font-serif text-3xl" : "font-mono text-xl"
              )}
            >
              {name ?? phone}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3 w-3" aria-hidden="true" />
                <span className="font-mono">{phone}</span>
              </span>
              {address && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-muted-foreground/60">·</span>
                  {address}
                </span>
              )}
              <span className="text-muted-foreground/60">·</span>
              <span className="font-mono uppercase tracking-[0.12em]">
                Last activity <RelativeTime iso={convo.last_message_at} />
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TakeoverToggle convo={convo} />
          <button
            type="button"
            onClick={() => setShowTools((v) => !v)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
              showTools ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Wrench className="h-3 w-3" />
            {showTools ? "Hide tools" : "Show tools"}
          </button>
        </div>
      </header>

      {convo.agent_paused && <PausedBanner pausedAt={convo.paused_at} />}

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        {turns.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No messages in this conversation yet.
          </p>
        ) : (
          <ol className="space-y-5">
            {turns.map((t, i) =>
              t.kind === "text" ? (
                <TurnBubble key={i} role={t.role} text={t.text} />
              ) : (
                <ToolBlock key={i} turn={t} expanded={showTools} />
              )
            )}
          </ol>
        )}
      </div>

      <ReplyComposer convo={convo} />
    </div>
  );
}

// Ajax is paused on this thread — the webhook records inbound messages but the
// agent stays silent until an admin resumes it.
function PausedBanner({ pausedAt }: { pausedAt: string | null }) {
  return (
    <div className="flex items-center gap-2 border-y border-primary/30 bg-primary/5 px-5 py-2.5 md:px-7">
      <Hand className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
        You have the conversation · Ajax is paused
        {pausedAt && (
          <>
            {" · "}
            <RelativeTime iso={pausedAt} />
          </>
        )}
      </p>
    </div>
  );
}

function TakeoverToggle({ convo }: { convo: ConversationListItem }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const paused = convo.agent_paused;

  const toggle = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = paused ? await resumeAgent(convo.id) : await pauseAgent(convo.id);
      if (!result.ok) setError(result.error);
    });
  }, [convo.id, paused]);

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-60",
          paused
            ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
            : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"
        )}
      >
        {paused ? <Bot className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
        {pending ? "…" : paused ? "Resume Ajax" : "Take over"}
      </button>
      {error && <p className="mt-1 font-mono text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

// Only usable once the agent is paused — sendStaffReply enforces the same rule
// server-side so a stale tab can't talk over a live agent.
function ReplyComposer({ convo }: { convo: ConversationListItem }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = !convo.agent_paused;

  const submit = useCallback(() => {
    const body = text.trim();
    if (!body) return;
    setError(null);
    startTransition(async () => {
      const result = await sendStaffReply(convo.id, body);
      if (result.ok) setText("");
      else setError(result.error);
    });
  }, [convo.id, text]);

  return (
    <div className="border-t border-border bg-background/60 px-4 py-3 md:px-7 md:py-4">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter newlines — standard chat behaviour.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled || pending}
          rows={2}
          placeholder={
            disabled ? "Take over the conversation to reply…" : "Reply as the team on WhatsApp…"
          }
          className={cn(
            "min-h-[44px] flex-1 resize-y border border-border bg-background px-3 py-2 text-[13px] text-foreground",
            "placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || pending || text.trim() === ""}
          className={cn(
            "inline-flex items-center gap-1.5 border border-border bg-background px-3 py-2 text-[13px] font-medium text-foreground transition-colors",
            "hover:border-primary hover:bg-primary hover:text-primary-foreground",
            "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-background disabled:hover:text-foreground"
          )}
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function TurnBubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";
  return (
    <li className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[80%]", isUser && "text-right")}>
        <p
          className={cn(
            "mb-1 font-mono text-[10px] uppercase tracking-[0.18em]",
            isUser ? "text-muted-foreground" : "text-primary/80"
          )}
        >
          {isUser ? (
            <>
              <User className="mr-1.5 inline h-3 w-3 -translate-y-px" /> Customer
            </>
          ) : (
            <>
              <Bot className="mr-1.5 inline h-3 w-3 -translate-y-px" /> Agent
            </>
          )}
        </p>
        <div
          className={cn(
            "inline-block whitespace-pre-wrap break-words border px-4 py-3 text-[14px] leading-relaxed",
            isUser
              ? "border-border bg-secondary text-foreground"
              : "border-border bg-background text-foreground"
          )}
        >
          {text}
        </div>
      </div>
    </li>
  );
}

function ToolBlock({
  turn,
  expanded
}: {
  turn: ToolTurn;
  expanded: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  return (
    <li>
      <details
        open={open || expanded}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="group border border-dashed border-border bg-background/60"
      >
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">
          <Wrench className="h-3 w-3" aria-hidden="true" />
          <span className="font-mono">
            {turn.kind === "tool_use" ? "Tool · " : "Result · "}
            {turn.name}
          </span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all border-t border-border bg-background px-3 py-3 font-mono text-[11px] text-foreground/80">
{turn.payload}
        </pre>
      </details>
    </li>
  );
}

type Turn =
  | { kind: "text"; role: "user" | "assistant"; text: string }
  | ToolTurn;

type ToolTurn = {
  kind: "tool_use" | "tool_result";
  name: string;
  payload: string;
};

function parseTurns(state: unknown): Turn[] {
  if (!Array.isArray(state)) return [];
  const turns: Turn[] = [];

  for (const msg of state) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as { role?: unknown; content?: unknown };
    const role = m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : null;
    if (!role) continue;

    if (typeof m.content === "string" && m.content.trim()) {
      turns.push({ kind: "text", role, text: m.content });
      continue;
    }

    if (!Array.isArray(m.content)) continue;

    for (const block of m.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as {
        type?: string;
        text?: string;
        name?: string;
        input?: unknown;
        content?: unknown;
        tool_use_id?: string;
        source?: { type?: string };
      };

      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        turns.push({ kind: "text", role, text: b.text });
      } else if (b.type === "image") {
        turns.push({
          kind: "text",
          role,
          text: "📷 (image attachment — view via WhatsApp)"
        });
      } else if (b.type === "tool_use") {
        turns.push({
          kind: "tool_use",
          name: b.name ?? "tool",
          payload: tryStringify(b.input)
        });
      } else if (b.type === "tool_result") {
        turns.push({
          kind: "tool_result",
          name: b.tool_use_id ? b.tool_use_id.slice(0, 8) : "result",
          payload: typeof b.content === "string" ? b.content : tryStringify(b.content)
        });
      }
    }
  }

  return turns;
}

function tryStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sortByRecency(items: ConversationListItem[]): ConversationListItem[] {
  return [...items].sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  );
}

// Client-side twin of the preview extraction in page.tsx — needed when a
// Realtime UPDATE hands us a fresh state_json without a server render.
function extractPreview(
  state: unknown
): { text: string; from: "user" | "assistant" | "tool" } | null {
  if (!Array.isArray(state)) return null;
  for (let i = state.length - 1; i >= 0; i--) {
    const msg = state[i] as { role?: string; content?: unknown };
    if (!msg || typeof msg !== "object") continue;
    const text = firstText(msg.content);
    if (text) {
      const from =
        msg.role === "user" || msg.role === "assistant"
          ? (msg.role as "user" | "assistant")
          : "tool";
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
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) return b.text.trim();
  }
  return null;
}
