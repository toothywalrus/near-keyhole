# 0025: Decoy entries hide a thin epoch's trade, from the agent, with no contract change

**Context.** A hostile read on 2026-11-13 (#21) showed that a journal with one trade in an epoch isn't private once
the figure is posted. The entry's time, the epoch's entry count, the posted figure and the rounds are all public, so
`figure = size × (mark − fill)` is one equation in one unknown: a stranger with no key gets one candidate per feed,
side and size included. The attack suite shows it ("LIMIT, shown") and `docs/limits.md` states it. The suggested
mitigation was void decoy entries written by the trader's agent.

**Decision.** A decoy is a well-formed entry with `qty_e8 = 0`. Every implementation of the PnL rule (the Rust core
the contract and the job use, and the TypeScript twin) already voids a zero quantity: it changes nothing but the void
count. So a decoy moves no figure, costs no score, passes an audit that opens it, and from outside is an entry like
any other. `decoyEntry` and `TraderAgent.writeDecoy` write one; the window reader labels it, and `decideCopy` refuses
to copy it.

Decoys only help when they price at a different round from the trade. One written next to the trade gives the same
candidate and hides nothing, so the agent writes them at other moments of the epoch. "DECOYS" in `npm run attack`
writes three around the same short as "LIMIT, shown", with a round between each: the stranger's sum gives four
distinct candidates per feed instead of one, with both sides among them, and the audit still finds the figure true.

Not a contract change (e.g. padding every epoch to a fixed count): that needs a wasm rebuild, a reseed and the
mutants on a deployment the owner is about to make. Not part of the testnet demo run: its transaction count is
quoted and its record is checked, and a decoy there would be invisible by design anyway.

**Consequences.**

- It narrows the limit and doesn't close it. Public still: how many entries and when, the net figure, and the side
  whenever every candidate has the same sign. A stranger who assumes only one entry is real still has a short list.
- The public entry count includes decoys, so a buyer of a past window learns at most how many trades it holds.
- Each decoy costs a trader an entry's storage deposit and gas, and an auditor one more opening. Nothing forces a
  trader to write any; it is the agent's policy, not a rule.
- Works on the deployed contract as it is, since nothing on chain changed.
- `lib/src/entry.ts`, `lib/src/client.ts`, `lib/src/intents.ts`, `web/src/Reader.tsx`, `tools/attack.ts`.
