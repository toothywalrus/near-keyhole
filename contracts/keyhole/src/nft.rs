//! Window tokens as NEP-171: core (transfer, transfer_call, token), metadata (NEP-177), enumeration (NEP-181) and events (NEP-297).
//! Hand-rolled to keep the wasm small, adapted from our near-ghost-duels. No approvals: `approval_id` must be omitted.
//!
//! A token can only move while no keys exist: once delivered, the old holder would keep what he read, so the transfer is refused.
//! A plain transfer clears the one-time key, and the new holder registers his own with `set_wrap_key`.
use crate::sale::TokenState;
use crate::*;
use near_sdk::serde_json::json;
use near_sdk::{ext_contract, Gas, PromiseError, PromiseOrValue};
use std::collections::HashMap;

const GAS_ON_TRANSFER: Gas = Gas::from_tgas(25);
const GAS_RESOLVE: Gas = Gas::from_tgas(10);
/// What each token prepays at mint, for the storage its later life may need and no later caller pays for: the next holder's entry in `owned`, the credit entries
/// its settlement or dispute creates, a resale listing. So the contract's own balance never pays for anyone's storage.
pub const TOKEN_ALLOWANCE_BYTES: u64 = 500;
/// And for each epoch it covers, the row a refused delivery may have to create there.
pub const TOKEN_ALLOWANCE_PER_EPOCH: u64 = 150;

#[near(serializers = [json])]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: Option<TokenMetadata>,
    pub approved_account_ids: Option<HashMap<AccountId, u64>>,
}

#[ext_contract(ext_nft_receiver)]
#[allow(dead_code)]
trait NftReceiver {
    fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: String, msg: String) -> PromiseOrValue<bool>;
}

fn nep171(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({ "standard": "nep171", "version": "1.0.0", "event": event, "data": [data] })));
}

pub(crate) fn emit_mint(owner: &AccountId, id: u64) {
    nep171("nft_mint", json!({ "owner_id": owner, "token_ids": [id.to_string()] }));
}

pub(crate) fn nep171_transfer(from: &AccountId, to: &AccountId, id: u64) {
    nep171("nft_transfer", json!({ "old_owner_id": from, "new_owner_id": to, "token_ids": [id.to_string()] }));
}

fn parse_id(token_id: &str) -> u64 {
    token_id.parse::<u64>().unwrap_or_else(|_| env::panic_str("token ids are numbers"))
}

impl Keyhole {
    fn nep171_token(&self, id: u64) -> Option<Token> {
        let k = self.tokens.get(&id)?;
        let t = self.traders.get(k.trader)?;
        let title = format!("Window on {}: epochs {} to {}", t.handle, k.first_epoch, k.last_epoch);
        let description = format!("{} slots of {}'s journal, readable only with the nodes delivered to the holder's one-time key. State: {:?}.", k.last_slot - k.first_slot + 1, t.handle, k.state);
        Some(Token {
            token_id: id.to_string(),
            owner_id: k.owner.clone(),
            metadata: Some(TokenMetadata {
                title: Some(title),
                description: Some(description),
                media: None,
                media_hash: None,
                copies: Some(1),
                issued_at: Some(k.bought_ms.0.to_string()),
                expires_at: Some(self.epoch_start_ms(k.last_epoch + 1).to_string()),
                starts_at: Some(self.epoch_start_ms(k.first_epoch).to_string()),
                updated_at: None,
                extra: Some(json!({ "trader": t.account, "first_epoch": k.first_epoch, "last_epoch": k.last_epoch, "first_slot": k.first_slot, "last_slot": k.last_slot, "state": k.state, "price": k.price }).to_string()),
                reference: None,
                reference_hash: None,
            }),
            approved_account_ids: Some(HashMap::new()),
        })
    }

    fn transfer(&mut self, sender: &AccountId, receiver: &AccountId, token_id: &str, approval_id: Option<u64>, memo: Option<String>) -> AccountId {
        require!(approval_id.is_none(), "approvals aren't supported: the holder transfers");
        let id = parse_id(token_id);
        let mut k = self.token(id);
        require!(&k.owner == sender, "only the holder can transfer it");
        require!(&k.owner != receiver, "the receiver already holds it");
        require!(k.state == TokenState::Pending, "keys were already delivered: this window can't be resold");
        require!(self.resale_open(&k), "delivery can begin now: this window can't be resold");
        let prev = k.owner.clone();
        k.owner = receiver.clone();
        // The old holder's one-time key dies with the transfer.
        k.buyer_pub = None;
        k.resale_price = None;
        self.tokens.insert(id, k);
        self.disown(&prev, id);
        self.own(receiver, id);
        let mut data = json!({ "old_owner_id": prev, "new_owner_id": receiver, "token_ids": [token_id] });
        if let Some(m) = memo {
            data["memo"] = json!(m);
        }
        nep171("nft_transfer", data);
        prev
    }
}

#[near]
impl Keyhole {
    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        let before = env::storage_usage();
        self.transfer(&sender, &receiver_id, &token_id, approval_id, memo);
        self.flush_all();
        require!(env::storage_usage() <= before + TOKEN_ALLOWANCE_BYTES, "more storage than a transfer prepaid");
    }

    #[payable]
    pub fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        near_sdk::assert_one_yocto();
        require!(env::prepaid_gas().as_tgas() >= 50, "attach at least 50 Tgas");
        let sender = env::predecessor_account_id();
        let before = env::storage_usage();
        let prev = self.transfer(&sender, &receiver_id, &token_id, approval_id, memo);
        self.flush_all();
        require!(env::storage_usage() <= before + TOKEN_ALLOWANCE_BYTES, "more storage than a transfer prepaid");
        ext_nft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_ON_TRANSFER)
            .nft_on_transfer(sender, prev.clone(), token_id.clone(), msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RESOLVE).nft_resolve_transfer(prev, receiver_id, token_id, None))
            .into()
    }

    /// NEP-171: undo the transfer if the receiver asked for it back (returned true) or failed.
    #[private]
    pub fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: String, approved_account_ids: Option<HashMap<AccountId, u64>>, #[callback_result] give_back: Result<bool, PromiseError>) -> bool {
        let _ = approved_account_ids;
        if !give_back.unwrap_or(true) {
            return true;
        }
        let id = parse_id(&token_id);
        let mut k = self.token(id);
        if k.owner != receiver_id || k.state != TokenState::Pending {
            return true; // the receiver passed it on, or keys arrived meanwhile
        }
        k.owner = previous_owner_id.clone();
        k.buyer_pub = None;
        k.resale_price = None;
        self.tokens.insert(id, k);
        self.disown(&receiver_id, id);
        self.own(&previous_owner_id, id);
        nep171("nft_transfer", json!({ "old_owner_id": receiver_id, "new_owner_id": previous_owner_id, "token_ids": [token_id] }));
        false
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        self.nep171_token(parse_id(&token_id))
    }

    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata { spec: "nft-1.0.0".into(), name: "Keyhole windows".into(), symbol: "KEYHOLE".into(), icon: None, base_uri: None, reference: None, reference_hash: None }
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128((self.next_token - 1) as u128)
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.owned.get(&account_id).map(|v| v.len()).unwrap_or(0) as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|f| f.0 as u64).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from + 1..self.next_token).take(limit as usize).filter_map(|id| self.nep171_token(id)).collect()
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|f| f.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.owned.get(&account_id).map(|v| v.iter().skip(from).take(limit).filter_map(|id| self.nep171_token(*id)).collect()).unwrap_or_default()
    }
}
