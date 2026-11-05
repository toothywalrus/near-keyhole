# 0014: What is, and isn't, guaranteed about a journal

**Context.** The README said a settlement reference "gets a settled badge", and that "the trader's fill always comes first, by construction". An AI judge showed both were overstated: a random hash with the flag set was accepted and shown as settled, since the contract never reads it, and nothing forces a trader to fill before publishing.

**Decision.** Say what's true.

- **Guaranteed by the contract:** an entry existed, with this number and ciphertext, at this time, and PnL is computed from it at oracle prices after that time.
- **Not guaranteed:** that the trade happened. A settlement reference is the trader's claim and is shown as "claims a fill (unverified)". Nothing forces a fill before publishing, so a trader could publish first and trade against his followers.
- **The key covers the journal, not a confidential trade.** No public viewing key exists for Confidential Intents (`docs/research`, read 2026-11-05), so what's sold is a window into what the trader chose to write. That's the biggest gap between this and the idea as Illia put it, and it closes only if NEAR ships a viewing key or the trader's fills become attestable.
- **Copying is shown as far as it's real for free:** the page signs a real NEP-413 `token_diff` and settles it on the real `intents.near` wasm in the tab, with a local solver and test tokens. It is not a mainnet copy. `lib/src/copy-local.ts` is the same signing code as the sandbox's.

**Consequences.** The pitch gets narrower and truer: a stranger can check a *signal record*, not a brokerage statement.
