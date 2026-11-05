// UNEXERCISED. WRITTEN AGAINST THE DOCS (docs.near-intents.org, read 2026-11-05), NEVER RUN: no mainnet call has been made with this file, and none is
// made by any command in this repo. It's here so the distance from the sandbox path to real confidential trades is visible.
//
// Two documented paths: a normal quote with `confidentiality: "basic" | "advanced"`, or a Confidential Intents *balance* (`depositType:
// CONFIDENTIAL_INTENTS`) authorised by a signed intent. Since 2026-10-27 every 1Click swap settles confidentially with no API change. What doesn't exist in
// the docs is a viewing key: `GET /v0/account/history` is invite-only. So Keyhole's window key covers a journal the trader writes, not an Intents view key.
import { dryQuote, ONECLICK } from "../lib/src/oneclick.ts";

export type ConfidentialOrder = { from: string; to: string; amountIn: string; slippageBps: number; recipient: string };

/** Step 1: what the copy would get. Without a user's JWT this answers 401 (measured 2026-11-05), so the free path quotes without the field: see oneclick.ts. */
export const previewConfidential = (o: ConfidentialOrder) => dryQuote({ ...o, confidentiality: "advanced" });

/**
 * Steps 2 and 3, as documented, for an owner to run with his own key and money. NOT RUN.
 * The non-dry quote returns a `depositAddress`; the owner funds it, or for a Confidential Intents balance signs a transfer intent, and 1Click settles.
 * The two transaction hashes in `nearTxHashes` are the shield and the unshield, not the swap.
 */
export function mainnetRequest(o: ConfidentialOrder): { url: string; body: Record<string, unknown>; warning: string } {
  return {
    url: `${ONECLICK}/quote`,
    body: {
      dry: false, swapType: "EXACT_INPUT", slippageTolerance: o.slippageBps, originAsset: o.from, destinationAsset: o.to, amount: o.amountIn,
      depositType: "CONFIDENTIAL_INTENTS", refundTo: o.recipient, refundType: "CONFIDENTIAL_INTENTS", recipient: o.recipient, recipientType: "CONFIDENTIAL_INTENTS",
      confidentiality: "advanced", deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    warning: "UNEXERCISED: written against the docs, spends real money, the owner's to run. Field names for the confidential balance path are from the docs and have never been tried here.",
  };
}
