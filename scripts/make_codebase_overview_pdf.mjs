// Render a markdown doc to a styled PDF by driving the installed browser
// headless and printing to PDF. No Chromium download — reuses the Edge already
// on this machine (same approach as marketing/leads/render.mjs).
//
//   node scripts/make_codebase_overview_pdf.mjs
//   node scripts/make_codebase_overview_pdf.mjs <input.md> "<Title>" "<Subtitle>"
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const argSrc = process.argv[2];
const SRC = argSrc ? resolve(argSrc) : join(ROOT, "docs", "CODEBASE_OVERVIEW.md");
const OUT = SRC.replace(/\.md$/i, ".pdf");
const TITLE = process.argv[3] ?? "PestLLM";
const SUBTITLE = process.argv[4] ?? "Codebase Overview";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const EXE = BROWSERS.find((p) => existsSync(p));
if (!EXE) throw new Error("No Chrome/Edge found to render the PDF.");

// --- tiny markdown -> HTML (headings, tables, fences, lists, blockquote, hr) ---
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s) {
  // escape first, then apply markup so our tags survive
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1"); // drop link URLs, keep label
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

const splitRow = (line) =>
  line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let prose = [];
  const flush = () => {
    if (prose.length) out.push(`<p>${inline(prose.join(" "))}</p>`);
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (t.startsWith("```")) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i]), i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (t.startsWith("|") && /^\|[\s:|-]+\|$/.test((lines[i + 1] || "").trim())) {
      flush();
      const headers = splitRow(t);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i])), i++;
      i--;
      const th = headers.map((h) => `<th>${inline(h)}</th>`).join("");
      const trs = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }
    if (/^#{1,3} /.test(t)) {
      flush();
      const level = t.match(/^#+/)[0].length;
      out.push(`<h${level}>${inline(t.replace(/^#+ /, ""))}</h${level}>`);
    } else if (t === "---") {
      flush();
      out.push("<hr>");
    } else if (t.startsWith(">")) {
      flush();
      out.push(`<blockquote>${inline(t.replace(/^>\s?/, ""))}</blockquote>`);
    } else if (/^[-*] /.test(t)) {
      flush();
      // collect a whole list
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().slice(2))}</li>`);
        i++;
      }
      i--;
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (t === "") {
      flush();
    } else {
      prose.push(t);
    }
  }
  flush();
  return out.join("\n");
}

const CSS = `
  :root { --green:#0a7d3c; --ink:#1a1a1a; --grey:#6b7280; }
  * { box-sizing: border-box; }
  body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: var(--ink);
         font-size: 11pt; line-height: 1.5; margin: 0; }
  .doc { max-width: 720px; margin: 0 auto; }
  .title { text-align: center; margin: 0 0 4px; color: var(--green); font-size: 30pt; font-weight: 700; }
  .subtitle { text-align: center; color: #444; font-size: 15pt; margin: 0 0 18px; }
  h1 { color: var(--green); font-size: 19pt; margin: 22px 0 6px; }
  h2 { color: var(--green); font-size: 15pt; margin: 20px 0 6px; }
  h3 { color: var(--ink); font-size: 12.5pt; margin: 16px 0 4px; }
  p { margin: 0 0 8px; }
  ul { margin: 4px 0 10px; padding-left: 20px; }
  li { margin: 2px 0; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt;
         color: #b03060; background: #f4f6f4; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f4f6f4; border: 1px solid #e2e8e2; border-radius: 6px;
        padding: 12px 14px; overflow-x: auto; page-break-inside: avoid; }
  pre code { color: var(--ink); background: none; padding: 0; font-size: 9pt; line-height: 1.35; }
  blockquote { border-left: 3px solid var(--green); margin: 8px 0; padding: 2px 0 2px 14px;
               color: var(--grey); font-style: italic; }
  hr { border: none; border-top: 1px solid var(--green); margin: 14px 0; opacity: .5; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 10pt;
          page-break-inside: avoid; }
  th { background: var(--green); color: #fff; text-align: left; padding: 6px 9px; }
  td { border: 1px solid #d7e3da; padding: 6px 9px; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f2f8f4; }
  h1, h2, h3 { page-break-after: avoid; }
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="doc">
  <div class="title">${TITLE}</div>
  <div class="subtitle">${SUBTITLE}</div>
  ${mdToHtml(readFileSync(SRC, "utf8"))}
</div></body></html>`;

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: "new",
  args: ["--no-sandbox"]
});
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({
    path: OUT,
    format: "A4",
    printBackground: true,
    margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" }
  });
  console.log(`Saved: ${OUT}`);
} finally {
  await browser.close();
}
