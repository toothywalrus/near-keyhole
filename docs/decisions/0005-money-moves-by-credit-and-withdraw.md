# 0005: Money moves by credit and withdraw; the contract states what it owes

**Context.** A sale has many outcomes: settlement, refund, slash, dismissed dispute. Paying out inside each means a promise, a callback and a rollback path per outcome, and a failed transfer in the middle of a state change. Payees can be deleted accounts.

**Decision.** Every state change is synchronous and only moves numbers: bonds, escrows, deposits and credits. Actual NEAR leaves only through `withdraw`, whose callback restores the credit if the transfer fails. A single `obligations` counter holds everything owed, and `solvency()` shows it against the balance and the storage cost.

The storage rule is part of this: nobody's storage is paid from the contract's own balance. Each state-growing call charges its caller for the bytes it actually grew. Each token prepays 500 bytes at mint for what later callers don't pay for: the next holder's entry, the credit entries its settlement or dispute creates, a resale listing. The attack suite holds the contract's slack to never fall below its starting value, and that check found two real leaks while being written: an under-charged registration and uncharged oracle rounds.

**Consequences.** A payee takes two steps. `tools/fuzz.ts` can re-add the whole ledger from views after every random operation and compare it to the counter, to the yocto.
