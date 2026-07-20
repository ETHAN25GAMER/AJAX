# Deploy PestLLM to Vercel production.
#
# One-time prereq (interactive, browser): vercel login
# Then: .\scripts\deploy-vercel.ps1
#
# What it does:
#   1. Links the Vercel project if not yet linked.
#   2. Pushes production env vars from .env.local (allowlist below).
#      It deliberately does NOT push ANTHROPIC_BASE_URL / ANTHROPIC_MODEL /
#      ANTHROPIC_MODEL_VISION - prod must use the code defaults (Fable 5 +
#      Haiku against api.anthropic.com). If ANTHROPIC_BASE_URL leaks into
#      prod, every customer message silently routes to the dead local proxy.
#   3. Prompts for your real Anthropic API key (never stored in this repo).
#   4. Runs `vercel deploy --prod` and prints the post-deploy checklist.

$ErrorActionPreference = "Stop"
$env:NODE_OPTIONS = "--use-system-ca"  # this machine's TLS inspection requires system CAs

Set-Location (Join-Path $PSScriptRoot "..")

# --- 1. Auth + link ---------------------------------------------------------
vercel whoami | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Not logged in to Vercel. Run 'vercel login' first, then re-run this script."
    exit 1
}

if (-not (Test-Path ".vercel/project.json")) {
    vercel link --yes
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

# --- 2. Read .env.local -----------------------------------------------------
$envMap = @{}
Get-Content ".env.local" | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $envMap[$name] = $value
}

# Vars copied verbatim from .env.local into Vercel Production.
$prodVars = @(
    "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN",
    "TECHNICIAN_ESCALATION_PHONE",
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "CRON_SECRET",
    "NEXT_PUBLIC_COMPANY_NAME", "NEXT_PUBLIC_ASSISTANT_NAME", "NEXT_PUBLIC_APP_NAME",
    "COMPANY_NAME", "DPO_NAME", "DPO_EMAIL"
)

if ($envMap["TECHNICIAN_ESCALATION_PHONE"] -like "*...*") {
    Write-Warning "TECHNICIAN_ESCALATION_PHONE in .env.local is still a placeholder ($($envMap['TECHNICIAN_ESCALATION_PHONE'])). Escalation alerts will not reach anyone until you set a real number."
}

# --- 3. Real Anthropic key (prod only - dev's sk-local must not ship) -------
$anthropicKey = Read-Host "Paste your REAL Anthropic API key (sk-ant-...)"
if ($anthropicKey -notlike "sk-ant-*") {
    Write-Error "That doesn't look like a real Anthropic key (must start with sk-ant-). Aborting before a broken key reaches prod."
    exit 1
}

function Push-EnvVar([string]$name, [string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Warning "$name is empty in .env.local - skipped. Set it in the Vercel dashboard if needed."
        return
    }
    $value | vercel env add $name production --force
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to set $name"
        exit 1
    }
    Write-Host "  set $name" -ForegroundColor Green
}

# --- 4. Push envs -----------------------------------------------------------
Write-Host "`nPushing production env vars..." -ForegroundColor Cyan
Push-EnvVar "ANTHROPIC_API_KEY" $anthropicKey
foreach ($name in $prodVars) { Push-EnvVar $name $envMap[$name] }

$prodUrl = Read-Host "Production URL for tracking links, e.g. https://pestllm.vercel.app (Enter to skip for now)"
if ($prodUrl) {
    Push-EnvVar "NEXT_PUBLIC_APP_URL" $prodUrl
    Push-EnvVar "NEXT_PUBLIC_SITE_URL" $prodUrl
}

# --- 5. Deploy ---------------------------------------------------------------
Write-Host "`nDeploying to production..." -ForegroundColor Cyan
vercel deploy --prod
if ($LASTEXITCODE -ne 0) { exit 1 }

# --- 6. Post-deploy checklist ------------------------------------------------
Write-Host ""
Write-Host "================= POST-DEPLOY CHECKLIST =================" -ForegroundColor Yellow
Write-Host "1. Meta webhook: developers.facebook.com -> WhatsApp -> Configuration ->"
Write-Host "   set Callback URL to https://<prod-domain>/api/whatsapp/webhook and"
Write-Host "   re-verify with your WHATSAPP_VERIFY_TOKEN."
Write-Host "2. If you skipped the production URL above: set NEXT_PUBLIC_APP_URL and"
Write-Host "   NEXT_PUBLIC_SITE_URL in Vercel, then 'vercel deploy --prod' again"
Write-Host "   (customer tracking links are broken until then)."
Write-Host "3. Supabase: confirm ALL migrations 0001-0020 are applied in filename order"
Write-Host "   (0016 removes deployment_settings; 0020 removes service tiers -"
Write-Host "   'select pest_type, base_price from pricing;' should show one row per pest)."
Write-Host "4. Smoke-test from your phone: 'Hi' -> greeting; price question -> quote tool;"
Write-Host "   photo -> identify_pest. First reply confirms the model + key are live."
Write-Host "5. Optional features need their env vars set in Vercel to activate:"
Write-Host "   WHATSAPP_FLOW_CSAT_ID, GOOGLE_REVIEW_URL, RAZORPAY_KEY_ID/_SECRET/"
Write-Host "   _WEBHOOK_SECRET, RAZORPAY_DEPOSIT_AMOUNT. All degrade cleanly if unset."
Write-Host "6. Vercel HOBBY plan only allows 2 cron jobs, each once per DAY - this"
Write-Host "   project's vercel.json declares 8 (some every 5-15 min), so the deploy"
Write-Host "   fails on Hobby unless you trim vercel.json or upgrade to Pro."
Write-Host "==========================================================" -ForegroundColor Yellow
