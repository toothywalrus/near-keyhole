# 0015: What a missed delivery costs, and what a refusal can't do

**Context.** The AI judge's third read, at b6e5e2e, on the real wasm with production timings, found three ways the bond rules of `0013` still went wrong. Each was reproduced first, as a check in `tools/attack.ts` that failed on that wasm.

1. **An offline honest trader.** A stranger bought nine seven-epoch windows over past epochs while the trader's agent was down for one delivery grace. 9.45 of 10 NEAR burned, the record fell from +$2,400 to −$70,000, the trader could no longer sell, and the stranger got all 18.9 NEAR back. Every window over the same epochs burned again.
2. **A laundered loss.** With a 2% floor and one epoch at −$10,000, the trader's own second account bought that epoch plus today, at 1 yocto, and was refused. Voiding the figure raised the record from −$8,800 to −$2,800.
3. **A free read of a known drawdown.** Buying a past losing epoch alone was refused, but adding today's unposted epoch let the window through. The buyer decrypted the loss, settled "refunded" and got everything back.
4. **A suspicion: an oracle outage.** If rounds stop for longer than the posting grace, an honest trader can't compute his figure in time, and his windows burn as missing figures. Checked: true whenever the grace is shorter than twice the round gap, which the seeded deployment's was (36 h against 2 × 30 h).

**Decision.**

- **A refusal costs what it withheld.** The penalty is `penalty_bps` of the price, times the share of the window's epochs refused for the first time. Refusing the same epochs again burns nothing more. The gap charge on the record was already once per epoch.
- **A window that is already over when bought gets `catchup_grace_secs`** (48 h here, against 6 h for a future window), since anyone can buy one at any moment. And a trader can pause his sales (`set_paused`) when his agent will be down.
- **Only a gain stops counting.** A refused epoch's positive figure is voided; a loss stays on the record. Refusing can't improve a record any more.
- **A minimum price per epoch** (`min_price`), so a refusal always costs something real.
- **A window is judged only on what was unknown when it was bought.** Each token records which of its epochs already had a figure (`known_mask`). Those count neither toward a floor breach nor as missing, so a known loss can't make a window refundable.
- **`new` refuses a posting grace that doesn't outlast twice the round gap.** Within that bound, an outage resolves itself: a trade with no round in time is void, and a position is marked at the last round before the end, so a figure can always be computed before the grace ends.

**Consequences.**

- A trader whose agent is down for longer than the catch-up grace can still be made to refuse windows over past epochs. That costs him half their price once per epoch, a gap charge on his record, and the voiding of those epochs' gains, but no longer more than he withheld. Pausing sales prevents it, if he knows in advance.
- A deliberate refusal keeps a figure from ever being proven false. It is shown, and a refused gain doesn't count.
- The seeded deployment's grace grew to 62 h, so a lapse is noticed later there.
