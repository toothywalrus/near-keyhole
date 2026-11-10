// Screenshots of the built app, with its own headless browser. Run: npx tsx tools/shots.ts [out-dir]. Serves web/dist on a free port.
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const out = process.argv[2] ?? "/tmp/keyhole-shots";
mkdirSync(out, { recursive: true });
const root = new URL("../web/dist/", import.meta.url).pathname;
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent((req.url ?? "/").split("?")[0]));
  const f = existsSync(p) && !p.endsWith("/") ? p : join(root, "index.html");
  res.setHeader("Content-Type", TYPES[extname(f)] ?? "application/octet-stream");
  res.end(readFileSync(f));
}).listen(0);
await new Promise((ok) => server.once("listening", ok));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const browser = await chromium.launch();

async function session(name: string, width: number, height: number) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: name.includes("dark") ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector(".brow:not(.head)");
  await page.screenshot({ path: `${out}/${name}-board.png`, fullPage: true });
  await page.goto(`${url}#/t/lucky-seven`);
  await page.waitForSelector(".cal");
  await page.screenshot({ path: `${out}/${name}-trader.png`, fullPage: true });
  await page.click(".panel.buy button.primary");
  await page.waitForSelector(".check table", { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}-reader.png`, fullPage: true });
  const tryBtn = await page.$(".past button.try");
  if (tryBtn) { await tryBtn.click(); await page.waitForTimeout(150); }
  const prove = await page.$(".check button.prove");
  if (prove) { await prove.click(); await page.waitForSelector(".audit-log .verdict", { timeout: 15000 }); }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-caught.png`, fullPage: true });
  await page.goto(`${url}#/`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-board-after.png`, fullPage: true });
  await page.goto(`${url}#/how`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/${name}-how.png`, fullPage: true });
  await page.goto(`${url}#/proof`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-proof.png`, fullPage: true });
  console.log(name, errors.length ? `ERRORS: ${errors.join(" | ")}` : "no page errors");
  await ctx.close();
}
await session("desk", 1280, 860);
await session("phone", 390, 844);
await session("dark", 1280, 860);
await browser.close();
server.close();
process.exit(0);
