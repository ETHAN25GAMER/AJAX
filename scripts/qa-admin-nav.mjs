// One-off QA driver: authenticates directly against Supabase's REST auth
// endpoint with a throwaway temp password (minted via the service-role key so
// the real account password is never touched), builds the exact cookie
// @supabase/ssr expects (see node_modules/@supabase/ssr/dist/module/cookies.js),
// and fetches every admin nav route as that session — no browser needed.
// Reports HTTP status, whether middleware bounced to /login, and a text
// snippet of what rendered. The temp password is invalidated at the end.
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

const TARGET_EMAIL = process.argv[2] || "ethangamez292@gmail.com";
const BASE = "http://localhost:3000";

const NAV = [
  ["Overview", "/admin"],
  ["Escalations", "/admin/escalations"],
  ["Appointments", "/admin/appointments"],
  ["Dispatch", "/admin/dispatch"],
  ["AMC", "/admin/amc"],
  ["Conversations", "/admin/conversations"],
  ["Customers", "/admin/customers"],
  ["Campaigns", "/admin/campaigns"],
  ["Journeys", "/admin/journeys"],
  ["KPI", "/admin/kpi"],
  ["Pricing", "/admin/pricing"],
  ["Users", "/admin/users"]
];

function base64url(str) {
  return Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Mirrors @supabase/ssr's createChunks (chunker.js) closely enough: split the
// URI-encoded value at ~3180 chars per chunk if it's ever that large.
function cookieChunks(name, value) {
  const encoded = encodeURIComponent(value);
  if (encoded.length <= 3180) return [{ name, value }];
  const chunks = [];
  let rest = encoded;
  while (rest.length > 0) {
    const head = rest.slice(0, 3180);
    chunks.push(decodeURIComponent(head));
    rest = rest.slice(head.length);
  }
  return chunks.map((v, i) => ({ name: `${name}.${i}`, value: v }));
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: users, error: uErr } = await db.auth.admin.listUsers();
if (uErr) throw uErr;
const user = users.users.find((u) => u.email === TARGET_EMAIL);
if (!user) throw new Error(`No user ${TARGET_EMAIL}`);

const tempPassword = "Qa-" + Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");
{
  const { error } = await db.auth.admin.updateUserById(user.id, { password: tempPassword });
  if (error) throw error;
}
console.log(`Temp password set for ${TARGET_EMAIL} (invalidated again at the end).`);

const results = [];
try {
  // --- Authenticate directly against Supabase's REST auth endpoint ---
  const tokenRes = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: TARGET_EMAIL, password: tempPassword })
  });
  if (!tokenRes.ok) {
    throw new Error(`Auth failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const session = await tokenRes.json();
  console.log("Authenticated. Session obtained for", session.user?.email);

  // --- Build the exact cookie @supabase/ssr's createServerClient expects ---
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const cookieName = `sb-${ref}-auth-token`;
  const cookieValue = "base64-" + base64url(JSON.stringify(session));
  const chunks = cookieChunks(cookieName, cookieValue);
  const cookieHeader = chunks.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");

  for (const [name, path] of NAV) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: cookieHeader },
      redirect: "manual"
    });
    const status = res.status;
    const location = res.headers.get("location");
    const bouncedToLogin = status >= 300 && status < 400 && (location ?? "").includes("/login");

    let snippet = "";
    let h1 = null;
    let hasDbError = false;
    if (status === 200) {
      const html = await res.text();
      hasDbError = html.includes("Database error");
      const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, "").trim().slice(0, 80) : null;
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
      const text = (bodyMatch ? bodyMatch[1] : html).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      snippet = text.slice(0, 200);
    }

    results.push({ name, path, status, bouncedToLogin, h1, hasDbError, snippet });
  }
} finally {
  const { error } = await db.auth.admin.updateUserById(user.id, {
    password: "invalidated-" + Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")
  });
  if (error) console.error("WARNING: failed to invalidate temp password:", error.message);
  else console.log("Temp password invalidated. Set a real one via Supabase Studio.");
}

console.log("\n=== RESULTS ===");
for (const r of results) {
  const flag = r.status !== 200 ? "FAIL" : r.hasDbError ? "DB-ERROR" : "OK";
  console.log(`\n[${flag}] ${r.name} (${r.path}) — HTTP ${r.status}${r.bouncedToLogin ? " (bounced to /login)" : ""}`);
  if (r.h1) console.log(`  h1: ${r.h1}`);
  if (r.snippet) console.log(`  text: ${r.snippet}`);
}
