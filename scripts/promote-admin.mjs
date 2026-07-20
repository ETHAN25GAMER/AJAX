import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const targetEmail = process.argv[2];
if (!targetEmail) {
  console.error("Usage: node scripts/promote-admin.mjs <email>");
  process.exit(1);
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: users, error: uErr } = await db.auth.admin.listUsers();
if (uErr) throw uErr;
const user = users.users.find((u) => u.email === targetEmail);
if (!user) {
  console.error(`No auth user with email ${targetEmail}`);
  process.exit(1);
}

const { data, error } = await db
  .from("profiles")
  .update({ role: "admin" })
  .eq("id", user.id)
  .select("id, role")
  .single();

if (error) throw error;
console.log(`Promoted ${targetEmail} (${data.id}) to role=${data.role}`);
