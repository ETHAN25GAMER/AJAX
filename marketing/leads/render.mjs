// Render the personalised reels to MP4 by driving headless Edge and muxing with ffmpeg.
// Usage:
//   node marketing/leads/render.mjs            -> render ALL reels in ./reels
//   node marketing/leads/render.mjs --stale    -> only reels whose mp4 is missing/older than its html
//   node marketing/leads/render.mjs <slug> ... -> render the named reel(s)
//
// No Chromium download: drives the Edge already installed on this machine.
// Resilient: relaunches the browser if it crashes mid-batch, retries a reel once.
import { readdirSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer-core";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const HERE = dirname(fileURLToPath(import.meta.url));
const REELS_DIR = join(HERE, "reels");
const OUT_DIR = join(HERE, "mp4");
const TMP_ROOT = join(HERE, ".frames");
const PROFILE = join(HERE, ".edge-profile"); // persistent -> no temp-cleanup EBUSY on close

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DUR_MS = 28800;
const OUT_FPS = 60;
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;
async function ensureBrowser() {
  if (browser && browser.connected) return browser;
  if (browser) { try { await browser.close(); } catch {} browser = null; }
  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    userDataDir: PROFILE,
    args: ["--no-sandbox", "--hide-scrollbars", "--disable-background-timer-throttling"]
  });
  return browser;
}

async function renderOne(slug) {
  const src = join(REELS_DIR, `${slug}.html`);
  if (!existsSync(src)) { console.warn(`skip (missing html): ${slug}`); return; }
  const tmp = join(TMP_ROOT, slug);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const b = await ensureBrowser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(src).href, { waitUntil: "load" });
    await page.addStyleTag({ content: ".replay{display:none!important}" });
    await sleep(400);

    const client = await page.createCDPSession();
    const frames = [];
    let i = 0;
    client.on("Page.screencastFrame", async (f) => {
      const fn = `${String(i++).padStart(5, "0")}.jpg`;
      writeFileSync(join(tmp, fn), Buffer.from(f.data, "base64"));
      frames.push({ fn, t: f.metadata.timestamp });
      try { await client.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
    });

    await page.evaluate(() => window.replay && window.replay());
    await client.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    await sleep(DUR_MS);
    await client.send("Page.stopScreencast");
    await sleep(150);
    if (frames.length === 0) throw new Error("no frames captured");

    let list = "";
    for (let k = 0; k < frames.length; k++) {
      const next = k + 1 < frames.length ? frames[k + 1].t : frames[k].t + 1 / OUT_FPS;
      const dur = Math.max(0.001, next - frames[k].t);
      list += `file '${frames[k].fn}'\nduration ${dur.toFixed(4)}\n`;
    }
    list += `file '${frames[frames.length - 1].fn}'\n`;
    writeFileSync(join(tmp, "list.txt"), list);

    mkdirSync(OUT_DIR, { recursive: true });
    execFileSync(ffmpeg.path, [
      "-y", "-f", "concat", "-safe", "0", "-i", "list.txt",
      "-vf", `fps=${OUT_FPS},scale=${W}:${H},format=yuv420p`,
      "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-movflags", "+faststart",
      join(OUT_DIR, `${slug}.mp4`)
    ], { cwd: tmp, stdio: ["ignore", "ignore", "ignore"] });

    console.log(`✓ ${slug}.mp4  (${frames.length} frames)`);
  } finally {
    try { await page.close(); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- selection ---------------------------------------------------------------
const args = process.argv.slice(2);
const stale = args.includes("--stale");
const named = args.filter((a) => !a.startsWith("--")).map((s) => s.replace(/\.html$/, ""));
let slugs = readdirSync(REELS_DIR).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
if (named.length) slugs = named;
if (stale) slugs = slugs.filter((s) => {
  const mp4 = join(OUT_DIR, `${s}.mp4`);
  return !existsSync(mp4) || statSync(mp4).mtimeMs < statSync(join(REELS_DIR, `${s}.html`)).mtimeMs;
});

console.log(`Rendering ${slugs.length} reel(s) -> ${OUT_DIR}`);
let done = 0;
for (const slug of slugs) {
  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
    try { await renderOne(slug); ok = true; done++; }
    catch (e) {
      console.error(`✗ ${slug} (try ${attempt}): ${e.message}`);
      try { if (browser) await browser.close(); } catch {}
      browser = null; // force a fresh browser next attempt/reel
    }
  }
}
try { if (browser) await browser.close(); } catch {}
console.log(`Done. ${done}/${slugs.length} rendered.`);
