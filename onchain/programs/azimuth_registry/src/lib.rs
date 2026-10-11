use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("AJtmjGMQPjPUF5zscYXdMqvMXgRYZHeWHgNijAEae9Zh");

/// Highest valid report kind (kinds are 0..=3).
const KIND_MAX: u8 = 3;

#[program]
pub mod azimuth_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, max_reward: u64) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.mint = ctx.accounts.mint.key();
        c.max_reward = max_reward;
        c.paused = false;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn reward(ctx: Context<Reward>, report_hash: [u8; 32], kind: u8, amount: u64) -> Result<()> {
        let c = &ctx.accounts.config;
        require!(!c.paused, RegistryError::Paused);
        require!(amount > 0, RegistryError::ZeroAmount);
        require!(amount <= c.max_reward, RegistryError::OverCap);
        require!(kind <= KIND_MAX, RegistryError::UnknownKind);

        let rec = &mut ctx.accounts.record;
        rec.wallet = ctx.accounts.wallet.key();
        rec.report_hash = report_hash;
        rec.kind = kind;
        rec.amount = amount;
        rec.rewarded_at = Clock::get()?.unix_timestamp;
        rec.bump = ctx.bumps.record;

        let seeds: &[&[u8]] = &[b"config", &[c.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.wallet_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(Rewarded { wallet: rec.wallet, report_hash, kind, amount });
        Ok(())
    }

    pub fn set_paused(ctx: Context<Admin>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    pub fn set_max_reward(ctx: Context<Admin>, max_reward: u64) -> Result<()> {
        ctx.accounts.config.max_reward = max_reward;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed, payer = authority,
        associated_token::mint = mint, associated_token::authority = config, associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(report_hash: [u8; 32])]
pub struct Reward<'info> {
    #[account(mut, address = config.authority @ RegistryError::NotAuthority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint, associated_token::authority = config, associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: only used as the owner of the token account and in the record seeds.
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init_if_needed, payer = authority,
        associated_token::mint = mint, associated_token::authority = wallet, associated_token::token_program = token_program
    )]
    pub wallet_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init, payer = authority, space = 8 + ReportRecord::INIT_SPACE,
        seeds = [b"report", wallet.key().as_ref(), report_hash.as_ref()], bump
    )]
    pub record: Account<'info, ReportRecord>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(address = config.authority @ RegistryError::NotAuthority)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub mint: Pubkey,
    /// Per-report cap in whole tokens: the AZMTest mint has 0 decimals.
    pub max_reward: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ReportRecord {
    pub wallet: Pubkey,
    pub report_hash: [u8; 32],
    pub kind: u8,
    pub amount: u64,
    pub rewarded_at: i64,
    pub bump: u8,
}

#[event]
pub struct Rewarded {
    pub wallet: Pubkey,
    pub report_hash: [u8; 32],
    pub kind: u8,
    pub amount: u64,
}

#[error_code]
pub enum RegistryError {
    #[msg("Only the authority can do this")]
    NotAuthority,
    #[msg("Rewards are paused")]
    Paused,
    #[msg("Amount must be above zero")]
    ZeroAmount,
    #[msg("Amount is above the per-report cap")]
    OverCap,
    #[msg("Unknown report kind")]
    UnknownKind,
}
