use anchor_lang::prelude::*;

#[error_code]
pub enum ArenaError {
    #[msg("Arena already settled")]
    AlreadySettled,
    #[msg("Arena is not settled yet")]
    NotSettled,
    #[msg("Player already entered this arena")]
    DoubleEntry,
    #[msg("Unauthorized payout authority")]
    Unauthorized,
    #[msg("Empty winner list")]
    NoWinners,
    #[msg("Entry fee must be greater than zero")]
    InvalidEntryFee,
    #[msg("Platform fee must be 10%")]
    InvalidPlatformFee,
    #[msg("Arena is not open")]
    ArenaNotOpen,
    #[msg("Arena is not cancelled")]
    NotCancelled,
    #[msg("Entry pass was already refunded")]
    AlreadyRefunded,
    #[msg("Arena accounting underflow")]
    AccountingUnderflow,
    #[msg("Account cannot receive a winner payout")]
    InvalidWinner,
    #[msg("Arena accounting overflow")]
    AccountingOverflow,
    #[msg("Invalid platform treasury")]
    InvalidTreasury,
    #[msg("Winner count must be positive and at most the number of entries")]
    InvalidWinnerCount,
    #[msg("Arena is not settling")]
    NotSettling,
    #[msg("Requested payout cursor does not match the settlement")]
    StaleBatchCursor,
    #[msg("Batch size exceeds the remaining winners or the transaction limit")]
    InvalidBatchSize,
    #[msg("Winner keys must be strictly increasing")]
    WinnerOrder,
    #[msg("Escrow balance is less than the recorded pool")]
    InsufficientEscrow,
    #[msg("Each winner must receive at least one lamport")]
    ZeroWinnerShare,
    #[msg("Intermediate escrow balance is below the rent-exempt minimum")]
    EscrowRent,
    #[msg("Destination balance after payout would be below the rent-exempt minimum")]
    RecipientRent,
    #[msg("A settlement account is needed to cancel a settling arena")]
    MissingSettlement,
    #[msg("Cannot cancel after any winner has been paid")]
    PayoutStarted,
    #[msg("Cannot close a settlement for a nonterminal arena")]
    SettlementNotTerminal,
    #[msg("A share below the wallet rent minimum requires one atomic payout batch")]
    SmallShareRequiresSingleBatch,
}
