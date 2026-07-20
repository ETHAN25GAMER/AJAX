// Render the WhatsApp live-demo animation to MP4 (adapted from marketing/leads/render.mjs).
// Usage: node marketing/demo/render-demo.mjs
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer-core";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "whatsapp-live-demo.html");
const OUT = join(HERE, "whatsapp-live-demo.mp4");
const TMP = join(HERE, ".frames");
const PROFILE = join(process.env.TEMP ?? HERE, `demo-chrome-profile-${Date.now()}`);

const EDGE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// Chapter 2 now tours all 12 admin sections (was a single Appointments beat),
// adding ~17.4s of real playback at the script's SPEED=1.6 multiplier.
const DUR_MS = 105000;
const OUT_FPS = 60;
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  userDataDir: PROFILE,
  args: ["--no-sandbox", "--hide-scrollbars", "--disable-background-timer-throttling"]
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(SRC).href, { waitUntil: "load" });
  await page.addStyleTag({ content: ".replay{display:none!important}" });
  await sleep(300);

  const client = await page.createCDPSession();
  const frames = [];
  let i = 0;
  client.on("Page.screencastFrame", async (f) => {
    const fn = `${String(i++).padStart(5, "0")}.jpg`;
    writeFileSync(join(TMP, fn), Buffer.from(f.data, "base64"));
    frames.push({ fn, t: f.metadata.timestamp });
    try { await client.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
  });

  await page.evaluate(() => window.replay && window.replay());
  await client.send("Page.startScreencast", { format: "jpeg", quality: 98, everyNthFrame: 1 });
  await sleep(DUR_MS);
  await client.send("Page.stopScreencast");
  await sleep(200);
  if (frames.length === 0) throw new Error("no frames captured");

  let list = "";
  for (let k = 0; k < frames.length; k++) {
    const next = k + 1 < frames.length ? frames[k + 1].t : frames[k].t + 1 / OUT_FPS;
    const dur = Math.max(0.001, next - frames[k].t);
    list += `file '${frames[k].fn}'\nduration ${dur.toFixed(4)}\n`;
  }
  list += `file '${frames[frames.length - 1].fn}'\n`;
  writeFileSync(join(TMP, "list.txt"), list);

  execFileSync(ffmpeg.path, [
    "-y", "-f", "concat", "-safe", "0", "-i", "list.txt",
    "-vf", `fps=${OUT_FPS},scale=${W}:${H},format=yuv420p`,
    "-c:v", "libx264", "-crf", "17", "-preset", "veryfast", "-movflags", "+faststart",
    OUT
  ], { cwd: TMP, stdio: ["ignore", "ignore", "inherit"] });

  console.log(`done: ${OUT} (${frames.length} frames)`);
} finally {
  try { await browser.close(); } catch {}
  rmSync(TMP, { recursive: true, force: true });
}
