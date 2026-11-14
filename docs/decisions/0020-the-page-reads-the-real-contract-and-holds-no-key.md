# 0020: The page reads the real testnet contract live, holds no key, and prints only the run's own names

**Context.** The web app is a seeded simulation: the real wasm on a local chain in the tab (`0007`). A visitor could
do the whole moment there and still not know whether anything exists on a real chain; the Proof page had a table
of transactions and a small live list of every trader on the contract. A cold review named this the largest gap
in the product: nothing on the page is real, and nothing can be done on testnet from it (#21).

**Decision.**

- The Proof page leads with **Live on NEAR testnet**: view calls to the deployed contract as the page loads
  (`web/src/Live.tsx`): the account's key list (locked), what it holds and owes, the recorded run's traders with
  their status as the contract states it (both slashes with the contract's own reason, the false figure beside the
  recomputed one, the attested label), the windows sold with their states, and the first entries of a journal as
  ciphertext. The board carries one line of it, linking there. If the read fails the page says testnet couldn't be
  read, that nothing is wrong with the page, and offers a retry; the board's line simply isn't shown.
- **Read-only, and said so.** No wallet was added. A wallet flow would let a visitor buy a window on testnet, but
  the traders of the run are offline, so a purchase could only end in a refusal, and a live trader agent is a
  service to run. The page says where acting on testnet is possible today: the command line.
- **Only the run's own accounts are shown by name.** The contract is open: anyone can register a trader with any
  32-byte handle, and a page that printed them would publish a stranger's text under this project's name. Other
  accounts are counted and not printed.
- The run's two traders that were still selling paused their sales with `set_paused` after the run, since an
  offline trader on an open contract can be made to refuse a window by anyone (`0015`). They stay `Active`.
- The page test answers the RPC from a recording of the contract's own views (`fixtures/testnet-views.json`), with
  one invented stranger added, so it needs no network and checks the real parsing and rendering.

**Consequences.**

- The page depends on one public RPC for this section only; everything else works offline once loaded.
- A new deployment needs the recording refreshed along with `docs/demo/testnet-run.json`.
- Acting on testnet from the page (a wallet, and a trader agent that stays online) is the next piece of product
  work, not done here.
