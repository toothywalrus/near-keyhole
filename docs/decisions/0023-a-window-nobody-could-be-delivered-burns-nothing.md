# 0023: A window nobody could be delivered burns nothing when its figure is missing

**Context.** `0015` made a refused delivery cost once per epoch, after a stranger was shown burning 9.45 of 10 NEAR
from an offline trader's bond with nine windows over the same epochs. `0021` looked again at windows whose holder
took them by plain transfer and never registered a one-time key, and kept the rule that they settle like delivered
ones. A hostile read on 2026-11-13 (#21) put the two together. `settle` burned `penalty_bps` of the price for every
window on an epoch with no figure, keyless ones included. So a stranger buys any number of windows on a coming
epoch, passes each to a second account that registers no key, and waits. If the trader's agent is up, the second
account registers its keys before settlement and gets ordinary windows. If the agent is down for that epoch, each
window burns half its price from the bond and is refunded in full: five windows of 0.3 NEAR burned 0.75 NEAR at no
cost, reproduced as a failing check on the wasm of `60918c1` ("KEYLESS"). That is the per-window burn `0015` ended,
by another door.

**Decision.** In `settle`, a missing figure burns nothing for a window that is still `Pending` with no key
registered. It is still refunded whole, and the missed epoch still counts against the record. A delivered window
on an epoch with no figure burns as before: there the trader was present, held somebody's money for a checkable
figure, and didn't post one.

Not "once per epoch" bookkeeping for missing figures as well: that needs new state per epoch, and delivered windows
on a missed epoch are real buyers who were each owed a figure.

**Consequences.**

- An offline trader loses, for an epoch he misses: the escrows of that epoch's windows, half the price once per
  epoch for windows he couldn't deliver to a registered key (`0015`), and nothing more for keyless ones.
- A keyless window still lets its holder choose when to register a key, and so when the trader's delivery grace
  starts, paused or not. That stays, and `docs/limits.md` says so.
- `sale.rs` (`settle`), one line. Checks: "KEYLESS" in the attack suite; one mutant.
