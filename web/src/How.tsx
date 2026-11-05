import { Glyph } from "./bits.tsx";

export function How() {
  return (
    <article className="essay">
      <h1>How it holds</h1>
      <p className="standfirst">Illia Polosukhin, Nov 4: “Private trading where you sell your viewing keys for people to follow or copy trade… PnL can be publicly displayed so people can choose to buy in.” NEAR Intents documents no viewing key, so here the key covers a journal the trader writes, bound to real time.</p>
      <h2><Glyph size={13} /> A key that is mathematics, not access control</h2>
      <p>Each entry is encrypted under a leaf of a binary hash tree grown from one secret seed. Holding a node lets you compute the leaves below it, and only those. To sell a window of slots, the trader hands over the few nodes that cover it: at most 32 of them, and six for a typical week. The buyer can read exactly that window. Nothing before, nothing after. No revocation, no key rotation, no enclave, nobody online. A plain viewing key can't be taken back; this one never reached past its window.</p>
      <h2><Glyph size={13} /> A sale with no operator</h2>
      <p>The buyer pays into escrow with a one-time key made for this purchase. The trader posts the nodes wrapped to that key, and the contract checks each one's commitment against a Merkle root posted before any sale. If the wrapped bytes are garbage, the buyer reveals the one-time secret and the contract itself runs x25519 and ChaCha20 and compares: about 10 Tgas, 3% of what a transaction can carry. A trader caught this way loses his bond: 40% to whoever proved it, the rest burned. A buyer who disputes an honest delivery loses a deposit of at least the window's price.</p>
      <p>There's a second proof, for a trader who commits to one tree and encrypts with another: reveal a single node, and the contract walks it down to the entry's leaf and checks the tag.</p>
      <h2><Glyph size={13} /> A figure you can trust before you pay</h2>
      <p>Entries are committed as they happen, numbered in a hash chain, with the slot checked against the block's clock. So no backdating and no deleting losers. PnL is posted per epoch, with the bond behind it. Anyone holding an epoch's keys can open them in the contract, which recomputes the figure in exact integers, from oracle prices. One unit of difference slashes. A trade is priced at the first round <em>after</em> it was written, so however fast a trader's data is, he can't know his own fill. A stranger can trust a number as far as its bond and its past buyers go. That's what the board shows.</p>
      <h2><Glyph size={13} /> Copying</h2>
      <p>A follower's app decrypts locally, applies its owner's limits, and asks 1Click for a live dry quote. A real NEP-413 <code>token_diff</code> settles on the real <code>intents.near</code> wasm, in the sandbox (<code>npm run copy</code>) and in this tab, and slippage against the trader is measured from the balance changes. An honest trader writes the entry after his fill; nothing forces him to. In this tab, “Copy it here” signs a real intent and settles it on the real <code>intents.near</code> wasm with a local solver.</p>
      <h2>What it can't do</h2>
      <ul>
        <li><b>A buyer can leak.</b> What he read, or the keys themselves. No watermarking is attempted.</li>
        <li><b>A dispute publishes.</b> Revealing the one-time secret makes that sale's nodes public, so a false dispute gives the window away. The griefer pays for it, but the leak has no fix short of zero knowledge. An audit publishes that epoch's trades too.</li>
        <li><b>One account can't prove it isn't one of ten.</b> Run ten journals and show the lucky one. Bond, age, trades and the deflated Sharpe price that doubt; they don't remove it.</li>
        <li><b>A journal is what a trader wrote.</b> An entry committed before the outcome is a valid signal record even if it was never executed. A settlement reference is his own claim: the contract never reads it. Nothing forces a fill before publishing, so a trader could publish first and trade against followers. The key covers this journal, not a real confidential trade: on mainnet that history is invite-only, and no public viewing key exists.</li>
        <li><b>A trader can refuse a window.</b> Delivery can't be forced. A refusal returns the escrow, burns half the price from the bond, and costs at least 2% of the book on his public record, on each epoch it covers. An old false figure stays unproven if he pays that every time.</li>
        <li><b>A figure with no buyers is checked by nobody.</b> Only the bond stands behind it, unless the trader runs the attested job. That job is labeled SIMULATED here, since it runs locally, not in an enclave.</li>
        <li><b>The price feed is only as dense as its relayers.</b> On a feed relayed by volunteers, a trader could try to choose which round gets relayed next. Recorded rounds here are replayed by a trusted recorder, and labeled. On testnet they're public in this repo, so a trader there can know the next price: the demo's PnL shows the mechanism, not skill.</li>
        <li><b>Slashing yourself recovers 40%.</b> Through a second account a trader can be his own prover. The other 60% burns, whichever account proves it, and no buyer is ever paid from a bond, so no second account can draw on one.</li>
        <li><b>Nobody has audited this.</b> Two separate AI reviews found real bugs after every test passed: one let any buyer slash an honest trader, another let a trader's second account pull the bond out. They're fixed and listed in the repo. No human has reviewed the contract.</li>
        <li><b>It's a technical demo.</b> Selling trading signals is regulated in many places.</li>
      </ul>
    </article>
  );
}
