# 0009: The attested path adds a labeled figure, and can't slash

**Context.** A trader with no buyers has a figure nobody can check. The design's second path is a wasm job that reads the journal in a TEE and reports. OutLayer's hosted run needs a public wasm URL, so tonight it runs locally. A local run must never pass for an enclave's.

**Decision.** `kind` is set by the code path, not by data. `submit_attested` (a registered runner) can only write `SimulatedLocal`; only `on_attested`, reachable only as the callback of OutLayer's `request_execution`, writes `OutLayerTee`, and it stores the hash the worker was pinned to, never the job's word for it, and the contract that delivered it. In the sandbox that contract is a stand-in with real yield/resume, named `mock-outlayer`. An attestation writes a figure beside the posted one and moves no money: the trader chooses to ask for it, so it adds evidence, and only `audit_conclude` and the disputes slash.

The job is the same `keyhole_core` code as the fraud proof, so its figure can't drift: `npm run job` shows them equal. It reads the chain over `wasi:http`. Key material comes from its environment, which is how an OutLayer secret arrives.

**Consequences.** Nothing on testnet is labeled `OutLayerTee`. Going live needs the wasm at a public URL: the README has the command.
