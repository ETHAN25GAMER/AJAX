/** Live-test probe: recent inbound ids, flow position, and last transcript turns. */
import { supabase } from "@/lib/supabase/client";

async function main() {
  const db = supabase();
  const [wa, convo] = await Promise.all([
    db.from("wa_messages").select("id, received_at").order("received_at", { ascending: false }).limit(3),
    db
      .from("conversations")
      .select("flow_state, last_message_at, state_json, customers(phone)")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  console.log("recent wa_messages:", JSON.stringify(wa.data ?? wa.error, null, 2));
  if (convo.data) {
    const c = convo.data.customers as unknown as { phone: string } | null;
    const fs = convo.data.flow_state as { flow?: string; node?: string } | null;
    console.log(`conversation: ${c?.phone} — last_message_at ${convo.data.last_message_at}`);
    console.log(`flow position: ${fs ? `${fs.flow}.${fs.node}` : "none (flow ended)"}`);
    const turns = Array.isArray(convo.data.state_json) ? convo.data.state_json : [];
    for (const t of turns.slice(-4) as Array<{ role: string; content: Array<{ text?: string }> }>) {
      const text = (t.content ?? []).map((b) => b.text ?? "").join(" ").slice(0, 120);
      console.log(`  [${t.role}] ${text}`);
    }
  } else {
    console.log("no conversations:", JSON.stringify(convo.error));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
