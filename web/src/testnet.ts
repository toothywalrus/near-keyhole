// The record of the real run on NEAR testnet (docs/demo/testnet-run.json, copied into the build), and read-only calls to the real contract. The local moments
// in this tab point at the same step on the real chain, one click away. Nothing here signs anything: the page holds no key.
import { useEffect, useState } from "react";

export type Run = {
  contract: string; at: string; epoch: number; buyer?: string;
  steps: { what: string; tx?: string; tgas?: number; note?: string }[];
  traders: Record<string, string>;
  outlayer?: { trader: string; epoch: number; direct?: { request_tx: string; request_id: number } };
};

let loading: Promise<Run | null> | null = null;
export function loadRun(): Promise<Run | null> {
  return (loading ??= fetch("./testnet-run.json").then((r) => (r.ok ? r.json() : null)).catch(() => null));
}

/** undefined while loading, null if this build has no record. */
export function useRun(): Run | null | undefined {
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  useEffect(() => { let live = true; loadRun().then((r) => { if (live) setRun(r); }); return () => { live = false; }; }, []);
  return run;
}

export const stepOf = (run: Run | null | undefined, prefix: string) => run?.steps.find((x) => x.tx && x.what.startsWith(prefix));

export const RPC = "https://test.rpc.fastnear.com";

async function query<T>(params: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("NEAR testnet's public RPC didn't answer");
  }
  if (!r.ok) throw new Error(`NEAR testnet's public RPC answered ${r.status}`);
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(`the RPC refused the read: ${JSON.stringify(j.error?.cause?.name ?? j.error?.message ?? j.result.error).slice(0, 100)}`);
  return j.result as T;
}

/** A view call on the real contract. */
export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const res = await query<{ result: number[] }>({ request_type: "call_function", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(res.result)));
}

/** How many access keys an account has. A locked contract has none. */
export async function keyCount(account: string): Promise<number> {
  return (await query<{ keys: unknown[] }>({ request_type: "view_access_key_list", account_id: account })).keys.length;
}
