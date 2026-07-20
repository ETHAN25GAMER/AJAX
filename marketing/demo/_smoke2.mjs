// Real production entry point (window.replay()), truncated to ~40s so it
// only needs to reach partway through the new chapter-2 tour. Checks for
// console/page errors during the actual scripted timeline, not a synthetic one.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "whatsapp-live-demo.html");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"]
});

const errors = [];
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message + "\n" + (e.stack ?? "")));

  await page.goto(pathToFileURL(SRC).href, { waitUntil: "load" });
  await page.addStyleTag({ content: ".replay{display:none!important}" });
  await sleep(300);
  await page.evaluate(() => window.replay && window.replay()); // supersedes the auto-started run

  // Sample progress periodically: which scene, chapter eyebrow, chat length,
  // and admin sidebar highlight — to see exactly where it stalls/errors.
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const snap = await page.evaluate(() => ({
      scene: document.querySelector(".scene.on")?.id ?? null,
      chapter: document.getElementById("chapter")?.textContent ?? null,
      chatRows: document.getElementById("chat")?.children.length ?? 0,
      adminPage: document.querySelector("#bside .nav.on")?.dataset.key ?? null
    }));
    const tag = `${snap.scene}|${snap.chapter}|chat:${snap.chatRows}|admin:${snap.adminPage}`;
    if (seen[seen.length - 1] !== tag) seen.push(tag);
    if (errors.length > 0) break; // stop as soon as we catch the error, for a tight stack trace
  }

  console.log("Progress trace:\n" + seen.join("\n"));
  console.log("\nconsole/page errors:", errors.length);
  errors.forEach((e) => console.log("  -", e));
} finally {
  await browser.close();
}
