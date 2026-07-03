// On-chain account state. Only funds/identity live here — not the live game state.

use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Arena {
    /// Creator; may init the arena.
    pub authority: Pubkey,
    /// Key allowed to trigger payout (backend payout service).
    pub payout_authority: Pubkey,
    /// Off-chain arena identifier, also part of the PDA seed.
    pub arena_id: u64,
    /// Fixed entry fee each player pays into escrow.
    pub entry_fee_lamports: u64,
    /// Running total held in escrow.
    pub prize_pool_lamports: u64,
    /// Optional platform fee in basis points (0 for MVP).
    pub platform_fee_bps: u16,
    pub player_count: u32,
    /// Set once payout has run; blocks further entries/payouts.
    pub settled: bool,
    pub bump: u8,
    pub escrow_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EntryPass {
    pub arena: Pubkey,
    pub player: Pubkey,
    pub amount_lamports: u64,
    pub refunded: bool,
    pub bump: u8,
}
