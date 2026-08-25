// SABG arena program. On-chain layer: entry escrow, proof of participation, winner
// payout, result hash / badge. Live game logic stays off-chain.
//
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

pub mod error;
pub mod state;

use error::ArenaError;
use state::*;

declare_id!("84o7QQ3vkGkm3D6wfaqEHxFN93p3Q2b6SFtfazzxZuxH");

const MAX_BPS: u16 = 10_000;

#[program]
pub mod arena {
    use super::*;

    /// Create an arena with a fixed entry fee and a designated payout authority.
    pub fn init_arena(
        ctx: Context<InitArena>,
        arena_id: u64,
        entry_fee_lamports: u64,
        payout_authority: Pubkey,
        platform_fee_bps: u16,
    ) -> Result<()> {
        require!(entry_fee_lamports > 0, ArenaError::InvalidEntryFee);
        require!(platform_fee_bps <= MAX_BPS, ArenaError::InvalidPlatformFee);

        let arena = &mut ctx.accounts.arena;
        arena.authority = ctx.accounts.authority.key();
        arena.payout_authority = payout_authority;
        arena.arena_id = arena_id;
        arena.entry_fee_lamports = entry_fee_lamports;
        arena.prize_pool_lamports = 0;
        arena.platform_fee_bps = platform_fee_bps;
        arena.player_count = 0;
        arena.state = ArenaState::Open;
        arena.result_hash = [0u8; 32];
        arena.bump = ctx.bumps.arena;
        arena.escrow_bump = ctx.bumps.escrow;
        Ok(())
    }

    /// Buy an entry pass: move the fixed fee into escrow, register participation.
    /// The EntryPass PDA `init` rejects a second entry by the same player.
    pub fn buy_entry(ctx: Context<BuyEntry>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        require!(arena.state == ArenaState::Open, ArenaError::ArenaNotOpen);

        let fee = arena.entry_fee_lamports;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            fee,
        )?;

        arena.prize_pool_lamports = arena.prize_pool_lamports.saturating_add(fee);
        arena.player_count = arena.player_count.saturating_add(1);

        let pass = &mut ctx.accounts.entry_pass;
        pass.arena = arena.key();
        pass.player = ctx.accounts.player.key();
        pass.amount_lamports = fee;
        pass.refunded = false;
        pass.bump = ctx.bumps.entry_pass;
        Ok(())
    }

    /// Distribute the escrow to winner(s), passed as writable remaining accounts.
    /// Equal split with any remainder going to the first winner; runs once.
    pub fn settle_payout<'info>(
        ctx: Context<'_, '_, '_, 'info, SettlePayout<'info>>,
    ) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        require!(arena.state == ArenaState::Open, ArenaError::ArenaNotOpen);
        require_keys_eq!(
            ctx.accounts.payout_authority.key(),
            arena.payout_authority,
            ArenaError::Unauthorized,
        );

        let winners = ctx.remaining_accounts;
        require!(!winners.is_empty(), ArenaError::NoWinners);

        let escrow = ctx.accounts.escrow.to_account_info();
        for winner in winners {
            require_keys_neq!(winner.key(), escrow.key(), ArenaError::InvalidWinner);
        }
        let pool = escrow.lamports();
        let n = winners.len() as u64;
        let share = pool / n;
        let remainder = pool - share * n;

        let arena_key = arena.key();
        let escrow_seeds: &[&[u8]] = &[b"escrow", arena_key.as_ref(), &[arena.escrow_bump]];

        for (i, winner) in winners.iter().enumerate() {
            let amount = if i == 0 { share + remainder } else { share };
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: escrow.clone(),
                        to: winner.clone(),
                    },
                    &[escrow_seeds],
                ),
                amount,
            )?;
        }

        arena.prize_pool_lamports = 0;
        arena.state = ArenaState::Settled;
        Ok(())
    }

    /// Permanently close entry and enable deterministic per-EntryPass refunds.
    pub fn cancel_arena(ctx: Context<CancelArena>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        require!(arena.state == ArenaState::Open, ArenaError::ArenaNotOpen);
        require_keys_eq!(
            ctx.accounts.payout_authority.key(),
            arena.payout_authority,
            ArenaError::Unauthorized,
        );
        arena.state = ArenaState::Cancelled;
        Ok(())
    }

    /// Refund one entry from a cancelled arena. Anyone may submit; destination and amount are
    /// fixed by the program-owned EntryPass.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let pass = &mut ctx.accounts.entry_pass;
        require!(
            arena.state == ArenaState::Cancelled,
            ArenaError::NotCancelled
        );
        require!(!pass.refunded, ArenaError::AlreadyRefunded);

        let amount = pass.amount_lamports;
        let arena_key = arena.key();
        let escrow_seeds: &[&[u8]] = &[b"escrow", arena_key.as_ref(), &[arena.escrow_bump]];
        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.player.to_account_info(),
                },
                &[escrow_seeds],
            ),
            amount,
        )?;

        arena.prize_pool_lamports = arena
            .prize_pool_lamports
            .checked_sub(amount)
            .ok_or(ArenaError::AccountingUnderflow)?;
        arena.player_count = arena
            .player_count
            .checked_sub(1)
            .ok_or(ArenaError::AccountingUnderflow)?;
        pass.refunded = true;
        Ok(())
    }

    /// Record the final leaderboard hash on-chain after settlement, for verification.
    pub fn record_result(ctx: Context<RecordResult>, result_hash: [u8; 32]) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        require!(arena.state == ArenaState::Settled, ArenaError::NotSettled);
        require_keys_eq!(
            ctx.accounts.payout_authority.key(),
            arena.payout_authority,
            ArenaError::Unauthorized,
        );
        arena.result_hash = result_hash;
        Ok(())
    }

    /// Issue a proof-of-win badge to a winning wallet. The badge PDA `init` prevents
    /// awarding the same winner twice.
    pub fn award_badge(ctx: Context<AwardBadge>) -> Result<()> {
        require!(
            ctx.accounts.arena.state == ArenaState::Settled,
            ArenaError::NotSettled
        );
        require_keys_eq!(
            ctx.accounts.payout_authority.key(),
            ctx.accounts.arena.payout_authority,
            ArenaError::Unauthorized,
        );
        let badge = &mut ctx.accounts.badge;
        badge.arena = ctx.accounts.arena.key();
        badge.winner = ctx.accounts.winner.key();
        badge.bump = ctx.bumps.badge;
        Ok(())
    }
}

// --- Account contexts -------------------------------------------------------

#[derive(Accounts)]
#[instruction(arena_id: u64)]
pub struct InitArena<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Arena::INIT_SPACE,
        seeds = [b"arena", arena_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub arena: Account<'info, Arena>,

    /// CHECK: escrow PDA that holds pooled lamports; referenced here only to record its bump.
    #[account(seeds = [b"escrow", arena.key().as_ref()], bump)]
    pub escrow: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyEntry<'info> {
    #[account(mut, seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    #[account(
        init,
        payer = player,
        space = 8 + EntryPass::INIT_SPACE,
        seeds = [b"entry", arena.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub entry_pass: Account<'info, EntryPass>,

    /// CHECK: escrow PDA (system-owned) receiving the entry fee.
    #[account(mut, seeds = [b"escrow", arena.key().as_ref()], bump = arena.escrow_bump)]
    pub escrow: SystemAccount<'info>,

    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettlePayout<'info> {
    #[account(mut, seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    /// CHECK: escrow PDA (system-owned) that the pooled lamports are paid out from.
    #[account(mut, seeds = [b"escrow", arena.key().as_ref()], bump = arena.escrow_bump)]
    pub escrow: SystemAccount<'info>,

    pub payout_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelArena<'info> {
    #[account(mut, seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    pub payout_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut, seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    #[account(
        mut,
        seeds = [b"entry", arena.key().as_ref(), entry_pass.player.as_ref()],
        bump = entry_pass.bump,
        has_one = arena,
    )]
    pub entry_pass: Account<'info, EntryPass>,

    #[account(mut, seeds = [b"escrow", arena.key().as_ref()], bump = arena.escrow_bump)]
    pub escrow: SystemAccount<'info>,

    /// CHECK: refund destination is fixed by EntryPass; ownership is irrelevant for receiving lamports.
    #[account(mut, address = entry_pass.player)]
    pub player: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordResult<'info> {
    #[account(mut, seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    pub payout_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AwardBadge<'info> {
    #[account(seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,

    /// CHECK: the winning wallet the badge is issued to; only its address is stored.
    pub winner: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payout_authority,
        space = 8 + WinnerBadge::INIT_SPACE,
        seeds = [b"badge", arena.key().as_ref(), winner.key().as_ref()],
        bump,
    )]
    pub badge: Account<'info, WinnerBadge>,

    #[account(mut)]
    pub payout_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
