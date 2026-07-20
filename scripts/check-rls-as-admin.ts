/**
 * Definitive RLS test: sign in as the admin user (server-minted magic link,
 * never emailed) and run the conversations page's exact query through RLS.
 */
import { createClient } from "@supabase/supabase-js";
import { supabase as serviceClient } from "@/lib/supabase/client";

async function main() {
  const admin = serviceClient();

  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 50 });
  if (users.error) throw users.error;

  const profiles = await admin.from("profiles").select("id, role, full_name");
  if (profiles.error) throw profiles.error;
  const roleById = new Map(profiles.data.map((p) => [p.id, p.role]));

  for (const u of users.data.users) {
    console.log(`auth user: ${u.email ?? u.id} — role ${roleById.get(u.id) ?? "NO PROFILE ROW"}`);
  }

  const adminUser = users.data.users.find((u) => roleById.get(u.id) === "admin");
  if (!adminUser?.email) throw new Error("No admin user with an email found.");
  console.log(`\nTesting as admin: ${adminUser.email}`);

  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: adminUser.email
  });
  if (link.error) throw link.error;

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const session = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties.hashed_token
  });
  if (session.error) throw session.error;
  console.log("Signed in OK via magic link.");

  // The conversations page's exact query, now under RLS as the admin user.
  const q = await anon
    .from("conversations")
    .select(
      "id, customer_id, last_message_at, state_json, agent_paused, paused_at, customers(id, phone, name, address)"
    )
    .order("last_message_at", { ascending: false })
    .limit(500);

  if (q.error) {
    console.log("QUERY ERROR:", q.error.message);
  } else {
    console.log(`RLS returns ${q.data.length} conversation(s) to the admin user.`);
    for (const row of q.data) {
      const c = row.customers as unknown as { phone: string } | null;
      const turns = Array.isArray(row.state_json) ? row.state_json.length : 0;
      console.log(`  - ${c?.phone ?? "?"} — ${turns} transcript turns`);
    }
  }

  await anon.auth.signOut();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
