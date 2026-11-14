# 0016: The protocol takes a fee on a sale that closes for the trader, and nowhere else

**Context.** Keyhole had no way to make money: no protocol cut, no treasury, no business section (#17). The investors
judging ask "is there a business?", and the rubric's utility anchor asks for "a plausible way to make money". Any fee
has to keep `0005` (every yocto moves by credit and `withdraw`, `obligations` is what's owed) and `0013` (no part of a
bond ever reaches a buyer, since a buyer can be the trader).

**Decision.**

- `Config` gains `fee_bps` and `treasury`, set once at `new` like every other rule. `fee_bps` is at most 2,000 (20%),
  and a non-zero fee needs a treasury (`fee_rule`, checked in `new`). Both default to none, so a config written
  before the fee reads as no fee.
- The fee is taken in exactly one place: `settle`, when a window closes in the trader's favour. The escrow splits
  into the trader's `price - fee` and the treasury's `fee`, rounded down, both as credits. `obligations` doesn't change.
- A window that goes back to its holder (a breach, a lapse, a refusal, a slashed trader, a missed delivery) goes
  back whole, with no fee. A resale between holders carries no fee. A bond never pays one.
- The deployments here take 5% (`FEE_BPS` in `tools/world.ts`, the seeded state and testnet).

**Consequences.**

- The protocol earns only when a buyer got what he paid for and the trader was paid: it has no stake in refunds,
  slashes or burns, so it gains nothing by ruling either way.
- `tools/attack.ts` (the "protocol fee" block, `FEE CAP`), `tools/fuzz.ts` (the treasury holds exactly the fees on
  closed windows after every operation) and five mutants check it. `contracts/keyhole/src/tests.rs` has the rules
  and the split as a property test.
- The fee is fixed for a deployment's life. Changing it means a new deployment, as with every other rule.
