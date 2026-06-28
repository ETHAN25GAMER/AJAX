# Local WhatsApp bot testing (free, no Anthropic key)

How to exercise the live WhatsApp agent end-to-end on your own machine without
paying for the Anthropic API. Distilled from a long debugging session so the next
run is ~10 minutes instead of hours.

## The architecture (why this works)

The app always speaks the **Anthropic SDK** (`/v1/messages`). For local testing we
point `ANTHROPIC_BASE_URL` at a **LiteLLM proxy** that accepts Anthropic-format
requests and forwards them to **Ollama**. So no code changes — just env vars.

```
WhatsApp (Meta) → public tunnel → localhost:3000 (Next dev)
                                      → agent → Anthropic SDK
                                          → LiteLLM proxy :4000 → Ollama :11434 → model
```

Production is the opposite: leave `ANTHROPIC_BASE_URL` unset and the SDK hits
`api.anthropic.com` with a real key (see [pre-deploy checklist]).

## The model reality (the actual hard part)

The agent fires **11 structured tools**, so the model MUST support tool-calling.
On this machine:

| Model | Tools? | Speed | Verdict |
|-------|--------|-------|---------|
| `gemma4:latest` (9.6GB) | ✅ | ❌ too slow → request timeout | unusable |
| `gemma3:4b` (3.3GB) | ❌ Ollama: "does not support tools" | ✅ fast | unusable |
| `kimi-k2.6:cloud` (Ollama Cloud) | ✅ | ✅ | ❌ now requires paid Ollama subscription |
| **`qwen2.5:7b-instruct`** (4.7GB) | ✅ | ⚠️ moderate | **best free local option — use this** |
| `llama3.1:8b` (4.9GB) | ✅ | ⚠️ moderate | fallback |
| Claude Sonnet 4.6 | ✅ | ✅ | production (needs card) |

**Takeaway:** for a real free local test, use `qwen2.5:7b-instruct`
(`ollama pull qwen2.5:7b-instruct`). Gemma is a dead end for the agent (fast one
can't do tools, tool-capable one is too slow). Plain-text "is the wire alive"
checks work on anything via `scripts/ping-llm.ts`.

## Step-by-step

### 0. One-time machine fixes (this environment)
- **Move the project out of OneDrive** (e.g. `C:\dev\PESTLLM`). OneDrive syncs the
  `.next` folder mid-build and corrupts it (`ENOENT routes-manifest.json`,
  `Cannot find module './NNN.js'`). If you can't move it, **pause OneDrive** while
  the dev server runs.
- This network does **TLS inspection + UDP/QUIC throttling**. That breaks Node fetch
  (hence `NODE_OPTIONS=--use-system-ca`), LiteLLM's cost-map fetch, and cloudflared.

### 1. Ollama (already running as a service)
```powershell
ollama pull qwen2.5:7b-instruct   # free, local, supports tools
```

### 2. LiteLLM proxy — terminal 1
LiteLLM is at `C:\Users\<you>\AppData\Local\Programs\Python\Python312\Scripts\litellm.exe`.
Two env vars are **required on Windows** or it crashes / errors:
```powershell
$env:PYTHONUTF8 = "1"                       # else the Unicode startup banner crashes (cp1252)
$env:LITELLM_LOCAL_MODEL_COST_MAP = "True"  # else it fails fetching the remote cost map (TLS)
litellm --config litellm-config.yaml --port 4000
```
`qwen2.5:7b-instruct` is already registered in `litellm-config.yaml` as
`ollama/qwen2.5:7b-instruct`.

### 3. .env.local — point the bot at the proxy
```
ANTHROPIC_API_KEY=sk-local
ANTHROPIC_BASE_URL=http://localhost:4000
ANTHROPIC_MODEL=ollama/qwen2.5:7b-instruct
```
(`.env.local` is local-only and never goes to Vercel. For prod, `ANTHROPIC_BASE_URL`
MUST be unset or every customer message hits this dead local proxy.)

### 4. Dev server — terminal 2
Run it in your **own terminal** (a real TTY) so it stays up:
```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm run dev    # http://localhost:3000
```

### 5. Public tunnel — terminal 3
cloudflared does NOT work on this network (QUIC throttled, HTTP/2 cert-rejected by
TLS inspection). **SSH-based tunnels do** — they use port 22/TCP with their own
crypto, dodging both problems:
```powershell
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=20 -R 80:localhost:3000 serveo.net
# → https://<random>.serveousercontent.com   (no warning page, clean passthrough)
```
Caveat: free anonymous SSH tunnels (serveo / localhost.run) still get **reset by
this network after a few minutes**. For a *stable* session, tether to a **phone
hotspot** (no SSL inspection, no UDP throttle) — then any tunnel is rock-solid.

### 6. Meta webhook (developers.facebook.com → your app → WhatsApp → Configuration)
- **Callback URL:** `https://<tunnel-url>/api/whatsapp/webhook`
- **Verify token:** value of `WHATSAPP_VERIFY_TOKEN` in `.env.local`
- Click **Verify and save**, then **Webhook fields → Manage → subscribe to `messages`**
- If using the Meta test number, add your phone to the **allowed recipients** list.
- Re-paste the URL whenever the tunnel restarts (it changes each time).

### 7. Test
Send ONE message from your phone, then **wait 30–60s** (local models are slow;
don't double-send or replies desync). Watch the dev server log. The webhook
returns 200 immediately and runs the agent in `after()`.

## Things that bit us (so they don't bite you)

- **Webhook returns 200 but no reply** → look for `[whatsapp webhook] agent failed`
  in the dev log. `sendWhatsApp` throws on any non-2xx Graph response.
- **Reply unrelated to your message** → conversation history accumulates
  (`conversations.state_json` per customer). Clear it for a fresh test
  (`scripts/clear-convo.ts` pattern), and remember replies lag, so message N's
  reply can arrive when you've already sent N+1.
- **`status` callbacks** (sent/delivered) also POST to the webhook and parse to
  `null` — that's correct, they're skipped, not a bug.
- **Orphaned dev servers**: `npx next dev` can leave a `next-server` child holding
  the port after the wrapper exits. Kill stray ones by command line, not just by
  port, before restarting (`Get-CimInstance Win32_Process` filter on `next`).

## Quick "is the wire alive" check (no WhatsApp, no tunnel)
```powershell
$env:ANTHROPIC_BASE_URL="http://localhost:4000"; $env:ANTHROPIC_MODEL="ollama/qwen2.5:7b-instruct"; $env:ANTHROPIC_API_KEY="sk-local"
npx tsx scripts/ping-llm.ts
```

[pre-deploy checklist]: see the session memory / `project-pre-deploy-checklist`.
