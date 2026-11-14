//! SANDBOX ONLY. A stand-in for `outlayer.testnet` with the same surface Keyhole uses:
//!
//! - `request_execution(source, resource_limits, input_data, secrets_ref, response_format,
//!   payer_account_id, params)`: the current 7-argument signature. It yields (real
//!   `promise_yield_create`), and the caller's `.then` waits on that promise.
//! - `resolve_execution(request_id, response)`: what OutLayer's worker calls with the job's result
//!   (operator only). It resumes the yield (real `promise_yield_resume`).
//! - `on_execution_response`: returns the job's JSON output to the caller, or `null` when the run
//!   failed or the yield timed out, as OutLayer's own callback does.
//!
//! What it does NOT do is run anything or attest anything: the sandbox suite plays the worker, runs
//! res/keyhole_pnl_job.wasm under wasmtime, and calls `resolve_execution` with the output. It exists
//! so the contract's production callback path (yield, resume, timeout) runs end to end without
//! OutLayer. Reference: out-layer/outlayer contract/src/execution.rs (read 2026-10-30).
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, CryptoHash, Gas, GasWeight, PanicOnDefault, PromiseError};

const DATA_ID_REGISTER: u64 = 0;
const RESPONSE_GAS: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Request {
    pub request_id: u64,
    pub sender_id: AccountId,
    pub source: String,
    pub input_data: String,
    pub payment: U128,
    pub data_id: Vec<u8>,
}

/// OutLayer's own argument types, field for field (out-layer/outlayer contract/src/lib.rs, read 2026-11-10), so a call the real contract would refuse
/// fails here too: on 2026-11-10 outlayer.testnet refused limits sent as strings ("invalid type: string"), which a mock taking `Value` had let through.
#[near(serializers = [json])]
pub struct ResourceLimits {
    pub max_instructions: Option<u64>,
    pub max_memory_mb: Option<u32>,
    pub max_execution_seconds: Option<u64>,
}

#[near(serializers = [json])]
pub struct SecretsReference {
    pub profile: String,
    pub account_id: AccountId,
}

#[near(serializers = [json])]
#[derive(PartialEq)]
pub enum ResponseFormat {
    Bytes,
    Text,
    Json,
}

/// OutLayer's ExecutionResponse, the fields Keyhole' path needs.
#[near(serializers = [json])]
pub struct ExecutionResponse {
    pub success: bool,
    /// `{"Json": <value>}`, `{"Text": "..."}` or `{"Bytes": [..]}`, as OutLayer's `ExecutionOutput`.
    pub output: Option<Value>,
    pub error: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockOutLayer {
    operator: AccountId,
    next_id: u64,
    requests: LookupMap<u64, Request>,
    open: Vec<u64>,
}

#[near]
impl MockOutLayer {
    #[init]
    pub fn new(operator: AccountId) -> Self {
        Self { operator, next_id: 0, requests: LookupMap::new(b"r"), open: vec![] }
    }

    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<ResourceLimits>,
        input_data: Option<String>,
        secrets_ref: Option<SecretsReference>,
        response_format: Option<ResponseFormat>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    ) {
        let _ = (resource_limits, secrets_ref, payer_account_id, params);
        let hash = source.get("WasmUrl").and_then(|w| w.get("hash")).and_then(|h| h.as_str()).unwrap_or_else(|| env::panic_str("this mock takes a WasmUrl source"));
        require!(hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()), "the hash is 64 lowercase hex, as OutLayer checks");
        require!(response_format == Some(ResponseFormat::Json), "this mock answers Json");
        require!(env::attached_deposit().as_yoctonear() >= 10_000_000_000_000_000_000_000, "attach at least 0.01 NEAR");
        let request_id = self.next_id;
        self.next_id += 1;
        let promise = env::promise_yield_create(
            "on_execution_response",
            &serde_json::to_vec(&json!({ "request_id": request_id })).unwrap(),
            RESPONSE_GAS,
            GasWeight(0),
            DATA_ID_REGISTER,
        );
        let data_id: CryptoHash = env::read_register(DATA_ID_REGISTER).expect("data id").try_into().expect("32 bytes");
        self.requests.insert(
            request_id,
            Request {
                request_id,
                sender_id: env::predecessor_account_id(),
                source: source.to_string(),
                input_data: input_data.unwrap_or_default(),
                payment: U128(env::attached_deposit().as_yoctonear()),
                data_id: data_id.to_vec(),
            },
        );
        self.open.push(request_id);
        env::promise_return(promise);
    }

    /// The worker's call. Resumes the caller's yield with `response`.
    pub fn resolve_execution(&mut self, request_id: u64, response: ExecutionResponse) {
        require!(env::predecessor_account_id() == self.operator, "only the operator (OutLayer's worker) resolves");
        let r = self.requests.get(&request_id).cloned().unwrap_or_else(|| env::panic_str("no such request"));
        let data_id: CryptoHash = r.data_id.try_into().unwrap();
        require!(env::promise_yield_resume(&data_id, &serde_json::to_vec(&response).unwrap()), "the yield already resolved or timed out");
    }

    /// Like OutLayer's: the caller receives the job's JSON, or null on failure or timeout.
    #[private]
    pub fn on_execution_response(&mut self, request_id: u64, #[callback_result] response: Result<ExecutionResponse, PromiseError>) {
        self.open.retain(|&i| i != request_id);
        self.requests.remove(&request_id);
        let out = match response {
            Ok(ExecutionResponse { success: true, output: Some(o), .. }) => o.get("Json").cloned().unwrap_or(Value::Null),
            _ => Value::Null,
        };
        env::value_return(&serde_json::to_vec(&out).unwrap());
    }

    /// Open requests, with their input, for whoever plays the worker.
    pub fn pending(&self) -> Vec<Request> {
        self.open.iter().filter_map(|i| self.requests.get(i).cloned()).collect()
    }
}
