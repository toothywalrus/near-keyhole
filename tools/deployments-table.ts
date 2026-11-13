// Prints the testnet run's transaction table for docs/deployments.md (and the README's short version) from docs/demo/testnet-run.json, so a new deployment's
// table is pasted, not retyped. Read-only. Run: npx tsx tools/deployments-table.ts
import { readFileSync } from "node:fs";

const run = JSON.parse(readFileSync(new URL("../docs/demo/testnet-run.json", import.meta.url), "utf8"));
const link = (tx: string) => `[\`${tx.slice(0, 10)}…\`](https://testnet.nearblocks.io/txns/${tx})`;
const rows = ["| Step | Tgas | Transaction |", "|---|---:|---|"];
if (run.deploy_tx) rows.push(`| deploy the wasm, \`new\`, delete the only key: one transaction | | ${link(run.deploy_tx)} |`);
for (const s of run.steps) rows.push(`| ${s.what} | ${s.tgas ? s.tgas.toFixed(2) : ""} | ${s.tx ? link(s.tx) : ""} |`);
console.log(`Contract [\`${run.contract}\`](https://testnet.nearblocks.io/address/${run.contract}), run at ${run.at}, ${run.steps.filter((s: any) => s.tx).length + (run.deploy_tx ? 1 : 0)} transactions:\n`);
console.log(rows.join("\n"));
