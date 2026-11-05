// NEAR plumbing shared by the sandbox harness, the demo and the deploy: accounts, calls that return the
// contract's panic text instead of throwing, a local sandbox node. Adapted from near-verdict's
// jury/src/near.ts and near-account-nfts' demo (our own MIT code).
import { Account, JsonRpcProvider, KeyPair, actions, formatNearAmount, type KeyPairString } from "near-api-js";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Public RPCs rate-limit (a shared IP does it quickly). A 429 changed nothing on the chain, so every request here just waits and tries again.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  for (let attempt = 0; ; attempt++) {
    const res = await realFetch(input, init);
    if (res.status !== 429 || attempt >= 40) return res;
    await new Promise((ok) => setTimeout(ok, 3000 + attempt * 500));
  }
}) as typeof fetch;

export type Named = { id: string; account: Account; key: string };
export type CallResult = { ok: boolean; value?: unknown; reason?: string; tx?: string; logs: string[]; burntGas: bigint; receiptGas: bigint[] };

export const yocto = (near: string | number): bigint => {
  const [w, f = ""] = String(near).split(".");
  return BigInt(w) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24));
};
export const near = (y: bigint | string): string => `${formatNearAmount(y.toString(), 4)} NEAR`;
export const tgas = (g: bigint): string => `${(Number(g) / 1e12).toFixed(2)} Tgas`;

function panicOf(text: string): string {
  return text.match(/Smart contract panicked: ([^\n"\\]+)/)?.[1] ?? text.slice(0, 300);
}

export class Net {
  provider: JsonRpcProvider;
  /** On a one-validator sandbox there's nothing to wait for beyond execution, which makes transactions several times faster. */
  fast = false;
  constructor(public rpc: string) {
    this.provider = new JsonRpcProvider({ url: rpc });
  }
  named(id: string, key: string): Named {
    return { id, key, account: new Account(id, this.provider, key as KeyPairString) };
  }
  view<T = any>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.provider.callFunction({ contractId, method, args, ...(this.fast ? { blockQuery: { finality: "optimistic" } } : {}) } as never) as Promise<T>;
  }
  async balance(id: string): Promise<bigint> {
    return BigInt((await this.provider.viewAccount({ accountId: id })).amount);
  }
  async exists(id: string): Promise<boolean> {
    return this.provider.viewAccount({ accountId: id }).then(() => true, () => false);
  }
  async sub(parent: Named, name: string, nearAmount: string | number): Promise<Named> {
    const id = `${name}.${parent.id}`;
    const key = KeyPair.fromRandom("ed25519");
    await parent.account.createAccount({ newAccountId: id, publicKey: key.getPublicKey(), nearToTransfer: yocto(nearAmount) });
    return this.named(id, key.toString());
  }
  async deploy(who: Named, wasmPath: string): Promise<void> {
    await who.account.signAndSendTransaction({ receiverId: who.id, actions: [actions.deployContract(readFileSync(wasmPath))], waitUntil: "FINAL" as never });
  }
  /** Call a contract; a refusal comes back as `{ok:false, reason}` with the contract's own words. */
  async call(who: Named, contractId: string, method: string, args: Record<string, unknown>, deposit: bigint = 0n, gas: bigint = 300n): Promise<CallResult> {
    try {
      const r = await who.account.callFunctionRaw({ contractId, methodName: method, args, deposit, gas: gas * 10n ** 12n, waitUntil: this.fast ? "EXECUTED_OPTIMISTIC" : "FINAL" });
      return this.outcome(r);
    } catch (e) {
      return { ok: false, reason: panicOf(String((e as Error)?.message ?? e)), logs: [], burntGas: 0n, receiptGas: [] };
    }
  }
  outcome(r: any): CallResult {
    const logs = r.receipts_outcome.flatMap((o: any) => o.outcome.logs as string[]);
    const receiptGas = r.receipts_outcome.map((o: any) => BigInt(o.outcome.gas_burnt));
    const burntGas = BigInt(r.transaction_outcome.outcome.gas_burnt) + receiptGas.reduce((a: bigint, b: bigint) => a + b, 0n);
    const later = r.receipts_outcome.map((o: any) => o.outcome.status.Failure).find(Boolean);
    const status = r.status as { SuccessValue?: string; Failure?: unknown };
    const base = { tx: r.transaction.hash as string, logs, burntGas, receiptGas };
    if (status.Failure) return { ok: false, reason: panicOf(JSON.stringify(status.Failure)), ...base };
    let value: unknown;
    if (status.SuccessValue) {
      const text = Buffer.from(status.SuccessValue, "base64").toString();
      try { value = JSON.parse(text); } catch { value = text; }
    }
    return { ok: true, value, ...base, ...(later ? { reason: `a later receipt failed: ${panicOf(JSON.stringify(later))}` } : {}) };
  }
}

// ---- a local sandbox node ----

export const SANDBOX_VERSION = "2.14.0";
const SANDBOX_URL = `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${process.platform === "darwin" ? "Darwin-arm64" : process.arch === "arm64" ? "Linux-aarch64" : "Linux-x86_64"}/${SANDBOX_VERSION}/near-sandbox.tar.gz`;

/** The sandbox binary: $NEAR_SANDBOX_BIN_PATH, else ~/.cache/near-keyhole, downloaded once (about 60 MB). */
export function sandboxBinary(): string {
  const override = process.env.NEAR_SANDBOX_BIN_PATH;
  if (override && existsSync(override)) return override;
  const dir = join(homedir(), ".cache", "near-keyhole", `sandbox-${SANDBOX_VERSION}`);
  const bin = join(dir, "near-sandbox");
  if (existsSync(bin) && statSync(bin).size > 1_000_000) return bin;
  mkdirSync(dir, { recursive: true });
  console.log(`downloading the NEAR sandbox node ${SANDBOX_VERSION} once (it is cached in ${dir}) ...`);
  execFileSync("sh", ["-c", `curl -fsSL "${SANDBOX_URL}" | tar -xz -C "${dir}" --strip-components=1`], { stdio: "inherit" });
  execFileSync("chmod", ["+x", bin]);
  return bin;
}

async function freePort(): Promise<number> {
  return new Promise((ok, no) => {
    const s = createServer();
    s.on("error", no);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

export type Sandbox = { net: Net; root: Named; home: string; stop: () => void; fastForward: (blocks: number) => Promise<void>; rpc: string };

/** Start a fresh sandbox node. `stop()` kills it and deletes its home directory. */
export async function startSandbox(): Promise<Sandbox> {
  const bin = sandboxBinary();
  const home = mkdtempSync(join(tmpdir(), "keyhole-sandbox-"));
  execFileSync(bin, ["--home", home, "init", "--fast"], { stdio: "ignore" });
  const rpcPort = await freePort();
  const netPort = await freePort();
  const child: ChildProcess = spawn(bin, ["--home", home, "run", "--rpc-addr", `127.0.0.1:${rpcPort}`, "--network-addr", `127.0.0.1:${netPort}`], { stdio: "ignore" });
  const stop = () => {
    child.kill("SIGKILL");
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  process.on("exit", stop);
  const rpc = `http://127.0.0.1:${rpcPort}`;
  const net = new Net(rpc);
  net.fast = true;
  const validator = JSON.parse(readFileSync(join(home, "validator_key.json"), "utf8"));
  for (let i = 0; i < 120; i++) {
    try {
      const s = await (await fetch(`${rpc}/status`)).json() as { sync_info: { latest_block_height: number } };
      if (s.sync_info.latest_block_height > 1) break;
    } catch { /* not up yet */ }
    await new Promise((ok) => setTimeout(ok, 250));
  }
  const root = net.named(validator.account_id, validator.secret_key);
  const fastForward = async (blocks: number) => {
    const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sandbox_fast_forward", params: { delta_height: blocks } }) });
    const j = await r.json() as { error?: unknown };
    if (j.error) throw new Error(JSON.stringify(j.error));
  };
  return { net, root, home, stop, fastForward, rpc };
}
