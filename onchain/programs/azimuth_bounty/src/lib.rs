//! Azimuth bounty escrow.
//!
//! A requester funds a bounty with `reward * max_fills` tokens (USDC in production). A single verifier key,
//! named when the bounty is created, attests that a node delivered a valid measurement, and the program pays
//! the node from the escrow. The program enforces money rules only; whether a measurement is genuine is decided
//! off-chain by the verifier (see docs/DEPIN_DESIGN.md), and this program makes that trust explicit: the
//! verifier can pay out, but it cannot take funds for itself, pay one node twice, exceed the funded fills,
//! or pay after expiry. The requester can only reclaim funds after a grace period, so a verified node cannot be
//! cut off by a requester who cancels at the last moment.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("GNDu67dFybZNrs8vs5XSDSQTmRnQqoKKoFUhuEuVH9fq");

/// How long after expiry the requester must wait before reclaiming what is left.
/// The `short-grace` feature exists only so the refund path can be exercised on a local validator.
pub const REFUND_GRACE_SECONDS: i64 = if cfg!(feature = "short-grace") { 1 } else { 24 * 60 * 60 };

#[program]
pub mod azimuth_bounty {
    use super::*;

    pub fn create_bounty(
        ctx: Context<CreateBounty>,
        id: u64,
        reward: u64,
        max_fills: u16,
        expires_at: i64,
        spec_hash: [u8; 32],
    ) -> Result<()> {
        require!(reward > 0, BountyError::ZeroReward);
        require!(max_fills > 0, BountyError::ZeroFills);
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, BountyError::AlreadyExpired);

        let total = reward
            .checked_mul(max_fills as u64)
            .ok_or(BountyError::Overflow)?;

        let bounty = &mut ctx.accounts.bounty;
        bounty.requester = ctx.accounts.requester.key();
        bounty.verifier = ctx.accounts.verifier.key();
        bounty.mint = ctx.accounts.mint.key();
        bounty.id = id;
        bounty.reward = reward;
        bounty.max_fills = max_fills;
        bounty.fills = 0;
        bounty.expires_at = expires_at;
        bounty.spec_hash = spec_hash;
        bounty.refunded = false;
        bounty.bump = ctx.bumps.bounty;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.requester_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.requester.to_account_info(),
                },
            ),
            total,
            ctx.accounts.mint.decimals,
        )?;

        emit!(BountyCreated {
            bounty: bounty.key(),
            requester: bounty.requester,
            reward,
            max_fills,
            expires_at,
            spec_hash,
        });
        Ok(())
    }

    /// Pays one node for one verified report. The claim account makes a second payment to the same node
    /// impossible: creating it fails if it already exists.
    pub fn settle_claim(ctx: Context<SettleClaim>, report_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let bounty = &mut ctx.accounts.bounty;
        require!(!bounty.refunded, BountyError::Refunded);
        require!(now < bounty.expires_at, BountyError::AlreadyExpired);
        require!(bounty.fills < bounty.max_fills, BountyError::Filled);

        bounty.fills += 1;

        let claim = &mut ctx.accounts.claim;
        claim.bounty = bounty.key();
        claim.node = ctx.accounts.node.key();
        claim.report_hash = report_hash;
        claim.settled_at = now;

        let requester = bounty.requester;
        let id_bytes = bounty.id.to_le_bytes();
        let bump = [bounty.bump];
        let seeds: &[&[u8]] = &[b"bounty", requester.as_ref(), &id_bytes, &bump];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.node_token.to_account_info(),
                    authority: ctx.accounts.bounty.to_account_info(),
                },
                &[seeds],
            ),
            ctx.accounts.bounty.reward,
            ctx.accounts.mint.decimals,
        )?;

        emit!(ClaimSettled {
            bounty: ctx.accounts.bounty.key(),
            node: ctx.accounts.node.key(),
            report_hash,
            amount: ctx.accounts.bounty.reward,
        });
        Ok(())
    }

    /// Returns what is left to the requester, once the bounty has expired and the grace period has passed.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let bounty = &mut ctx.accounts.bounty;
        require!(!bounty.refunded, BountyError::Refunded);
        require!(
            now >= bounty
                .expires_at
                .checked_add(REFUND_GRACE_SECONDS)
                .ok_or(BountyError::Overflow)?,
            BountyError::TooEarlyToRefund
        );
        bounty.refunded = true;

        let requester = bounty.requester;
        let id_bytes = bounty.id.to_le_bytes();
        let bump = [bounty.bump];
        let seeds: &[&[u8]] = &[b"bounty", requester.as_ref(), &id_bytes, &bump];

        let remaining = ctx.accounts.vault.amount;
        if remaining > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.requester_token.to_account_info(),
                        authority: ctx.accounts.bounty.to_account_info(),
                    },
                    &[seeds],
                ),
                remaining,
                ctx.accounts.mint.decimals,
            )?;
        }

        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.requester.to_account_info(),
                authority: ctx.accounts.bounty.to_account_info(),
            },
            &[seeds],
        ))?;

        emit!(BountyRefunded { bounty: ctx.accounts.bounty.key(), amount: remaining });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateBounty<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    /// CHECK: only its public key is stored; it is the key allowed to settle claims.
    pub verifier: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = requester,
        space = 8 + Bounty::INIT_SPACE,
        seeds = [b"bounty", requester.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub bounty: Account<'info, Bounty>,
    #[account(
        init,
        payer = requester,
        seeds = [b"vault", bounty.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = bounty,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = requester,
        token::token_program = token_program
    )]
    pub requester_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleClaim<'info> {
    #[account(mut, address = bounty.verifier @ BountyError::NotVerifier)]
    pub verifier: Signer<'info>,
    #[account(
        mut,
        seeds = [b"bounty", bounty.requester.as_ref(), &bounty.id.to_le_bytes()],
        bump = bounty.bump,
        has_one = mint
    )]
    pub bounty: Account<'info, Bounty>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = bounty,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: the node's wallet; used only as the claim key and to check the destination token account.
    pub node: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = node,
        token::token_program = token_program
    )]
    pub node_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = verifier,
        space = 8 + Claim::INIT_SPACE,
        seeds = [b"claim", bounty.key().as_ref(), node.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, Claim>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut, address = bounty.requester @ BountyError::NotRequester)]
    pub requester: Signer<'info>,
    #[account(
        mut,
        seeds = [b"bounty", bounty.requester.as_ref(), &bounty.id.to_le_bytes()],
        bump = bounty.bump,
        has_one = mint
    )]
    pub bounty: Account<'info, Bounty>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = bounty,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = requester,
        token::token_program = token_program
    )]
    pub requester_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub requester: Pubkey,
    pub verifier: Pubkey,
    pub mint: Pubkey,
    pub id: u64,
    pub reward: u64,
    pub max_fills: u16,
    pub fills: u16,
    pub expires_at: i64,
    /// Hash of the off-chain bounty specification (place, measurement, rules).
    pub spec_hash: [u8; 32],
    pub refunded: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub bounty: Pubkey,
    pub node: Pubkey,
    pub report_hash: [u8; 32],
    pub settled_at: i64,
}

#[event]
pub struct BountyCreated {
    pub bounty: Pubkey,
    pub requester: Pubkey,
    pub reward: u64,
    pub max_fills: u16,
    pub expires_at: i64,
    pub spec_hash: [u8; 32],
}

#[event]
pub struct ClaimSettled {
    pub bounty: Pubkey,
    pub node: Pubkey,
    pub report_hash: [u8; 32],
    pub amount: u64,
}

#[event]
pub struct BountyRefunded {
    pub bounty: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum BountyError {
    #[msg("Reward must be greater than zero")]
    ZeroReward,
    #[msg("A bounty needs at least one fill")]
    ZeroFills,
    #[msg("The bounty has expired")]
    AlreadyExpired,
    #[msg("All fills have been paid")]
    Filled,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Only the bounty's verifier can settle claims")]
    NotVerifier,
    #[msg("Only the requester can refund")]
    NotRequester,
    #[msg("The refund grace period has not passed yet")]
    TooEarlyToRefund,
    #[msg("This bounty was already refunded")]
    Refunded,
}
