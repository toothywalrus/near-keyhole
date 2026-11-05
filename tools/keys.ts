// Testnet account keys live in the macOS keychain (service near-lab-testnet, account = the NEAR id), or in the
// environment as KEY_<id with . and - as _>. Never in a file. (From near-verdict's jury/src/keys.ts.)
import { execFileSync } from "node:child_process";

export const SERVICE = "near-lab-testnet";
const envName = (id: string) => `KEY_${id.replace(/[.-]/g, "_")}`;
const NO_KEYCHAIN = process.platform !== "darwin" || Boolean(process.env.NO_KEYCHAIN);
const memory = new Map<string, string>();

export function keyFor(id: string): string {
  const env = process.env[envName(id)];
  if (env) return env;
  if (memory.has(id)) return memory.get(id)!;
  if (NO_KEYCHAIN) throw new Error(`no key for ${id}: set ${envName(id)}`);
  return execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", id, "-w"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

export function saveKey(id: string, secret: string): void {
  if (NO_KEYCHAIN) {
    memory.set(id, secret);
    return;
  }
  execFileSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", id, "-w", secret]);
}
