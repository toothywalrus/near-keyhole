// The record of the real run on NEAR testnet (docs/demo/testnet-run.json, copied into the build). The local moments in this tab
// point at the same step on the real chain, one click away.
import { useEffect, useState } from "react";

export type Run = { contract: string; at: string; steps: { what: string; tx?: string; tgas?: number; note?: string }[]; traders: Record<string, string> };

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
