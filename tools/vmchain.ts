// The `Chain` interface over the local wasm host, and over a real node.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { readFileSync } from "node:fs";
import type { Chain, Outcome } from "../lib/src/client.ts";
import { MiniNear } from "../lib/src/vm.ts";
import type { Net, Named } from "./nearkit.ts";

export const WASM = new URL("../res/keyhole.wasm", import.meta.url).pathname;

export class VmChain implements Chain {
  vm: MiniNear;
  constructor(readonly contractId: string, startMs: number, wasmPath: string = process.env.KEYHOLE_WASM ?? WASM) {
    this.vm = new MiniNear(readFileSync(wasmPath), contractId, startMs, (d) => nobleSha256(d));
    this.vm.fund(contractId, 10n ** 27n); // what storage for the code and state is locked from
  }
  async call(who: string, method: string, args: Record<string, unknown>, deposit: bigint = 0n): Promise<Outcome> {
    return this.vm.call(who, method, args, deposit);
  }
  async view<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.vm.view<T>(method, args);
  }
  async nowMs(): Promise<number> {
    return this.vm.clockMs;
  }
  async advanceTo(ms: number): Promise<void> {
    if (ms > this.vm.clockMs) this.vm.advance(ms - this.vm.clockMs);
  }
}

export class RpcChain implements Chain {
  accounts = new Map<string, Named>();
  constructor(readonly net: Net, readonly contractId: string, readonly nudge?: (ms: number) => Promise<void>) {}
  add(a: Named): void {
    this.accounts.set(a.id, a);
  }
  async call(who: string, method: string, args: Record<string, unknown>, deposit: bigint = 0n, tgas: bigint = 300n): Promise<Outcome> {
    const a = this.accounts.get(who);
    if (!a) throw new Error(`no key for ${who}`);
    return this.net.call(a, this.contractId, method, args, deposit, tgas);
  }
  view<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.net.view<T>(this.contractId, method, args);
  }
  async nowMs(): Promise<number> {
    return Number((await this.view<{ now_ms: string }>("clock")).now_ms);
  }
  async advanceTo(ms: number): Promise<void> {
    for (;;) {
      const now = await this.nowMs();
      if (now >= ms) return;
      if (this.nudge) await this.nudge(ms - now);
      else await new Promise((ok) => setTimeout(ok, Math.min(ms - now, 2000)));
    }
  }
}
