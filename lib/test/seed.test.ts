// The seeded state the web app starts from is what it says: a real contract's state, in which the honest books' figures are exactly the journals' and the liar's aren't.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hex, sha256 } from "../src/bytes.ts";
import { loadEntries, Prices, replayEpoch, Timing, TraderAgent, type Chain, type EpochRec, type TraderRec } from "../src/client.ts";
import { demoSeed, CONTRACT, PERSONAS } from "../src/seed-shared.ts";
import { MiniNear } from "../src/vm.ts";

const wasm = readFileSync(new URL("../../res/keyhole.wasm", import.meta.url));
const state = JSON.parse(readFileSync(new URL("../../web/public/seed/state.json", import.meta.url), "utf8"));
const meta = JSON.parse(readFileSync(new URL("../../web/public/seed/meta.json", import.meta.url), "utf8"));
const vm = new MiniNear(wasm, CONTRACT, state.clockMs, (d) => nobleSha256(d));
vm.restore(state);
const chain: Chain = {
  call: async (w, m, a, d = 0n) => vm.call(w, m, a, d) as any,
  view: async (m, a = {}) => vm.view(m, a),
  nowMs: async () => vm.clockMs,
  advanceTo: async () => {},
};

test("the seed was made with this wasm", () => {
  assert.equal(meta.wasm_sha256, hex(sha256(new Uint8Array(wasm))));
});

test("every honest book's figures are exactly its journal's; the liar's aren't", async () => {
  const timing = await Timing.read(chain);
  const prices = new Prices(chain);
  await prices.load();
  const recorded = JSON.parse(readFileSync(new URL("../../fixtures/chainlink-rounds.json", import.meta.url), "utf8"));
  const eth = new Set(recorded.feeds["ETH/USD"].rounds.map((r: [string, string, number]) => Number(r[1])));
  assert.ok(prices.rounds[0].every((r) => eth.has(r.answer_e8)), "every ETH round in the state is a recorded real round");
  for (const p of PERSONAS) {
    const account = `${p.handle}.local`;
    const a = new TraderAgent(chain, account, demoSeed(p.handle), timing);
    const rec: TraderRec = vm.view("get_trader", { account });
    const eps: EpochRec[] = vm.view("get_epochs", { account, from: rec.first_epoch, limit: 400 });
    let lies = 0;
    let checked = 0;
    for (const e of eps.filter((x) => x.posted_e6 !== null)) {
      const entries = await loadEntries(chain, account, Number(e.first_seq), e.entries);
      const f = replayEpoch(entries, a.keyOf, prices, BigInt(rec.book_usd_e6), timing.epochStart(e.epoch + 1));
      checked++;
      if (f.pnl_e6.toString() !== e.posted_e6) lies++;
    }
    assert.ok(checked > 0);
    if (p.liesFromDay === undefined) assert.equal(lies, 0, `${p.handle} should be honest`);
    else assert.ok(lies > 3, `${p.handle} should be lying`);
  }
});
