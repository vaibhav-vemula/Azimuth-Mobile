import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createMint, createAssociatedTokenAccount, mintTo, getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { assert } from 'chai';

describe('azimuth_registry', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.azimuthRegistry as Program<any>;
  const authority = (provider.wallet as anchor.Wallet).payer;
  const MAX = new anchor.BN(50);

  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  let mint: PublicKey;
  let vault: PublicKey;

  const hash = (n: number) => Array.from({ length: 32 }, (_, i) => (i === 0 ? n : 7));
  const recordFor = (wallet: PublicKey, h: number[]) =>
    PublicKey.findProgramAddressSync([Buffer.from('report'), wallet.toBuffer(), Buffer.from(h)], program.programId)[0];

  const rewardAccounts = (wallet: PublicKey, h: number[], signer = authority.publicKey) => ({
    authority: signer,
    config,
    mint,
    vault,
    wallet,
    walletToken: getAssociatedTokenAddressSync(mint, wallet),
    record: recordFor(wallet, h),
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  });

  const expectFail = async (p: Promise<unknown>, needle: RegExp) => {
    try { await p; } catch (e: any) { assert.match(String(e), needle); return; }
    assert.fail('expected the call to fail');
  };

  before(async () => {
    mint = await createMint(provider.connection, authority, authority.publicKey, null, 0);
    vault = getAssociatedTokenAddressSync(mint, config, true);
    await program.methods.initialize(MAX).accounts({
      authority: authority.publicKey, config, mint, vault,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();
    await mintTo(provider.connection, authority, mint, vault, authority, 1000);
  });

  it('pays once, creates the token account, writes the record, and drops the vault by exactly the amount', async () => {
    const wallet = Keypair.generate().publicKey;
    const h = hash(1);
    const before = (await getAccount(provider.connection, vault)).amount;
    await program.methods.reward(h, 0, new anchor.BN(12)).accounts(rewardAccounts(wallet, h)).rpc();
    const got = await getAccount(provider.connection, getAssociatedTokenAddressSync(mint, wallet));
    assert.equal(got.amount, 12n);
    assert.equal(before - (await getAccount(provider.connection, vault)).amount, 12n);
    const rec = await program.account.reportRecord.fetch(recordFor(wallet, h));
    assert.equal(rec.wallet.toBase58(), wallet.toBase58());
    assert.equal(rec.amount.toNumber(), 12);
    assert.equal(rec.kind, 0);
  });

  it('refuses to pay the same wallet and hash twice', async () => {
    const wallet = Keypair.generate().publicKey;
    const h = hash(2);
    await program.methods.reward(h, 1, new anchor.BN(5)).accounts(rewardAccounts(wallet, h)).rpc();
    await expectFail(program.methods.reward(h, 1, new anchor.BN(5)).accounts(rewardAccounts(wallet, h)).rpc(), /already in use/);
    const bal = await getAccount(provider.connection, getAssociatedTokenAddressSync(mint, wallet));
    assert.equal(bal.amount, 5n);
  });

  it('refuses a signer that is not the authority', async () => {
    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(stranger.publicKey, 1e9));
    const wallet = Keypair.generate().publicKey;
    const h = hash(3);
    await expectFail(
      program.methods.reward(h, 0, new anchor.BN(1)).accounts(rewardAccounts(wallet, h, stranger.publicKey)).signers([stranger]).rpc(),
      /NotAuthority/
    );
  });

  it('refuses zero, over-cap and unknown kind', async () => {
    const wallet = Keypair.generate().publicKey;
    await expectFail(program.methods.reward(hash(4), 0, new anchor.BN(0)).accounts(rewardAccounts(wallet, hash(4))).rpc(), /ZeroAmount/);
    await expectFail(program.methods.reward(hash(5), 0, new anchor.BN(51)).accounts(rewardAccounts(wallet, hash(5))).rpc(), /OverCap/);
    await expectFail(program.methods.reward(hash(6), 9, new anchor.BN(1)).accounts(rewardAccounts(wallet, hash(6))).rpc(), /UnknownKind/);
  });

  it('refuses while paused and works again after unpausing', async () => {
    const wallet = Keypair.generate().publicKey;
    await program.methods.setPaused(true).accounts({ authority: authority.publicKey, config }).rpc();
    await expectFail(program.methods.reward(hash(7), 0, new anchor.BN(1)).accounts(rewardAccounts(wallet, hash(7))).rpc(), /Paused/);
    await program.methods.setPaused(false).accounts({ authority: authority.publicKey, config }).rpc();
    await program.methods.reward(hash(7), 0, new anchor.BN(1)).accounts(rewardAccounts(wallet, hash(7))).rpc();
  });

  it('lets the authority change the cap', async () => {
    await program.methods.setMaxReward(new anchor.BN(60)).accounts({ authority: authority.publicKey, config }).rpc();
    const wallet = Keypair.generate().publicKey;
    await program.methods.reward(hash(8), 0, new anchor.BN(55)).accounts(rewardAccounts(wallet, hash(8))).rpc();
    await program.methods.setMaxReward(MAX).accounts({ authority: authority.publicKey, config }).rpc();
  });

  it('rejects set_paused and set_max_reward from a non-authority', async () => {
    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(stranger.publicKey, 1e9));
    await expectFail(program.methods.setPaused(true).accounts({ authority: stranger.publicKey, config }).signers([stranger]).rpc(), /NotAuthority/);
    await expectFail(program.methods.setMaxReward(new anchor.BN(1000)).accounts({ authority: stranger.publicKey, config }).signers([stranger]).rpc(), /NotAuthority/);
  });

  it('accepts amount == max_reward and kind == 3', async () => {
    const wallet = Keypair.generate().publicKey;
    await program.methods.reward(hash(9), 3, MAX).accounts(rewardAccounts(wallet, hash(9))).rpc();
    const got = await getAccount(provider.connection, getAssociatedTokenAddressSync(mint, wallet));
    assert.equal(got.amount, 50n);
  });

  it('rejects a wrong vault', async () => {
    const wallet = Keypair.generate().publicKey;
    const other = Keypair.generate().publicKey;
    const wrongVault = await createAssociatedTokenAccount(provider.connection, authority, mint, other);
    await expectFail(
      program.methods.reward(hash(10), 0, new anchor.BN(1)).accounts({ ...rewardAccounts(wallet, hash(10)), vault: wrongVault }).rpc(),
      /caused by account: vault.*ConstraintTokenOwner/s
    );
  });
});
