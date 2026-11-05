// The findings of the AI judge's dry run, reproduced on the wasm as it stood (git show 66d4cae:res/keyhole.wasm). Kept as the record of what decision 0013 fixed; it runs against that wasm only.
import { hex } from "../../lib/src/bytes.ts";
import { buyerKey, near, TraderAgent } from "../../lib/src/client.ts";
import { seedOf, vmWorld } from "../world.ts";
const N = (y: bigint | string) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
{
  const w: any = await vmWorld();
  await w.rounds();
  const t = new TraderAgent(w.chain, await w.fund("drainer", near(100)), seedOf("a"), w.timing);
  await t.register("drainer", { book_usd: 100_000, floor_bps: 1000, base_price: near("0.6"), slope: 0n, bond: near(10) });
  const sock = await w.fund("sock", near(1000));
  let paid = 0n;
  for (let i = 0; i < 12; i++) {
    const rec = await t.record();
    const e = (await w.chain.view("clock")).epoch;
    const epochs = Math.min(31, Number((BigInt(rec.bond) * 2n) / BigInt(rec.base_price)));
    const b = await w.chain.call(sock, "buy_window", { trader: t.account, first_epoch: e, last_epoch: e + epochs - 1, buyer_pub: hex(buyerKey().pub) }, near(100));
    if (!b.ok) break;
    const tok = await w.chain.view("get_token", { token_id: b.value });
    paid += BigInt(tok.price);
    await w.chain.advanceTo(Number(tok.deliver_by_ms) + 1);
    await w.chain.call(sock, "claim_undelivered", { token_id: b.value });
  }
  const rec = await t.record();
  console.log(`1. non-delivery: sock paid ${N(paid)}, credited ${N(await w.chain.view("credit_of", { account: sock }))}: bond 10 -> ${N(rec.bond)}, status ${JSON.stringify(rec.status)}, burned ${N(rec.burned)}`);
}
{
  // Found while fixing 1: the same escape through the floor refund, with no late delivery on the record.
  const w: any = await vmWorld();
  await w.rounds();
  const t = new TraderAgent(w.chain, await w.fund("lapser", near(100)), seedOf("a"), w.timing);
  await t.register("lapser", { book_usd: 100_000, floor_bps: 1000, base_price: near(10), slope: 0n, bond: near(10) });
  const sock = await w.fund("sock", near(1000));
  const e = (await w.chain.view("clock")).epoch;
  const b = await w.chain.call(sock, "buy_window", { trader: t.account, first_epoch: e, last_epoch: e, buyer_pub: hex(buyerKey().pub) }, near(100));
  await t.deliver(Number(b.value));
  const tok = await w.chain.view("get_token", { token_id: b.value });
  await w.chain.advanceTo(Number(tok.settle_at_ms));
  await w.chain.call(sock, "settle", { token_id: b.value });
  await w.chain.call(sock, "claim_refund", { token_id: b.value });
  const rec = await t.record();
  console.log(`1b. lapse: trader credited ${N(await w.chain.view("credit_of", { account: t.account }))}, sock credited ${N(await w.chain.view("credit_of", { account: sock }))} on a 10 price: bond 10 -> ${N(rec.bond)}, status ${JSON.stringify(rec.status)}`);
}
