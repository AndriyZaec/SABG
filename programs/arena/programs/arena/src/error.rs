use anchor_lang::prelude::*;

#[error_code]
pub enum ArenaError {
    #[msg("Arena already settled")]
    AlreadySettled,
    #[msg("Player already entered this arena")]
    DoubleEntry,
    #[msg("Unauthorized payout authority")]
    Unauthorized,
    #[msg("Empty winner list")]
    NoWinners,
    #[msg("Entry fee must be greater than zero")]
    InvalidEntryFee,
    #[msg("Platform fee exceeds 100%")]
    InvalidPlatformFee,
}
