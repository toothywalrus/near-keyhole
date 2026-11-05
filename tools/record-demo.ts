// Records docs/demo/keyhole-demo.mp4 and the screenshots: the complete moment, in a headless browser of its own, with captions added for the video only.
// Needs web/dist built, Playwright's Chromium and ffmpeg. Run: npm run record
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium, type Page } from "playwright";

const root = new URL("../web/dist/", import.meta.url).pathname;
const out = new URL("../docs/demo/", import.meta.url).pathname;
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent((req.url ?? "/").split("?")[0]));
  const f = existsSync(p) && !p.endsWith("/") ? p : join(root, "index.html");
  res.setHeader("Content-Type", TYPES[extname(f)] ?? "application/octet-stream");
  res.end(readFileSync(f));
}).listen(0);
await new Promise((ok) => server.once("listening", ok));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const videoDir = join(tmpdir(), `keyhole-video-${Date.now()}`);
mkdirSync(videoDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } }, colorScheme: "light" });
const page = await ctx.newPage();

async function caption(p: Page, text: string): Promise<void> {
  await p.evaluate((t) => {
    let d = document.getElementById("video-caption");
    if (!d) {
      d = document.createElement("div");
      d.id = "video-caption";
      d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99;background:#15130f;color:#f3eee4;font:400 21px/1.3 'Newsreader Variable',Georgia,serif;padding:14px 28px;text-align:center";
      document.body.appendChild(d);
    }
    d.textContent = t;
  }, text);
}
const wait = (ms: number) => page.waitForTimeout(ms);
async function glide(selector: string, block: "start" | "center" = "center"): Promise<void> {
  await page.evaluate(([s, b]) => document.querySelector(s!)?.scrollIntoView({ behavior: "smooth", block: b as ScrollLogicalPosition }), [selector, block]);
  await wait(900);
}

await page.goto(url);
await page.waitForSelector(".brow:not(.head)");
await caption(page, "A public board of private trading books. Bonded PnL, and nobody can read the trades. Seeded demo: the real contract runs in this tab.");
await wait(5000);
await page.screenshot({ path: join(out, "board.png"), fullPage: false });
await glide(".board");
await caption(page, "The top number is the one a stranger would follow. It has a bond behind it. Is it true?");
await wait(4000);
await page.click("text=lucky-seven");
await page.waitForSelector(".cal");
await caption(page, "All you can see is that entries exist, and when. Each was committed as it was written: no backdating, no deleting losers.");
await wait(3000);
await glide(".split");
await wait(3000);
await caption(page, "Buy seven days. The price comes off this trader's curve, and sits in escrow.");
await wait(3000);
await page.click("button.primary");
await caption(page, "A one-time key, made here. The trader delivers the few tree nodes that cover exactly that window.");
await page.waitForSelector(".check table", { timeout: 30000 });
await wait(1200);
await caption(page, "The key, drawn: six nodes, 168 slots. No node reaches past the window, so there's nothing to revoke, and nobody needs to be online.");
await wait(5500);
await page.screenshot({ path: join(out, "reader.png"), fullPage: false });
await glide(".journal li.open");
await caption(page, "Those exact trades decrypt, in this tab.");
await wait(3500);
await glide(".journal li.past");
await caption(page, "The next day's entry. Try anyway.");
await wait(2000);
await page.locator(".past .link").first().click();
await page.waitForSelector(".past .failmsg");
await caption(page, "Every key this window can derive, against that entry's tag. None opens. Offline, with nobody revoking anything.");
await wait(5500);
await glide(".check");
await caption(page, "Now do the sum: the entries, priced at the oracle. The posted figures don't match. He's been lying.");
await wait(5500);
await page.locator(".check .link.danger").first().click();
await caption(page, "Prove it. The contract opens the entries itself, recomputes the figure in exact integers, and compares.");
await page.waitForSelector(".audit-log .verdict", { timeout: 30000 });
await wait(1000);
await glide(".audit-log");
await wait(5000);
await page.screenshot({ path: join(out, "caught.png"), fullPage: false });
await caption(page, "Half the bond is yours. Your escrow comes back from the rest. And the record stays.");
await page.locator("button:has-text('Claim the refund')").first().click().catch(() => {});
await wait(2500);
await page.locator("button:has-text('Withdraw')").first().click().catch(() => {});
await wait(2500);
await page.goto(`${url}#/`);
await page.waitForSelector(".brow.caught");
await glide(".board");
await caption(page, "Sale, dispute and fraud proof: all in the contract, with no operator. Keyhole, built at NEAR HACKATHON. Testnet only, and not investment advice.");
await wait(6000);
await page.close();
await ctx.close();
await browser.close();
server.close();
const webm = readdirSync(videoDir).filter((f) => f.endsWith(".webm")).map((f) => join(videoDir, f))[0];
const mp4 = join(out, "keyhole-demo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
rmSync(videoDir, { recursive: true, force: true });
void renameSync;
console.log(`${mp4}: ${(statSync(mp4).size / 1e6).toFixed(2)} MB`);
process.exit(0);
