//! The second path to a number: a trader with no buyers yet can have the attested job read the journal and report the figure. Two ways
//! in, and the code path sets `kind`, so a local run can't pass for an enclave's:
//!
//! - `submit_attested`: a registered runner hands in the job's output after running it locally under wasmtime. `SimulatedLocal`. No enclave.
//! - `request_attested`: OutLayer's `request_execution`, the production shape. Its callback writes `OutLayerTee` only if the contract is OutLayer's own account, and
//!   `OutLayerStandIn` for anything else, such as the sandbox's mock. The owner chooses the job by its hash, so `OutLayerTee` means "this hash ran in OutLayer's enclave", and that
//!   hash is public to check.
//!
//! An attestation doesn't slash. It only adds a labeled figure beside the posted one, since the trader chooses to ask for it.
use crate::*;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{ext_contract, Gas, PromiseError};

const GAS_REQUEST: Gas = Gas::from_tgas(80);
const GAS_ON_RESULT: Gas = Gas::from_tgas(20);
const ATTESTED_STORAGE_BYTES: u128 = 300;

/// Where OutLayer finds the job, and its limits.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct OutLayerConfig {
    pub contract: AccountId,
    /// The RPC the job reads the chain from, passed in its input.
    pub rpc: String,
    pub wasm_url: String,
    pub wasm_hash: String,
    pub max_instructions: U64,
    pub max_execution_seconds: U64,
}

#[ext_contract(ext_outlayer)]
#[allow(dead_code)]
trait OutLayer {
    #[allow(clippy::too_many_arguments)]
    fn request_execution(&mut self, source: Value, resource_limits: Option<Value>, input_data: Option<String>, secrets_ref: Option<Value>, response_format: Option<String>, payer_account_id: Option<AccountId>, params: Option<Value>);
}

#[near(serializers = [json])]
pub struct JobOutput {
    pub trader: AccountId,
    pub epoch: u32,
    pub pnl_e6: I128,
    pub head: H32,
    pub job_sha256: String,
}

#[near]
impl Keyhole {
    pub fn set_runner(&mut self, runner: AccountId, enabled: bool) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        if enabled {
            self.runners.insert(runner, "simulated-local".to_string());
        } else {
            self.runners.remove(&runner);
        }
    }

    pub fn set_outlayer(&mut self, outlayer: OutLayerConfig) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        self.outlayer = Some(outlayer);
    }

    /// A registered runner reports what the job printed, paying for the storage. It is always labeled `SimulatedLocal`: this method has no other way to write it.
    #[payable]
    pub fn submit_attested(&mut self, output: JobOutput) {
        require!(self.runners.contains_key(&env::predecessor_account_id()), "not a registered runner");
        let before = env::storage_usage();
        self.write_attested(output, AttestKind::SimulatedLocal, env::predecessor_account_id());
        self.epochs.flush();
        self.charge_storage(before, env::attached_deposit().as_yoctonear(), &env::predecessor_account_id());
    }

    /// The trader asks OutLayer to run the job over one epoch. The key material reaches the job as an OutLayer secret, inside the enclave.
    #[payable]
    pub fn request_attested(&mut self, epoch: u32, secrets_ref: Option<Value>) -> Promise {
        let who = env::predecessor_account_id();
        let id = self.tid(&who);
        let o = self.outlayer.clone().unwrap_or_else(|| env::panic_str("no OutLayer configured"));
        require!(self.epoch_rec(id, epoch).posted_e6.is_some(), "that epoch has no figure yet");
        // The callback's storage stays here, and the rest goes to OutLayer.
        let keep = ATTESTED_STORAGE_BYTES * env::storage_byte_cost().as_yoctonear();
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached > keep, "attach OutLayer's fee, and a little for storage");
        ext_outlayer::ext(o.contract.clone())
            .with_attached_deposit(near_sdk::NearToken::from_yoctonear(attached - keep))
            .with_static_gas(GAS_REQUEST)
            .with_unused_gas_weight(1)
            .request_execution(
                json!({ "WasmUrl": { "url": o.wasm_url, "hash": o.wasm_hash, "build_target": "wasm32-wasip2" } }),
                // Numbers, not U64's strings: outlayer.testnet's `ResourceLimits` takes `u64`, and refused a string on 2026-11-10 ("invalid type: string").
                Some(json!({ "max_instructions": o.max_instructions.0, "max_memory_mb": 64, "max_execution_seconds": o.max_execution_seconds.0 })),
                Some(json!({ "contract": env::current_account_id(), "trader": who, "epoch": epoch, "rpc": o.rpc }).to_string()),
                secrets_ref,
                Some("Json".into()),
                None,
                None,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_RESULT).on_attested(who, epoch))
    }

    /// OutLayer's result. Only OutLayer's promise can reach this: it's private, and the promise goes through `request_attested` only.
    #[private]
    pub fn on_attested(&mut self, trader: AccountId, epoch: u32, #[callback_result] result: Result<Option<Value>, PromiseError>) -> bool {
        let value = match result {
            Ok(Some(v)) => v,
            _ => {
                env::log_str("OutLayer gave no result");
                return false;
            }
        };
        let body = value.get("Json").cloned().unwrap_or(value);
        let mut out: JobOutput = match serde_json::from_value(body) {
            Ok(o) => o,
            Err(_) => {
                env::log_str("OutLayer's result isn't a job output");
                return false;
            }
        };
        if out.trader != trader || out.epoch != epoch {
            env::log_str("OutLayer's result is for another epoch");
            return false;
        }
        // The hash the worker was pinned to, never the job's own word for it.
        let o = self.outlayer.clone().unwrap_or_else(|| env::panic_str("no OutLayer configured"));
        out.job_sha256 = o.wasm_hash;
        let kind = if matches!(o.contract.as_str(), "outlayer.testnet" | "outlayer.near") { AttestKind::OutLayerTee } else { AttestKind::OutLayerStandIn };
        self.write_attested(out, kind, o.contract);
        true
    }
}

impl Keyhole {
    fn write_attested(&mut self, out: JobOutput, kind: AttestKind, via: AccountId) {
        let id = self.tid(&out.trader);
        let t = self.trader(id);
        let mut rec = self.epoch_rec(id, out.epoch);
        require!(rec.posted_e6.is_some(), "that epoch has no figure yet");
        // The job read the journal as of this head: it must be an entry at or after the epoch's last one, so it saw the whole epoch.
        if rec.entries > 0 {
            let last = rec.first_seq.0 + rec.entries as u64 - 1;
            let e = self.entries.get(&Self::key(id, last)).unwrap_or_else(|| env::panic_str("no such entry"));
            require!(e.head == out.head, "the job didn't read this epoch's last entry");
        } else {
            require!(t.head == out.head || t.next_seq.0 == 0, "the job read another journal");
        }
        rec.attested = Some(Attested { kind, via, pnl_e6: out.pnl_e6, job_sha256: out.job_sha256, at_ms: U64(self.now_ms()) });
        self.epochs.insert(Self::key(id, out.epoch as u64), rec);
    }
}
