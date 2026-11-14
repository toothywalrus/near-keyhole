# The post for X

A thread, as a reply under Illia Polosukhin's Nov 4 post (https://x.com/ilblackdragon/status/2118027843980366222) or a
new post that quotes it. Two links are filled in when it's posted: `<demo link>` (the hosted page) and `<repo link>`.
Every number below comes from `npm run judge` and `docs/demo/testnet-run.json`; check them against a fresh run first.

**1/**
> You asked for "private trading where you sell your viewing keys … PnL can be publicly displayed so people can choose to buy in."
>
> Keyhole does that, and the PnL can be checked before you buy. The contract checks it, not the seller.
>
> Built at NEAR HACKATHON @NEARProtocol #NEARHackathon 🧵

Attach `docs/demo/keyhole-demo.mp4` (1920×1080).

**2/** The key
> The key is a window, not a password. Buy 7 days of a trader's journal and you can decrypt exactly those 7 days. The day after stays sealed.
>
> Nobody revokes anything, and nobody needs to be online. The keys for the next day were never sent.

Attach `docs/demo/reader.png`: the bought window drawn through the keyhole, and the tree nodes that cover exactly it.

**3/** The PnL
> Every PnL on the board has a bond behind it. Any buyer can prove a false figure to the NEAR contract: it opens the entries, prices them against the oracle, and slashes the bond.
>
> In the demo the top trader lies. The buyer catches it and collects 40%; the rest burns.

Attach `docs/demo/caught.png`: the receipt of the slash.

**4/** The sale
> The key sale has no operator. If the trader sends a garbage key, the buyer reveals a one-time secret, and the contract itself runs x25519 and ChaCha20 to check the delivery. It refunds the buyer and slashes the trader, for about 10 Tgas.

**5/** Attacks refused
> About 30 named attacks, 407 checks: garbage key, backdated entry, deleted loser, window overreach, resale replay, a lie about PnL. Every one is refused.
>
> `npm run attack` runs them in about 2 s.

**6/** Being honest about it
> Not the first copy-trading build here. NOVA shipped one on mainnet, with a TEE that rotates keys. Keyhole is a different bet: no TEE in the sale, no revocation, and a PnL anyone holding the keys can challenge.
>
> A journal is what a trader wrote: a checkable record, not a brokerage statement. Testnet only, and not investment advice.

**7/** Next step
> Try it: <demo link>. Or run it yourself: clone, `npm run judge`. <repo link>
>
> What would make you trust a trader's number enough to pay for it?

## Short clips for later in the week

One a day at most, each 60 s or less, 16:9:

1. **"Try to open it anyway"**: every key the window allows, failing on the next day's entry. Caption: *"This is what a revoked key looks like when nobody has to revoke it."*
2. **The lying trader caught:** the board, the recompute in the tab, Prove it, the bond slashed. Caption: the figures, and "one of these numbers was false."
3. **The attack suite scrolling:** `npm run attack` ending at 407 checks passed, then one attack explained in one line.

`npm run record` re-records the video and the three images from `web/dist`.
