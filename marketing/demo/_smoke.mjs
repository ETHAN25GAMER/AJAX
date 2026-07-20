// Quick smoke test: load the demo HTML, jump straight to a few admin pages
// via showAdminPage(), and check for console/page errors. Does not run the
// full scripted timeline (that's what render-demo.mjs does for real).
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "whatsapp-live-demo.html");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"]
});

const errors = [];
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(pathToFileURL(SRC).href, { waitUntil: "load" });
  await page.addStyleTag({ content: ".replay{display:none!important}" });

  const keys = ["overview", "escalations", "appointments", "dispatch", "amc",
    "conversations", "customers", "campaigns", "journeys", "kpi", "pricing", "users"];

  for (const key of keys) {
    const info = await page.evaluate((k) => {
      showAdminPage(k);
      const active = document.querySelector("#bside .nav.on")?.dataset.key;
      const url = document.getElementById("burl").textContent;
      const bodyLen = document.getElementById("pagebody").innerHTML.trim().length;
      const h2 = document.querySelector("#pagebody h2")?.textContent;
      return { active, url, bodyLen, h2 };
    }, key);
    const ok = info.active === key && info.bodyLen > 20;
    console.log(`[${ok ? "OK" : "FAIL"}] ${key} -> active=${info.active} url=${info.url} h2="${info.h2}" bodyLen=${info.bodyLen}`);
  }

  console.log("\nconsole/page errors:", errors.length);
  errors.forEach((e) => console.log("  -", e));
} finally {
  await browser.close();
}
