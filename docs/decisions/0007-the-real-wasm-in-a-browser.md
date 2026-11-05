# 0007: The web app runs the real contract wasm in the tab

**Context.** A judge should be able to do the whole moment, including buying, catching a liar and collecting a bond, free and with no wallet. Testnet needs funded accounts and a live trader to deliver; a mock of the contract in TypeScript would be a second implementation of the very logic under test, and could lie.

**Decision.** `lib/src/vm.ts` is a small NEAR host in JavaScript: registers, storage with rollback on panic, receipts and promise results, a clock that can be set. It runs `res/keyhole.wasm`, the same bytes as on testnet, in the browser. The seed generator runs the same wasm in Node through the real recorded rounds at their real timestamps, and the app starts from that state. The attack suite runs on the same host too, which is how it covers months of contract time in seconds, and then runs again on a real sandbox node.

**Consequences.** It meters no gas and has no validators, so no gas number is ever claimed from it: those come from the sandbox and testnet. Every page carries a banner saying what's seeded. The demo traders' tree seeds are derived from public strings, so the page can play the trader's agent and anyone can repeat the seeding; they exist only on the local host. Reloading restarts the local chain, and a one-time key made in a tab dies with it, which is honest behaviour for a one-time key.
