//! TEST TOKEN, no value. A NEP-141 mock stablecoin with 6 decimals, standing in for USDC so the
//! Intents sandbox runs for free. Anyone can mint up to 1,000,000 units of it at a time to
//! themselves. Its name and symbol say it is a test token, so it can't be taken for a real one.
//! (Copied from near-crop-cover, which adapted it from near-account-nfts.)
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

pub const DECIMALS: u8 = 6;
/// 1,000,000 tUSD per mint call.
pub const MAX_MINT: u128 = 1_000_000 * 10u128.pow(DECIMALS as u32);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestToken {
    token: FungibleToken,
}

#[near]
impl TestToken {
    #[init]
    #[private]
    pub fn new() -> Self {
        Self { token: FungibleToken::new(StorageKey::Token) }
    }

    /// Mint up to 1,000,000 tUSD (in units of 10^-6) to yourself. If you aren't registered yet,
    /// attach `storage_balance_bounds().min` and you will be.
    #[payable]
    pub fn mint(&mut self, amount: U128) {
        require!(amount.0 > 0 && amount.0 <= MAX_MINT, "Mint 1 unit to 1,000,000 tUSD at a time");
        let who = env::predecessor_account_id();
        let mut refund = env::attached_deposit();
        if !self.token.accounts.contains_key(&who) {
            let min = self.token.storage_balance_bounds().min;
            require!(refund >= min, format!("Attach {min} to register"));
            self.token.internal_register_account(&who);
            refund = refund.saturating_sub(min);
        }
        self.token.internal_deposit(&who, amount.0);
        FtMint { owner_id: &who, amount, memo: Some("TEST TOKEN, no value") }.emit();
        if !refund.is_zero() {
            let _ = near_sdk::Promise::new(who).transfer(refund);
        }
    }
}

#[near]
impl FungibleTokenCore for TestToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestToken {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for TestToken {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Circle Test USD (TEST TOKEN, no value)".into(),
            symbol: "tUSD-TEST".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}
