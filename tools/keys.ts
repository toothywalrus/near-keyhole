// Testnet account keys live in the OS keyring under the service near-lab-testnet (account = the NEAR id), or in the environment as KEY_<id with . and - as _>.
// Never in a file. (From near-verdict's jury/src/keys.ts, then given a Linux keyring.)
//   macOS: the login keychain, through `security`;
//   Linux: the Secret Service (GNOME keyring and the like), through `secret-tool`. Lookup: `secret-tool lookup service near-lab-testnet account <id>`.
// A key is never kept only in this process: a new account whose key can't be stored would be lost when the process exits. `saveKey` stores, reads back and
// compares, and throws if anything differs. NO_KEYCHAIN=1 is the one way to opt into a key that lives in this process only, for throwaway accounts.
import { execFileSync, spawnSync } from "node:child_process";

/** `near-lab-testnet` for testnet. Mainnet keys live under another service (tools/mainnet.ts sets KEYCHAIN_SERVICE=near-mainnet), so a testnet tool can never find one. */
export const SERVICE = process.env.KEYCHAIN_SERVICE ?? "near-lab-testnet";
export type Backend = "keychain" | "secret-tool" | "memory" | "none";
const envName = (id: string) => `KEY_${id.replace(/[.-]/g, "_")}`;

/** Whether a program can be started at all. `secret-tool` has no --version (bare, it prints usage and exits 2), so only ENOENT means it's missing. */
export function spawnable(cmd: string, run: typeof spawnSync = spawnSync): boolean {
  const r = run(cmd, [], { stdio: "ignore", timeout: 5000 });
  return (r.error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT";
}

export function pickBackend(platform: string, env: NodeJS.ProcessEnv, hasSecretTool: () => boolean): Backend {
  if (env.NO_KEYCHAIN) return "memory";
  if (platform === "darwin") return "keychain";
  if (platform === "linux" && hasSecretTool()) return "secret-tool";
  return "none";
}

export const BACKEND: Backend = pickBackend(process.platform, process.env, () => spawnable("secret-tool"));
const memory = new Map<string, string>();
const QUIET = { stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"], timeout: 15_000 };

function stored(id: string): string | undefined {
  try {
    if (BACKEND === "keychain") return execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", id, "-w"], QUIET).toString().trim() || undefined;
    if (BACKEND === "secret-tool") return execFileSync("secret-tool", ["lookup", "service", SERVICE, "account", id], QUIET).toString().trim() || undefined;
  } catch {
    return undefined;
  }
  return memory.get(id);
}

export function hasKey(id: string): boolean {
  return Boolean(process.env[envName(id)]) || stored(id) !== undefined;
}

export function keyFor(id: string): string {
  const env = process.env[envName(id)];
  if (env) return env;
  const v = stored(id);
  if (v) return v;
  const where = { keychain: `the macOS keychain (service ${SERVICE})`, "secret-tool": `the keyring (secret-tool, service ${SERVICE})`, memory: "this process (NO_KEYCHAIN)", none: "no keyring (install secret-tool, or set it in the environment)" }[BACKEND];
  throw new Error(`no key for ${id} in ${where}: or set ${envName(id)}`);
}

/** Store a key, read it back and compare. Throws, before anything is funded with it, if the keyring didn't keep it. */
export function saveKey(id: string, secret: string): void {
  if (BACKEND === "none") throw new Error(`refused: no OS keyring here (the macOS keychain or secret-tool), so the key for ${id} would be lost. NO_KEYCHAIN=1 keeps it in this process only, for throwaway accounts`);
  if (BACKEND === "keychain") execFileSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", id, "-w", secret], { stdio: "ignore" });
  // On stdin, so the key is never in a process's arguments.
  else if (BACKEND === "secret-tool") execFileSync("secret-tool", ["store", "--label", id, "service", SERVICE, "account", id], { input: secret, stdio: ["pipe", "ignore", "pipe"], timeout: 15_000 });
  else memory.set(id, secret);
  if (stored(id) !== secret) throw new Error(`refused: the key for ${id} didn't read back from ${BACKEND}`);
}

export function deleteKey(id: string): void {
  if (BACKEND === "keychain") spawnSync("security", ["delete-generic-password", "-s", SERVICE, "-a", id], { stdio: "ignore" });
  else if (BACKEND === "secret-tool") spawnSync("secret-tool", ["clear", "service", SERVICE, "account", id], { stdio: "ignore", timeout: 15_000 });
  else memory.delete(id);
}

/** True only for a keyring that outlives this process. */
export const DURABLE = BACKEND === "keychain" || BACKEND === "secret-tool";
