// Screenshots of the built web app, at a laptop and a phone size, through the complete moment and its error states.
// Needs web/dist built and Playwright's Chromium. Run: npx tsx tools/screens.ts docs/screenshots/after
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const root = new URL("../web/dist/", import.meta.url).pathname;
const out = resolve(process.argv[2] ?? "docs/screenshots/after");
mkdirSync(out, { recursive: true });
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent((req.url ?? "/").split("?")[0]));
  const f = existsSync(p) && !p.endsWith("/") ? p : join(root, "index.html");
  res.setHeader("Content-Type", TYPES[extname(f)] ?? "application/octet-stream");
  res.end(readFileSync(f));
}).listen(0);
await new Promise((ok) => server.once("listening", ok));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

const SIZES = [
  { name: "desktop", width: 1440, height: 900, scale: 1 },
  { name: "phone", width: 390, height: 844, scale: 2 },
];

async function shot(page: Page, size: string, name: string, at?: string, block: ScrollLogicalPosition = "start") {
  if (at) await page.evaluate(([s, b]) => { const el = document.querySelector(s!); if (el) { el.scrollIntoView({ block: b as ScrollLogicalPosition }); if (b === "start") window.scrollBy(0, -12); } }, [at, block]);
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const file = join(out, `${size}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`${file}  ${(statSync(file).size / 1024).toFixed(0)} KB`);
}

async function run(browser: Browser, size: (typeof SIZES)[number]) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector(".brow:not(.head)");
  await shot(page, size.name, "01-board");
  await page.goto(`${url}#/t/lucky-seven`);
  await page.waitForSelector(".cal");
  await shot(page, size.name, "02-trader");
  await shot(page, size.name, "03-buy", ".panel.buy");
  await page.click(".panel.buy button.primary");
  await page.waitForSelector(".check table", { timeout: 30000 });
  await page.waitForTimeout(600);
  await shot(page, size.name, "04-bought");
  await page.locator(".past button.try").first().click();
  await page.waitForSelector(".past .failmsg");
  await shot(page, size.name, "05-sealed", ".journal li.past", "center");
  await shot(page, size.name, "06-false", ".check", "start");
  await page.locator(".check button.prove").first().click();
  await page.waitForSelector(".audit-log .verdict", { timeout: 30000 });
  await shot(page, size.name, "07-caught", ".audit-log", "center");
  await page.goto(`${url}#/`);
  await page.waitForSelector(".brow.caught");
  await shot(page, size.name, "08-board-after", size.name === "phone" ? ".board" : ".controls");
  await page.goto(`${url}#/t/mistral`);
  await page.waitForSelector(".cal");
  await page.check(".cheat input");
  await page.click(".panel.buy button.primary");
  await page.waitForSelector(".verdict.alarm button", { timeout: 30000 });
  await shot(page, size.name, "09-garbage");
  await page.click(".verdict.alarm button");
  await page.waitForSelector(".verdict.ok");
  await shot(page, size.name, "10-disputed");
  await page.goto(`${url}#/proof`);
  await page.waitForSelector("table.live, .proof .note", { timeout: 15000 });
  await page.waitForTimeout(2500);
  await shot(page, size.name, "11-proof");
  await ctx.close();

  // Loading: the contract wasm takes its time.
  const ctx1 = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: "light", reducedMotion: "reduce" });
  const p1 = await ctx1.newPage();
  await p1.route("**/keyhole.wasm", async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); await r.continue().catch(() => {}); });
  await p1.goto(url);
  await p1.waitForSelector(".state.boot");
  await shot(p1, size.name, "00-loading");
  await ctx1.close();

  // The boot error: the contract wasm doesn't arrive.
  const ctx2 = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: "light" });
  const p2 = await ctx2.newPage();
  await p2.route("**/keyhole.wasm", (r) => r.abort());
  await p2.goto(url);
  await p2.waitForTimeout(1500);
  await shot(p2, size.name, "12-boot-error");
  await ctx2.close();
}

const browser = await chromium.launch();
for (const size of SIZES) await run(browser, size);
await browser.close();
server.close();
process.exit(0);
