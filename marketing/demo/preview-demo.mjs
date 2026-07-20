// Dev aid: screenshot the demo animation at checkpoints (writes PNGs to --out dir).
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "whatsapp-live-demo.html");
const OUTDIR = process.argv[2] ?? HERE;
const EDGE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  userDataDir: join(process.env.TEMP, `demo-chrome-profile-${Date.now()}`),
  args: ["--no-sandbox", "--hide-scrollbars"]
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE:", m.text()); });
await page.goto(pathToFileURL(SRC).href, { waitUntil: "load" });

const marks = [8000, 26000, 36000, 44000, 56000, 66000];
let elapsed = 0;
for (const t of marks) {
  await sleep(t - elapsed); elapsed = t;
  await page.screenshot({ path: join(OUTDIR, `shot-${t / 1000}s.png`) });
  console.log(`shot at ${t / 1000}s`);
}
await browser.close();
