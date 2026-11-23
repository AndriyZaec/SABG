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
const PLATFORM_FEE_BPS: u16 = 1_000;
const MAX_WINNERS_PER_BATCH: u32 = 20;
const DEVNET_TREASURY: Pubkey = pubkey!("nvy4VWVymKZpYZEBtwNYUzJzG9R11P7Wc7khvenMpzW");

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
        require!(
            platform_fee_bps == PLATFORM_FEE_BPS,
            ArenaError::InvalidPlatformFee
        );

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

    /// Freeze the recorded pool and fix the equal share. The authority chooses recipients.
    pub fn start_settlement(ctx: Context<StartSettlement>, winner_count: u32) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        require!(arena.state == ArenaState::Open, ArenaError::ArenaNotOpen);
        require!(
            winner_count > 0 && winner_count <= arena.player_count,
            ArenaError::InvalidWinnerCount
        );
        let gross_pool = arena.prize_pool_lamports;
        let escrow_balance = ctx.accounts.escrow.get_lamports();
        require!(escrow_balance >= gross_pool, ArenaError::InsufficientEscrow);
        let fee_numerator = u128::from(gross_pool)
            .checked_mul(u128::from(arena.platform_fee_bps))
            .ok_or(ArenaError::AccountingOverflow)?;
        let platform_fee = u64::try_from(fee_numerator / u128::from(MAX_BPS))
            .map_err(|_| ArenaError::AccountingOverflow)?;
        let winner_pool = gross_pool
            .checked_sub(platform_fee)
            .ok_or(ArenaError::AccountingUnderflow)?;
        let share = winner_pool / u64::from(winner_count);
        require!(share > 0, ArenaError::ZeroWinnerShare);

        // Multi-transaction payouts must be able to fund every empty system wallet.
        // Smaller shares can still be sent to eligible wallets in one atomic batch.
        let rent = Rent::get()?;
        require!(
            share >= rent.minimum_balance(0) || winner_count <= MAX_WINNERS_PER_BATCH,
            ArenaError::SmallShareRequiresSingleBatch
        );
        let treasury_amount = escrow_balance
            .checked_sub(payout_total(share, winner_count)?)
            .ok_or(ArenaError::InsufficientEscrow)?;
        validate_credit(
            &ctx.accounts.treasury.to_account_info(),
            treasury_amount,
            &rent,
        )?;

        let settlement = &mut ctx.accounts.settlement;
        settlement.arena = arena.key();
        settlement.funder = ctx.accounts.payout_authority.key();
        settlement.winner_count = winner_count;
        settlement.paid_count = 0;
        settlement.last_paid_key = Pubkey::default();
        settlement.share = share;
        settlement.bump = ctx.bumps.settlement;
        arena.state = ArenaState::Settling;
        Ok(())
    }

    /// Pay a bounded slice of recipients in strictly increasing raw pubkey order.
    pub fn pay_batch<'info>(
        ctx: Context<'_, '_, '_, 'info, PayBatch<'info>>,
        expected_paid: u32,
    ) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let settlement = &mut ctx.accounts.settlement;
        require!(arena.state == ArenaState::Settling, ArenaError::NotSettling);
        require_eq!(
            settlement.paid_count,
            expected_paid,
            ArenaError::StaleBatchCursor
        );
        let count = u32::try_from(ctx.remaining_accounts.len())
            .map_err(|_| ArenaError::InvalidBatchSize)?;
        let remaining = settlement
            .winner_count
            .checked_sub(expected_paid)
            .ok_or(ArenaError::AccountingUnderflow)?;
        require!(
            count > 0 && count <= remaining && count <= MAX_WINNERS_PER_BATCH,
            ArenaError::InvalidBatchSize
        );
        let final_batch = count == remaining;
        let arena_key = arena.key();
        let escrow = ctx.accounts.escrow.to_account_info();
        let treasury = ctx.accounts.treasury.to_account_info();
        let rent = Rent::get()?;
        let can_skip = settlement.share >= rent.minimum_balance(0);
        require!(
            final_batch || can_skip,
            ArenaError::SmallShareRequiresSingleBatch
        );

        let reserved = [
            arena_key,
            escrow.key(),
            settlement.key(),
            treasury.key(),
            *ctx.program_id,
            ctx.accounts.system_program.key(),
        ];
        let mut last = settlement.last_paid_key;
        let mut creditable = [false; MAX_WINNERS_PER_BATCH as usize];
        let mut transfers = 0;
        for (winner, creditable) in ctx.remaining_accounts.iter().zip(creditable.iter_mut()) {
            let key = winner.key();
            require!(
                winner.is_writable && !reserved.contains(&key),
                ArenaError::InvalidWinner
            );
            require!(key.to_bytes() > last.to_bytes(), ArenaError::WinnerOrder);
            *creditable = can_credit(winner, settlement.share, &rent);
            if *creditable {
                transfers += 1;
            } else {
                require!(can_skip, ArenaError::RecipientRent);
            }
            last = key;
        }

        let residual = escrow
            .lamports()
            .checked_sub(payout_total(settlement.share, transfers)?)
            .ok_or(ArenaError::InsufficientEscrow)?;
        if final_batch {
            validate_credit(&treasury, residual, &rent)?;
        } else {
            require!(residual >= rent.minimum_balance(0), ArenaError::EscrowRent);
        }

        let escrow_seeds: &[&[u8]] = &[b"escrow", arena_key.as_ref(), &[arena.escrow_bump]];
        let send = |to: AccountInfo<'info>, amount| {
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: escrow.clone(),
                        to,
                    },
                    &[escrow_seeds],
                ),
                amount,
            )
        };
        for (index, (winner, creditable)) in
            ctx.remaining_accounts.iter().zip(creditable).enumerate()
        {
            if creditable {
                send(winner.clone(), settlement.share)?;
            } else {
                emit!(WinnerSkipped {
                    arena: arena_key,
                    index: expected_paid + index as u32,
                    winner: winner.key(),
                });
            }
        }

        settlement.paid_count = expected_paid + count;
        settlement.last_paid_key = last;
        emit!(WinnerBatchPaid {
            arena: arena_key,
            from: expected_paid,
            count
        });
        if final_batch {
            if residual > 0 {
                send(treasury, residual)?;
            }
            arena.prize_pool_lamports = 0;
            arena.state = ArenaState::Settled;
            emit!(SettlementCompleted {
                arena: arena_key,
                winner_count: settlement.winner_count,
                share: settlement.share,
                treasury_lamports: residual,
            });
        }
        Ok(())
    }

    /// Reclaim the rent deposit after the backend has reconciled the terminal result.
    pub fn close_settlement(ctx: Context<CloseSettlement>) -> Result<()> {
        require!(
            matches!(
                ctx.accounts.arena.state,
                ArenaState::Settled | ArenaState::Cancelled
            ),
            ArenaError::SettlementNotTerminal
        );
        Ok(())
    }

    /// Permanently close entry and enable deterministic per-EntryPass refunds.
    pub fn cancel_arena(ctx: Context<CancelArena>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        require_keys_eq!(
            ctx.accounts.payout_authority.key(),
            arena.payout_authority,
            ArenaError::Unauthorized,
        );
        match arena.state {
            ArenaState::Open => {}
            ArenaState::Settling => {
                let settlement = ctx
                    .accounts
                    .settlement
                    .as_ref()
                    .ok_or(ArenaError::MissingSettlement)?;
                require_eq!(settlement.paid_count, 0, ArenaError::PayoutStarted);
            }
            _ => return err!(ArenaError::ArenaNotOpen),
        }
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

fn payout_total(share: u64, count: u32) -> Result<u64> {
    share
        .checked_mul(u64::from(count))
        .ok_or_else(|| error!(ArenaError::AccountingOverflow))
}

fn validate_credit(account: &AccountInfo, amount: u64, rent: &Rent) -> Result<()> {
    if amount > 0 {
        let balance = account
            .lamports()
            .checked_add(amount)
            .ok_or(ArenaError::AccountingOverflow)?;
        require!(
            rent.is_exempt(balance, account.data_len()),
            ArenaError::RecipientRent
        );
    }
    Ok(())
}

fn can_credit(account: &AccountInfo, amount: u64, rent: &Rent) -> bool {
    !account.executable
        && account
            .lamports()
            .checked_add(amount)
            .is_some_and(|balance| rent.is_exempt(balance, account.data_len()))
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
pub struct StartSettlement<'info> {
    #[account(mut, seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump, has_one = payout_authority @ ArenaError::Unauthorized)]
    pub arena: Account<'info, Arena>,

    #[account(seeds = [b"escrow", arena.key().as_ref()], bump = arena.escrow_bump)]
    pub escrow: SystemAccount<'info>,

    #[account(address = DEVNET_TREASURY @ ArenaError::InvalidTreasury)]
    pub treasury: SystemAccount<'info>,

    #[account(init, payer = payout_authority, space = 8 + Settlement::INIT_SPACE, seeds = [b"settlement", arena.key().as_ref()], bump)]
    pub settlement: Account<'info, Settlement>,

    #[account(mut)]
    pub payout_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayBatch<'info> {
    #[account(mut, seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump, has_one = payout_authority @ ArenaError::Unauthorized)]
    pub arena: Account<'info, Arena>,

    #[account(mut, seeds = [b"escrow", arena.key().as_ref()], bump = arena.escrow_bump)]
    pub escrow: SystemAccount<'info>,

    #[account(mut, seeds = [b"settlement", arena.key().as_ref()], bump = settlement.bump, has_one = arena)]
    pub settlement: Account<'info, Settlement>,

    #[account(mut, address = DEVNET_TREASURY @ ArenaError::InvalidTreasury)]
    pub treasury: SystemAccount<'info>,

    pub payout_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseSettlement<'info> {
    #[account(seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump, has_one = payout_authority @ ArenaError::Unauthorized)]
    pub arena: Account<'info, Arena>,

    #[account(mut, close = funder, seeds = [b"settlement", arena.key().as_ref()], bump = settlement.bump, has_one = arena, has_one = funder)]
    pub settlement: Account<'info, Settlement>,

    /// CHECK: the settlement records this address as its rent payer.
    #[account(mut)]
    pub funder: UncheckedAccount<'info>,
    pub payout_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelArena<'info> {
    #[account(mut, seeds = [b"arena", arena.arena_id.to_le_bytes().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    pub payout_authority: Signer<'info>,

    #[account(seeds = [b"settlement", arena.key().as_ref()], bump = settlement.bump, has_one = arena)]
    pub settlement: Option<Account<'info, Settlement>>,
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
