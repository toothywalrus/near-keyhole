# Draft post for X (the owner posts it)

> Following a trader means trusting a screenshot. And once you've paid for a "viewing key", you're trusting them to revoke it, or to keep posting the truth.
>
> Keyhole: buy seven days of someone's private trade journal. You read exactly those seven days. The next day's entry stays sealed, with nobody revoking anything.
>
> In the demo, the trader at the top of the board posts a great PnL. A buyer does the sum, and the NEAR contract does it too: it opens the entries, prices them against the oracle, sees the lie and hands the buyer 40% of the bond. A dispute costs about 10 Tgas: no operator, no TEE.
>
> A copy trade settles as a real NEP-413 token_diff on the intents.near wasm, in your tab, with a local solver. A journal is what a trader wrote: a checkable record, not a statement. Testnet only, and not investment advice.
>
> Built at NEAR HACKATHON with @NEARProtocol #NEARHackathon. Try it: <link once the owner has it hosted>

Attach `docs/demo/keyhole-demo.mp4`.

Per HACKATHON.md's advice: the user's problem first, one complete moment, NEAR's role concretely, and a next step. Before posting: replace the link. The contract's gas figure comes from the testnet run in `docs/demo/testnet-run.json`; re-check it if the contract is redeployed.

---

# Thread kit (2026-11-06), from what worked on X

**What we saw:** 149 `#NEARHackathon` posts were read on Nov 6 (near-lab `docs/research/round-six-2026-11-05/x-nearhackathon-2026-11-06.md`).
- **Format:** the launches that landed got 60–90 likes and about 2,000 views. Each was one finished moment on a 16:9 video, often 1920×1080.
- **Attacks:** an attack tried against your own build on camera does well.
- **Day N diaries:** these got 0–9 likes.
- **NOVA:** NOVA Copy-Trading built this same idea. Before launching, it replied under Illia's Nov 4 post, then quoted his words in its thread. Do the same, and be fair to NOVA: name it once, as a different design.

**Where:** a reply under https://x.com/ilblackdragon/status/2118027843980366222, or a new post that quotes it.

**1/**
> You asked for "private trading where you sell your viewing keys … PnL can be publicly displayed so people can choose to buy in."
>
> Keyhole does that, and the PnL can be checked before you buy. The contract checks it, not the seller.
>
> Built at NEAR HACKATHON @NEARProtocol #NEARHackathon 🧵

Attach the video.

**2/** The key
> The key is a window, not a password. Buy 7 days of a trader's journal and you can decrypt exactly those 7 days. The day after stays sealed.
>
> Nobody revokes anything, and nobody needs to be online. The keys for the next day were never sent.

Attach `reader.png`: the ruler, and the next day's entry failing to open.

**3/** The PnL
> Every PnL on the board has a bond behind it. Any buyer can prove a false figure to the NEAR contract: it opens the entries, prices them against the oracle, and slashes the bond.
>
> In the demo the top trader lies. The buyer catches it and collects 40%; the rest burns.

Attach `caught.png`.

**4/** The sale
> The key sale has no operator. If the trader sends a garbage key, the buyer reveals a one-time secret, and the contract itself runs x25519 and ChaCha20 to check the delivery. It refunds the buyer and slashes the trader, for about 10 Tgas.

**5/** Attacks refused
> We tried to break it 354 ways: garbage key, backdated entry, deleted loser, window overreach, resale replay, a lie about PnL. Every one is refused.
>
> `npm run attack` runs them in about 2 s.

**6/** Being honest about it
> Not the first copy-trading build here. NOVA shipped one on mainnet, with a TEE that rotates keys. Keyhole is a different bet: no TEE, no revocation, and the PnL can be challenged before you pay.
>
> Testnet only, and not investment advice.

**7/** Next step
> Run it yourself: clone, `npm run judge`, then open the demo. <repo link>
>
> What would make you trust a trader's number enough to pay for it?

**Proof posts for later in the week.** One a day at most. Each is one short clip of 60 s or less, 16:9:

1. **"Try to open it anyway"**: every key the window allows, failing on the next day's entry. Caption: *"This is what a revoked key looks like when nobody has to revoke it."*
2. **The lying trader caught:** the board, the recompute in the tab, Prove it, the bond slashed. Caption: the figures, and "one of these numbers was false."
3. **The attack suite scrolling:** `npm run attack` ending at 354 refused, then one attack explained in one line.

**Video:** the recording is 1280×720 and 77 s. A 1920×1080 cut is better for X, because NOVA's post was 1080p. `npm run record` re-records it.

**Before posting:**
- Replace the repo link.
- Check every number against a fresh `npm run judge`.
- Leave the old draft above alone for reference.
