import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { createMint, createAccount, mintTo, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { assert } from 'chai';

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.azimuthBounty as Program;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REWARD = 500_000; // 0.5 USDC (6 decimals)

async function airdrop(kp: Keypair) {
  const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig, 'confirmed');
}

async function expectFail(promise: Promise<unknown>, message: RegExp) {
  try {
    await promise;
  } catch (e) {
    assert.match(String(e), message);
    return;
  }
  assert.fail('expected the transaction to fail');
}

describe('azimuth_bounty', () => {
  const requester = Keypair.generate();
  const verifier = Keypair.generate();
  const node = Keypair.generate();
  const other = Keypair.generate();
  let mint: PublicKey;
  let requesterToken: PublicKey;
  let nodeToken: PublicKey;
  let otherToken: PublicKey;
  let nextId = 1;

  before(async () => {
    for (const kp of [requester, verifier, node, other]) await airdrop(kp);
    mint = await createMint(provider.connection, requester, requester.publicKey, null, 6);
    requesterToken = await createAccount(provider.connection, requester, mint, requester.publicKey);
    nodeToken = await createAccount(provider.connection, node, mint, node.publicKey);
    otherToken = await createAccount(provider.connection, other, mint, other.publicKey);
    await mintTo(provider.connection, requester, mint, requesterToken, requester, 100 * REWARD);
  });

  function addresses(id: number) {
    const idBn = new BN(id);
    const [bounty] = PublicKey.findProgramAddressSync([Buffer.from('bounty'), requester.publicKey.toBuffer(), idBn.toArrayLike(Buffer, 'le', 8)], program.programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), bounty.toBuffer()], program.programId);
    return { idBn, bounty, vault };
  }
  function claimPda(bounty: PublicKey, who: PublicKey) {
    return PublicKey.findProgramAddressSync([Buffer.from('claim'), bounty.toBuffer(), who.toBuffer()], program.programId)[0];
  }

  async function create(maxFills: number, expiresInSec: number) {
    const id = nextId++;
    const a = addresses(id);
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSec;
    await program.methods
      .createBounty(a.idBn, new BN(REWARD), maxFills, new BN(expiresAt), Array(32).fill(7))
      .accounts({
        requester: requester.publicKey,
        verifier: verifier.publicKey,
        mint,
        bounty: a.bounty,
        vault: a.vault,
        requesterToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([requester])
      .rpc();
    return a;
  }

  function settle(a: { bounty: PublicKey; vault: PublicKey }, who: Keypair, whoToken: PublicKey, signer: Keypair = verifier) {
    return program.methods
      .settleClaim(Array(32).fill(9))
      .accounts({
        verifier: signer.publicKey,
        bounty: a.bounty,
        mint,
        vault: a.vault,
        node: who.publicKey,
        nodeToken: whoToken,
        claim: claimPda(a.bounty, who.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([signer])
      .rpc();
  }

  it('escrows the full amount when a bounty is created', async () => {
    const a = await create(3, 3600);
    assert.equal(Number((await getAccount(provider.connection, a.vault)).amount), 3 * REWARD);
    const b: any = await program.account.bounty.fetch(a.bounty);
    assert.equal(b.fills, 0);
    assert.equal(b.maxFills, 3);
  });

  it('pays a node once, from escrow, on the verifier\'s attestation', async () => {
    const a = await create(2, 3600);
    await settle(a, node, nodeToken);
    assert.equal(Number((await getAccount(provider.connection, nodeToken)).amount), REWARD);
    assert.equal(Number((await getAccount(provider.connection, a.vault)).amount), REWARD);
    await expectFail(settle(a, node, nodeToken), /already in use|custom program error/);
  });

  it('refuses a settlement signed by anyone but the verifier', async () => {
    const a = await create(1, 3600);
    await expectFail(settle(a, other, otherToken, other), /NotVerifier|ConstraintAddress|2012|0x7dc|Error/);
    assert.equal(Number((await getAccount(provider.connection, otherToken)).amount), 0);
  });

  it('refuses to pay more fills than were funded', async () => {
    const a = await create(1, 3600);
    await settle(a, other, otherToken);
    await expectFail(settle(a, node, nodeToken), /Filled|custom program error/);
  });

  it('refuses a payout to a token account the node does not own', async () => {
    const a = await create(1, 3600);
    await expectFail(settle(a, node, otherToken), /ConstraintTokenOwner|custom program error|owner/i);
  });

  it('refuses settlement after expiry', async () => {
    const a = await create(1, 2);
    await sleep(3500);
    await expectFail(settle(a, node, nodeToken), /AlreadyExpired|custom program error/);
  });

  it('refunds the requester only after expiry plus grace', async () => {
    const a = await create(2, 2);
    const refund = () =>
      program.methods
        .refund()
        .accounts({ requester: requester.publicKey, bounty: a.bounty, mint, vault: a.vault, requesterToken, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([requester])
        .rpc();
    await expectFail(refund(), /TooEarlyToRefund|custom program error/);
    const before = Number((await getAccount(provider.connection, requesterToken)).amount);
    await sleep(4500);
    await refund();
    assert.equal(Number((await getAccount(provider.connection, requesterToken)).amount), before + 2 * REWARD);
    assert.isNull(await provider.connection.getAccountInfo(a.vault), 'vault is closed');
  });
});
