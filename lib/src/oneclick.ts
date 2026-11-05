// Live 1Click dry quotes: keyless, nothing executed, no deposit address created. `confidentiality` is a quote field.
export const ONECLICK = "https://1click.chaindefuser.com/v0";
export const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const WNEAR = "nep141:wrap.near";

export type DryQuote = {
  ok: boolean;
  status: number;
  amountOut?: string;
  amountOutFormatted?: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  minAmountOut?: string;
  timeEstimate?: number;
  confidentiality?: string;
  raw: unknown;
};

/**
 * A dry quote for selling `amountIn` of `from` for `to`, both held on NEAR Intents by the follower. Nothing is signed or sent.
 * Measured 2026-11-05: with no key this works, while setting `confidentiality` (or `depositType: CONFIDENTIAL_INTENTS`) answers 401, "User authentication is
 * required for confidential intent quotes". Per the changelog every 1Click swap has settled confidentially since 2026-10-27 anyway, with no API change.
 */
export async function dryQuote(opts: { from: string; to: string; amountIn: string; slippageBps: number; recipient: string; confidentiality?: "basic" | "advanced"; fetchFn?: typeof fetch }): Promise<DryQuote> {
  const body = {
    dry: true, swapType: "EXACT_INPUT", slippageTolerance: opts.slippageBps,
    originAsset: opts.from, destinationAsset: opts.to, amount: opts.amountIn,
    depositType: "INTENTS", refundTo: opts.recipient, refundType: "INTENTS",
    recipient: opts.recipient, recipientType: "INTENTS",
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...(opts.confidentiality ? { confidentiality: opts.confidentiality } : {}),
  };
  const res = await (opts.fetchFn ?? fetch)(`${ONECLICK}/quote`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "near-keyhole/0.1" }, body: JSON.stringify(body) });
  const raw: any = await res.json().catch(() => ({}));
  const q = raw?.quote ?? {};
  return {
    ok: res.ok, status: res.status, amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted, amountInUsd: q.amountInUsd, amountOutUsd: q.amountOutUsd,
    minAmountOut: q.minAmountOut, timeEstimate: q.timeEstimate, confidentiality: raw?.quoteRequest?.confidentiality ?? body.confidentiality, raw,
  };
}
