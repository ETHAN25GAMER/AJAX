/** Is the wa_messages dedup table (migration 0011) present yet? */
import { supabase } from "@/lib/supabase/client";

async function main() {
  const { error } = await supabase().from("wa_messages").select("id").limit(1);
  console.log(error ? `MISSING — ${error.message}` : "wa_messages exists — webhook can run");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
