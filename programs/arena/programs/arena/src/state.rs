// On-chain account state. Only funds/identity live here — not the live game state.

use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum ArenaState {
    Open,
    Settled,
    Cancelled,
    Settling,
}

#[account]
#[derive(InitSpace)]
pub struct Settlement {
    pub arena: Pubkey,
    pub funder: Pubkey,
    pub winner_count: u32,
    pub paid_count: u32,
    pub last_paid_key: Pubkey,
    pub share: u64,
    pub bump: u8,
}

#[event]
pub struct WinnerBatchPaid {
    pub arena: Pubkey,
    pub from: u32,
    pub count: u32,
}

#[event]
pub struct SettlementCompleted {
    pub arena: Pubkey,
    pub winner_count: u32,
    pub share: u64,
    pub treasury_lamports: u64,
}

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
    /// Platform fee in basis points, fixed at arena initialization.
    pub platform_fee_bps: u16,
    pub player_count: u32,
    /// Open until the authority settles winners or cancels for deterministic refunds.
    pub state: ArenaState,
    /// Hash of the final leaderboard, recorded after settlement (zeros until set).
    pub result_hash: [u8; 32],
    pub bump: u8,
    pub escrow_bump: u8,
}

/// Proof-of-win issued to a winning wallet.
#[account]
#[derive(InitSpace)]
pub struct WinnerBadge {
    pub arena: Pubkey,
    pub winner: Pubkey,
    pub bump: u8,
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
