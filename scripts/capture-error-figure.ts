import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Runs scripts/error-demo.ts in a child process, captures its real log output,
 * renders it as a terminal-styled image: submission-assets/fig-error-handling.png
 */

const outPath = path.join(process.cwd(), "submission-assets", "fig-error-handling.png");
const tmpStorage = mkdtempSync(path.join(tmpdir(), "tip-errdemo-"));

const child = spawn(process.execPath, ["scripts/error-demo.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", LOCAL_STORAGE_DIR: tmpStorage, LOG_LEVEL: "info" },
});

let text = "";
child.stdout.on("data", (d: Buffer) => (text += d.toString()));
child.stderr.on("data", (d: Buffer) => (text += d.toString()));
const code = await new Promise<number>((resolve) => child.on("close", resolve));
rmSync(tmpStorage, { recursive: true, force: true });
if (code !== 0) throw new Error(`error-demo exited ${code}`);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
const body = lines
  .map((line) => {
    if (line.includes('"level":"error"')) return `<span class="err">${esc(line)}</span>`;
    if (line.includes('"level":"warn"')) return `<span class="warn">${esc(line)}</span>`;
    return esc(line);
  })
  .join("\n");

const html = `<html><head><meta charset="utf-8"><style>
  body { margin:0; background:#0d1117; }
  .bar { padding:9px 14px; background:#161b22; color:#8b949e; font-family:'Segoe UI',sans-serif; font-size:13px; border-bottom:1px solid #21262d; }
  .bar b { color:#e6edf3; font-weight:600; }
  pre { margin:14px 16px; font-family:Consolas,'Courier New',monospace; font-size:12.5px; line-height:1.55; color:#c9d1d9; white-space:pre-wrap; }
  .err { color:#f85149; }
  .warn { color:#d29922; }
</style></head><body>
  <div class="bar"><b>Windows PowerShell</b> — node scripts/error-demo.ts &nbsp;(Pinterest unreachable by design)</div>
  <pre>$ node scripts/error-demo.ts
${body}</pre>
</body></html>`;

const tmpHtml = path.join(process.cwd(), "submission-assets", "_err.html");
const { writeFileSync } = await import("node:fs");
writeFileSync(tmpHtml, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 620 }, deviceScaleFactor: 2 });
  await page.goto(`file:///${tmpHtml.replaceAll("\\", "/")}`);
  await page.screenshot({ path: outPath });
} finally {
  await browser.close();
  rmSync(tmpHtml, { force: true });
}
console.log(`fig-error-handling.png (${lines.length} log lines captured)`);