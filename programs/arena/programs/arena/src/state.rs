// On-chain account state (stubs). Mirror the relevant off-chain entities (spec §13)
// only for funds/identity/result — not the live game state.

use anchor_lang::prelude::*;

#[account]
pub struct Arena {
    pub authority: Pubkey,
    pub payout_authority: Pubkey,
    pub entry_fee_lamports: u64,
    pub prize_pool_lamports: u64,
    pub platform_fee_bps: u16,
    pub player_count: u32,
    pub settled: bool,
    pub bump: u8,
}

#[account]
pub struct EntryPass {
    pub arena: Pubkey,
    pub player: Pubkey,
    pub amount_lamports: u64,
    pub refunded: bool,
    pub bump: u8,
}
