/** A follower's limits, as decideCopy takes them: their size relative to the trader's book, a cap per trade, every feed, 50 bps of slippage. */
export function copyQtyLimits(myBookUsd: number, capUsd: number, theirBookUsd: number) {
  const scale = Math.min(myBookUsd / theirBookUsd, 1);
  return { scale, limits: { maxNotionalUsd: capUsd, feeds: [0, 1, 2], scale, maxSlippageBps: 50 } };
}
