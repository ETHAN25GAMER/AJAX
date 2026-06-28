import { supabase } from "@/lib/supabase/client";
const PHONE = "+919653411753";
async function main() {
  const db = supabase();
  const { data: cust } = await db.from("customers").select("id, name, phone").eq("phone", PHONE).maybeSingle();
  if (!cust) { console.log("no customer for", PHONE); return; }
  const up = await db.from("conversations").upsert(
    { customer_id: cust.id, state_json: [], last_message_at: new Date().toISOString() },
    { onConflict: "customer_id" }
  );
  if (up.error) throw new Error(up.error.message);
  console.log("✓ conversation history cleared for", cust.name, PHONE);
}
main().catch((e) => { console.error(e); process.exit(1); });
