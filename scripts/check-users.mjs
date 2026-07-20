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

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: users, error: uErr } = await db.auth.admin.listUsers();
if (uErr) {
  console.log("auth.users query FAILED:", uErr.message);
} else {
  console.log(`auth.users: ${users.users.length} account(s)`);
  for (const u of users.users) {
    console.log(`  - ${u.email}  confirmed=${!!u.email_confirmed_at}  id=${u.id}`);
  }
}

const { data: profiles, error: pErr } = await db.from("profiles").select("id, role, full_name");
if (pErr) console.log("profiles query FAILED:", pErr.message);
else {
  console.log(`profiles: ${profiles.length} row(s)`);
  for (const p of profiles) console.log(`  - ${p.id} role=${p.role} name=${p.full_name}`);
}
