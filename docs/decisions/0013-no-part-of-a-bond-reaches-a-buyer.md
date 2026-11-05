# 0013: No part of a bond ever reaches a buyer

**Context.** An AI judge's dry run, with no build context, reported that a trader's second account could pull the bond out. Reproduced on the real wasm (`tools/repro/before-0013.ts`, against `66d4cae`):

- A sybil buys, the trader doesn't deliver, and the sybil claims the price plus a penalty from the bond: a 10 NEAR bond down to 0.82 in 72 hours, status still `Active`, past the 30-day unbonding delay.
- Worse, found while fixing that: a sybil buys a window, the trader delivers and simply posts no figure. The escrow goes to the trader, and the refund goes to the sybil from the bond: **the whole bond out in one cycle**, with no late delivery on the record.
- A sybil's young window drew nothing on a slash but stayed in the pro-rata denominator, cutting a real buyer's share from 0.600 to 0.128. A window old enough drew real money.

These are one flaw. A buyer can be the trader, so anything paid from a bond to a buyer is a way out of it. `0012` fought that with age rules, and each rule had an edge.

**Decision.**

- **Refunds come from escrow, never from the bond.** A window that breaches its floor or lacks a figure settles with its escrow going back to the holder, in full, whatever the size of the bond. The holder is better off than under the pro-rata design, which could pay a fraction.
- **Penalties burn.** A refused delivery or a missing figure burns `penalty_bps` of the price from the bond (50%). The burn stops being owed to anyone. A true loss past the floor burns nothing: as first written it did, which let strangers buy into a drawdown to burn an honest trader's bond (#15).
- **A slash pays only the prover** (40%), and the rest burns. The buyers' pool is gone, and with it dilution: buyers with open windows get their escrow back whole. So the design's "slash to the prover and buyers" is now "to the prover, and escrow back to buyers".
- **A bond leaves three ways only:** burning, a prover's share, `withdraw_bond` after the delay. `tools/fuzz.ts` re-adds this for every bond after every operation.
- **A trader below `min_bond` can't sell.**
- **What's missing counts against the shown figure.** The `score` view charges the worse of the trader's floor and 2% of the book for each epoch with no figure once its grace is over, and each epoch a buyer was refused delivery. Otherwise a trader could post winners only: true −$400, public +$200.
- **`covering_sales` counts delivery, not payment,** and falls when a delivery is proven garbage. The board calls it Checkable.
- **`audit_cancel`,** half the deposit to the trader while he stands, the whole of it back once he's slashed. **`dispute_entry` has no deadline** and works on a settled window, so one unopenable entry can't protect a false figure once the challenge window is over.
- **`request_attested` sends `rpc`,** which the job needs (it printed `no rpc` as shipped, and the test hid that by injecting it). `tools/job.ts` now feeds the job exactly what the contract sent, and the callback exactly what the job printed. OutLayer's docs say a wasm32-wasip2 job can make outbound HTTP calls, and mention no allowlist; the hosted run hasn't been tried.
- **The enclave's label requires OutLayer's own account.** A callback from any other contract writes `OutLayerStandIn`. The owner still chooses the job's hash: `OutLayerTee` means that hash ran in OutLayer's enclave.

**Consequences.**

- A proven lie costs at least 60% of the bond, whichever account proves it. A trader who proves himself a liar keeps 40%, so the choice of 40% is a real trade-off: lower, and nobody hunts; higher, and lying gets cheaper.
- A floor costs the trader his lost revenue and nothing else. That's the trade for it being safe: only a figure that differs from the committed entries can cost a bond.
- A trader can still refuse a window, keeping an old false figure from being proven (the judge's suspicion, confirmed). The figure stops counting on the public record (`voided_e6`), and he pays half the price from the bond, loses the sale, and takes at least 2% of the book off his public figure per epoch. Delivery can't be forced: what's left of the limit is stated.
- The bond can be small next to the claim. The board now shows it next to the PnL, and says that a lie earning more than 60% of the bond can still pay.
- The contract account keeps a FullAccess key on testnet, so the demo can be replaced; the recorder is trusted. `npm run verify` prints this. "No operator" describes the sale and the proofs, not this deploy's administration.

**Later (same day).** [`0015`](0015-what-a-missed-delivery-costs.md) bounds what a refusal costs, and closes three more ways around these rules.
