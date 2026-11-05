# 0008: The board prices cherry-picking; it can't remove it

**Context.** The classic attack on any public track record: run ten journals, show the lucky one. Nothing on-chain can show that one account isn't one of ten, because accounts are free.

**Decision.** Say it on the page, next to the number. The board shows bond, age, trade count, past buyers, and how many epochs a past buyer could have checked, and a deflated Sharpe ratio (Bailey and Lopez de Prado, 2014) computed from the public daily series, with the viewer choosing the assumed number of trials: best of 1, 10 or 100. The default sort is by PnL, which puts a liar on top. That's on purpose.

**Consequences.** "Past buyers" is only as real as what it costs to fake: a trader buying from himself through a second account pays only gas, as the price goes back to him. The prover's share has the same shape: a trader slashing himself recovers half the bond, and the rest stays locked, which is why it isn't higher. Both limits are stated in the README and the app.
