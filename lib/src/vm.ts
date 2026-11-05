// A tiny NEAR host in plain JavaScript: it runs the real contract wasm (res/keyhole.wasm) with an in-memory state and a clock you can move.
// It is what makes the web app run the actual contract in a browser, and what lets the attack suite cover months of contract time in seconds.
//
// What it is NOT: the NEAR runtime. It meters no gas and has no validators, and cross-contract calls only reach handlers registered with `mock`.
// So nothing about gas is claimed from it; gas numbers come from the sandbox and testnet. See docs/decisions/0007.
const YOCTO_PER_BYTE = 10n ** 19n;
const ACCOUNT_BASE_BYTES = 100n;
const RECORD_BYTES = 40n;

class Panic extends Error {}

export type Outcome = { ok: boolean; value?: any; reason?: string; logs: string[]; tx?: string; burntGas: bigint; receiptGas: bigint[] };
type Action =
  | { kind: "transfer"; amount: bigint }
  | { kind: "call"; method: string; args: Uint8Array; deposit: bigint; gas: bigint };
type Receipt = { id: number; account: string; actions: Action[]; after: number[]; result?: { ok: boolean; bytes: Uint8Array }; done: boolean; returnTo?: number };

const enc = new TextEncoder();
const dec = new TextDecoder();
const u128le = (v: bigint) => {
  const b = new Uint8Array(16);
  new DataView(b.buffer).setBigUint64(0, v & 0xffffffffffffffffn, true);
  new DataView(b.buffer).setBigUint64(8, v >> 64n, true);
  return b;
};
const readU128 = (b: Uint8Array) => {
  const d = new DataView(b.buffer, b.byteOffset, 16);
  return d.getBigUint64(0, true) | (d.getBigUint64(8, true) << 64n);
};

export type Mock = (method: string, args: any, deposit: bigint) => any;

export class MiniNear {
  readonly module: WebAssembly.Module;
  state = new Map<string, Uint8Array>();
  balances = new Map<string, bigint>();
  clockMs: number;
  height = 1;
  private receipts: Receipt[] = [];
  private nextReceipt = 1;
  private mocks = new Map<string, Mock>();
  private codeBytes: bigint;
  private txCounter = 0;

  constructor(wasm: BufferSource, readonly contractId: string, startMs: number, readonly sha256: (d: Uint8Array) => Uint8Array) {
    this.module = new WebAssembly.Module(wasm);
    this.codeBytes = BigInt((wasm as ArrayBufferView | ArrayBuffer).byteLength);
    this.clockMs = startMs;
    this.balances.set(contractId, 0n);
  }

  mock(account: string, handler: Mock): void {
    this.mocks.set(account, handler);
  }

  fund(account: string, amount: bigint): void {
    this.balances.set(account, (this.balances.get(account) ?? 0n) + amount);
  }

  balance(account: string): bigint {
    return this.balances.get(account) ?? 0n;
  }

  advance(ms: number): void {
    this.clockMs += ms;
    this.height += 1;
  }

  storageUsage(): bigint {
    let n = ACCOUNT_BASE_BYTES + this.codeBytes;
    for (const [k, v] of this.state) n += BigInt(k.length / 2) + BigInt(v.length) + RECORD_BYTES;
    return n;
  }

  snapshot(): { state: Record<string, string>; balances: Record<string, string>; clockMs: number; height: number } {
    const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return {
      state: Object.fromEntries([...this.state].map(([k, v]) => [k, hex(v)])),
      balances: Object.fromEntries([...this.balances].map(([k, v]) => [k, v.toString()])),
      clockMs: this.clockMs,
      height: this.height,
    };
  }

  restore(s: { state: Record<string, string>; balances: Record<string, string>; clockMs: number; height: number }): void {
    const unhex = (h: string) => {
      const b = new Uint8Array(h.length / 2);
      for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return b;
    };
    this.state = new Map(Object.entries(s.state).map(([k, v]) => [k, unhex(v)]));
    this.balances = new Map(Object.entries(s.balances).map(([k, v]) => [k, BigInt(v)]));
    this.clockMs = s.clockMs;
    this.height = s.height;
  }

  /** A view: runs the contract and throws away whatever it wrote. */
  view<T = any>(method: string, args: Record<string, unknown> = {}): T {
    const r = this.run(method, enc.encode(JSON.stringify(args)), this.contractId, 0n, 0n, [], true);
    if (!r.ok) throw new Error(`view ${method}: ${r.reason}`);
    return (r.bytes.length ? JSON.parse(dec.decode(r.bytes)) : null) as T;
  }

  /** A transaction: attached deposit, execution, then its receipts in order. Panics refund the deposit and undo every write. */
  call(signer: string, method: string, args: Record<string, unknown>, deposit: bigint = 0n): Outcome {
    if ((this.balances.get(signer) ?? 0n) < deposit) return { ok: false, reason: `${signer} can't afford this`, logs: [], burntGas: 0n, receiptGas: [] };
    this.balances.set(signer, (this.balances.get(signer) ?? 0n) - deposit);
    this.balances.set(this.contractId, (this.balances.get(this.contractId) ?? 0n) + deposit);
    const logs: string[] = [];
    const r = this.run(method, enc.encode(JSON.stringify(args)), signer, deposit, deposit, logs);
    this.txCounter += 1;
    const base = { logs, tx: `local-${this.txCounter}`, burntGas: 0n, receiptGas: [] as bigint[] };
    if (!r.ok) {
      this.balances.set(signer, (this.balances.get(signer) ?? 0n) + deposit);
      this.balances.set(this.contractId, (this.balances.get(this.contractId) ?? 0n) - deposit);
      return { ok: false, reason: r.reason, ...base };
    }
    const final = this.drain(r.ret, r.bytes, logs);
    this.height += 1;
    let value: any;
    if (final.bytes.length) {
      const text = dec.decode(final.bytes);
      try { value = JSON.parse(text); } catch { value = text; }
    }
    return { ok: final.ok, value, ...(final.ok ? {} : { reason: final.reason }), ...base };
  }

  /** A call made from inside a mock, as a receiver contract's own cross-contract call would be. Its receipts stay queued. */
  nested(signer: string, method: string, args: Record<string, unknown>): { ok: boolean; reason?: string } {
    const r = this.run(method, enc.encode(JSON.stringify(args)), signer, 0n, 0n, []);
    return { ok: r.ok, reason: r.reason };
  }

  /** Run every queued receipt whose dependencies are done, in the order NEAR would. */
  private drain(ret: number | undefined, bytes: Uint8Array, logs: string[]): { ok: boolean; bytes: Uint8Array; reason?: string } {
    for (let guard = 0; guard < 64; guard++) {
      const next = this.receipts.find((r) => !r.done && r.after.every((a) => this.receipts.find((x) => x.id === a)?.done));
      if (!next) break;
      this.exec(next, logs);
    }
    if (ret === undefined) return { ok: true, bytes };
    const last = this.follow(ret);
    this.receipts = this.receipts.filter((r) => !r.done);
    if (!last.result) return { ok: true, bytes: new Uint8Array() };
    return last.result.ok ? { ok: true, bytes: last.result.bytes } : { ok: false, bytes: new Uint8Array(), reason: dec.decode(last.result.bytes) };
  }

  private follow(id: number): Receipt {
    let r = this.receipts.find((x) => x.id === id)!;
    while (r.returnTo) r = this.receipts.find((x) => x.id === r.returnTo)!;
    return r;
  }

  private exec(r: Receipt, logs: string[]): void {
    r.done = true;
    let result: { ok: boolean; bytes: Uint8Array } = { ok: true, bytes: new Uint8Array() };
    const results = r.after.map((a) => this.follow(a).result ?? { ok: true, bytes: new Uint8Array() });
    for (const a of r.actions) {
      if (a.kind === "transfer") {
        this.balances.set(this.contractId, (this.balances.get(this.contractId) ?? 0n) - a.amount);
        if (this.isBroken(r.account)) {
          this.balances.set(this.contractId, (this.balances.get(this.contractId) ?? 0n) + a.amount);
          result = { ok: false, bytes: enc.encode("the receiver doesn't exist") };
        } else {
          this.balances.set(r.account, (this.balances.get(r.account) ?? 0n) + a.amount);
        }
      } else if (r.account === this.contractId) {
        this.balances.set(this.contractId, (this.balances.get(this.contractId) ?? 0n)); // a self-call's deposit stays
        const out = this.run(a.method, a.args, this.contractId, 0n, a.deposit, logs, false, results);
        if (!out.ok) result = { ok: false, bytes: enc.encode(out.reason ?? "panic") };
        else if (out.ret !== undefined) r.returnTo = out.ret;
        else result = { ok: true, bytes: out.bytes };
      } else {
        const mock = this.mocks.get(r.account);
        if (!mock) {
          result = { ok: false, bytes: enc.encode(`no contract at ${r.account} in this local host`) };
        } else {
          try {
            const value = mock(a.method, JSON.parse(dec.decode(a.args) || "null"), a.deposit);
            result = { ok: true, bytes: value === undefined ? new Uint8Array() : enc.encode(JSON.stringify(value)) };
          } catch (e) {
            result = { ok: false, bytes: enc.encode(String((e as Error).message)) };
          }
        }
      }
    }
    r.result = result;
  }

  /** Accounts named `broken.*` can't receive transfers: how the tests make a withdrawal fail. */
  private isBroken(account: string): boolean {
    return account.startsWith("broken.");
  }

  private run(method: string, input: Uint8Array, predecessor: string, deposit: bigint, _attached: bigint, logs: string[], isView = false, results: { ok: boolean; bytes: Uint8Array }[] = []): { ok: boolean; bytes: Uint8Array; reason?: string; ret?: number } {
    const writes = new Map<string, Uint8Array | null>();
    const registers = new Map<bigint, Uint8Array>();
    const queued: Receipt[] = [];
    let ret: Uint8Array = new Uint8Array();
    let promiseReturn: number | undefined;
    let memory: WebAssembly.Memory;
    const mem = () => new Uint8Array(memory.buffer);
    const read = (len: bigint, ptr: bigint) => mem().slice(Number(ptr), Number(ptr) + Number(len));
    const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    const self = this;
    const getKey = (k: string) => (writes.has(k) ? writes.get(k)! : this.state.get(k) ?? null);
    const setReg = (id: bigint, b: Uint8Array) => registers.set(id, b);
    const usage = () => {
      let n = this.storageUsage();
      for (const [k, v] of writes) {
        const old = this.state.get(k);
        if (old) n -= BigInt(k.length / 2) + BigInt(old.length) + RECORD_BYTES;
        if (v) n += BigInt(k.length / 2) + BigInt(v.length) + RECORD_BYTES;
      }
      return n;
    };
    const newReceipt = (account: string, after: number[]): Receipt => {
      const r: Receipt = { id: this.nextReceipt++, account, actions: [], after, done: false };
      queued.push(r);
      return r;
    };
    const receipt = (id: bigint) => queued.find((r) => r.id === Number(id)) ?? (() => { throw new Panic("no such promise"); })();

    const host: Record<string, (...a: any[]) => any> = {
      read_register: (id: bigint, ptr: bigint) => { mem().set(registers.get(id) ?? new Uint8Array(), Number(ptr)); },
      register_len: (id: bigint) => (registers.has(id) ? BigInt(registers.get(id)!.length) : 0xffffffffffffffffn),
      write_register: (id: bigint, len: bigint, ptr: bigint) => setReg(id, read(len, ptr)),
      current_account_id: (r: bigint) => setReg(r, enc.encode(this.contractId)),
      signer_account_id: (r: bigint) => setReg(r, enc.encode(predecessor)),
      predecessor_account_id: (r: bigint) => setReg(r, enc.encode(predecessor)),
      input: (r: bigint) => setReg(r, input),
      block_index: () => BigInt(this.height),
      block_timestamp: () => BigInt(this.clockMs) * 1_000_000n,
      epoch_height: () => 1n,
      storage_usage: () => usage(),
      account_balance: (ptr: bigint) => mem().set(u128le(this.balances.get(this.contractId) ?? 0n), Number(ptr)),
      account_locked_balance: (ptr: bigint) => mem().set(u128le(0n), Number(ptr)),
      attached_deposit: (ptr: bigint) => mem().set(u128le(deposit), Number(ptr)),
      prepaid_gas: () => 300_000_000_000_000n,
      used_gas: () => 0n,
      random_seed: (r: bigint) => setReg(r, new Uint8Array(32)),
      sha256: (len: bigint, ptr: bigint, r: bigint) => setReg(r, this.sha256(read(len, ptr))),
      value_return: (len: bigint, ptr: bigint) => { ret = read(len, ptr); },
      panic: () => { throw new Panic("explicit guest panic"); },
      panic_utf8: (len: bigint, ptr: bigint) => { throw new Panic(dec.decode(read(len, ptr))); },
      abort: () => { throw new Panic("abort"); },
      log_utf8: (len: bigint, ptr: bigint) => { logs.push(dec.decode(read(len, ptr))); },
      storage_write: (kl: bigint, kp: bigint, vl: bigint, vp: bigint, r: bigint) => {
        const k = toHex(read(kl, kp));
        const old = getKey(k);
        writes.set(k, read(vl, vp));
        if (old) { setReg(r, old); return 1n; }
        return 0n;
      },
      storage_read: (kl: bigint, kp: bigint, r: bigint) => {
        const v = getKey(toHex(read(kl, kp)));
        if (!v) return 0n;
        setReg(r, v);
        return 1n;
      },
      storage_remove: (kl: bigint, kp: bigint, r: bigint) => {
        const k = toHex(read(kl, kp));
        const old = getKey(k);
        writes.set(k, null);
        if (old) { setReg(r, old); return 1n; }
        return 0n;
      },
      storage_has_key: (kl: bigint, kp: bigint) => (getKey(toHex(read(kl, kp))) ? 1n : 0n),
      promise_batch_create: (l: bigint, p: bigint) => BigInt(newReceipt(dec.decode(read(l, p)), []).id),
      promise_batch_then: (after: bigint, l: bigint, p: bigint) => BigInt(newReceipt(dec.decode(read(l, p)), [Number(after)]).id),
      promise_create: (l: bigint, p: bigint, ml: bigint, mp: bigint, al: bigint, ap: bigint, dp: bigint, gas: bigint) => {
        const r = newReceipt(dec.decode(read(l, p)), []);
        r.actions.push({ kind: "call", method: dec.decode(read(ml, mp)), args: read(al, ap), deposit: readU128(read(16n, dp)), gas });
        return BigInt(r.id);
      },
      promise_then: (after: bigint, l: bigint, p: bigint, ml: bigint, mp: bigint, al: bigint, ap: bigint, dp: bigint, gas: bigint) => {
        const r = newReceipt(dec.decode(read(l, p)), [Number(after)]);
        r.actions.push({ kind: "call", method: dec.decode(read(ml, mp)), args: read(al, ap), deposit: readU128(read(16n, dp)), gas });
        return BigInt(r.id);
      },
      promise_batch_action_transfer: (id: bigint, ptr: bigint) => { receipt(id).actions.push({ kind: "transfer", amount: readU128(read(16n, ptr)) }); },
      promise_batch_action_function_call: (id: bigint, ml: bigint, mp: bigint, al: bigint, ap: bigint, dp: bigint, gas: bigint) => {
        receipt(id).actions.push({ kind: "call", method: dec.decode(read(ml, mp)), args: read(al, ap), deposit: readU128(read(16n, dp)), gas });
      },
      promise_batch_action_function_call_weight: (id: bigint, ml: bigint, mp: bigint, al: bigint, ap: bigint, dp: bigint, gas: bigint) => {
        receipt(id).actions.push({ kind: "call", method: dec.decode(read(ml, mp)), args: read(al, ap), deposit: readU128(read(16n, dp)), gas });
      },
      promise_return: (id: bigint) => { promiseReturn = Number(id); },
      promise_results_count: () => BigInt(results.length),
      promise_result: (i: bigint, r: bigint) => {
        const x = results[Number(i)];
        if (!x) throw new Panic("no such promise result");
        if (x.ok) { setReg(r, x.bytes); return 1n; }
        return 2n;
      },
    };
    const imports: Record<string, Record<string, unknown>> = { env: {} };
    for (const i of WebAssembly.Module.imports(this.module)) {
      imports[i.module] ??= {};
      imports[i.module][i.name] = host[i.name] ?? (() => { throw new Panic(`host function ${i.name} isn't in this local host`); });
    }
    const inst = new WebAssembly.Instance(this.module, imports as WebAssembly.Imports);
    memory = inst.exports.memory as WebAssembly.Memory;
    void self;
    try {
      const fn = inst.exports[method] as (() => void) | undefined;
      if (!fn) throw new Panic(`no method ${method}`);
      fn();
    } catch (e) {
      if (e instanceof Panic) return { ok: false, bytes: new Uint8Array(), reason: e.message };
      if (e instanceof WebAssembly.RuntimeError) return { ok: false, bytes: new Uint8Array(), reason: `wasm trap: ${e.message}` };
      throw e;
    }
    if (isView) return { ok: true, bytes: ret };
    for (const [k, v] of writes) {
      if (v) this.state.set(k, v);
      else this.state.delete(k);
    }
    this.receipts.push(...queued);
    return { ok: true, bytes: ret, ret: promiseReturn };
  }
}
