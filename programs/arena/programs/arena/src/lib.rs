// SABG arena program (C1–C3). On-chain layer per spec §12: entry escrow, proof of
// participation, winner payout, result hash / badge. Live game logic stays off-chain.
//
// Skeleton only — instructions declared with account contexts but no business logic yet
// (Phase 0 P0.5: "IDL builds"). Fill in per build plan C1/C2/C3.

use anchor_lang::prelude::*;

pub mod error;
pub mod state;

use state::*;

declare_id!("Arena111111111111111111111111111111111111111");

#[program]
pub mod arena {
    use super::*;

    /// C1 — create an arena PDA with a fixed entry fee (and optional platform fee, MVP 0%).
    pub fn init_arena(_ctx: Context<InitArena>, _entry_fee_lamports: u64) -> Result<()> {
        // TODO(C1): initialize Arena account, set authority, escrow PDA, fee.
        Ok(())
    }

    /// C1 — buy an entry pass: move fixed lamports into escrow, register participation.
    /// Double entry must be rejected.
    pub fn buy_entry(_ctx: Context<BuyEntry>) -> Result<()> {
        // TODO(C1): transfer entry fee -> escrow PDA, create EntryPass, guard double entry.
        Ok(())
    }

    /// C2 — distribute escrow to winner(s): winner-takes-all, or equal split on shared win
    /// (spec §7/§12). Backend payout authority (PDA-gated); must not run twice.
    pub fn settle_payout(_ctx: Context<SettlePayout>, _winners: Vec<Pubkey>) -> Result<()> {
        // TODO(C2): validate authority, split escrow, mark settled (idempotent).
        Ok(())
    }

    /// C1 (optional) — refund an entry if the arena is cancelled / underfilled.
    pub fn refund(_ctx: Context<Refund>) -> Result<()> {
        // TODO(C1 open item): return escrowed entry, mark EntryPass refunded.
        Ok(())
    }

    /// C3 — record final result hash (+ winner badge) on-chain for verification.
    pub fn record_result(_ctx: Context<RecordResult>, _result_hash: [u8; 32]) -> Result<()> {
        // TODO(C3): store leaderboard hash, issue winner badge (PDA / NFT).
        Ok(())
    }
}

// --- Account contexts (stubs; wire real constraints in C1–C3) ---------------

#[derive(Accounts)]
pub struct InitArena<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyEntry<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettlePayout<'info> {
    #[account(mut)]
    pub payout_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordResult<'info> {
    #[account(mut)]
    pub payout_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
