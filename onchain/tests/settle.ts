import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { createMint, createAccount, mintTo, getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { assert } from 'chai';
import { settlePending, hexToBytes32 } from '../scripts/settle';

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.azimuthBounty as Program;

describe('settle script', () => {
  const requester = Keypair.generate();
  const verifier = Keypair.generate();
  const node = Keypair.generate();
  let mint: PublicKey;
  let bounty: PublicKey;

  before(async () => {
    for (const kp of [requester, verifier]) {
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed');
    }
    mint = await createMint(provider.connection, requester, requester.publicKey, null, 6);
    const requesterToken = await createAccount(provider.connection, requester, mint, requester.publicKey);
    await mintTo(provider.connection, requester, mint, requesterToken, requester, 10_000_000);

    const id = new BN(77);
    [bounty] = PublicKey.findProgramAddressSync([Buffer.from('bounty'), requester.publicKey.toBuffer(), id.toArrayLike(Buffer, 'le', 8)], program.programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), bounty.toBuffer()], program.programId);
    await program.methods
      .createBounty(id, new BN(1_000_000), 2, new BN(Math.floor(Date.now() / 1000) + 3600), Array(32).fill(1))
      .accounts({ requester: requester.publicKey, verifier: verifier.publicKey, mint, bounty, vault, requesterToken, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .signers([requester])
      .rpc();
  });

  it('pays pending claims, creating the node token account, and records the transaction', async () => {
    const reportHash = 'ab'.repeat(32);
    const recorded: Record<number, string> = {};
    const outcomes = await settlePending({
      program,
      connection: provider.connection,
      verifier,
      pending: [{ ledgerId: 5, node: node.publicKey.toBase58(), onchainBounty: bounty.toBase58(), reportHash, amountUsdc: 1 }],
      markDone: async (id, tx) => { recorded[id] = tx; },
    });
    assert.isTrue(outcomes[0].ok, outcomes[0].error);
    assert.equal(recorded[5], outcomes[0].tx);
    const ata = getAssociatedTokenAddressSync(mint, node.publicKey);
    assert.equal(Number((await getAccount(provider.connection, ata)).amount), 1_000_000);
  });

  it('does not pay the same node twice and reports the failure', async () => {
    const outcomes = await settlePending({
      program,
      connection: provider.connection,
      verifier,
      pending: [{ ledgerId: 6, node: node.publicKey.toBase58(), onchainBounty: bounty.toBase58(), reportHash: 'cd'.repeat(32), amountUsdc: 1 }],
      markDone: async () => { throw new Error('should not be recorded'); },
    });
    assert.isFalse(outcomes[0].ok);
  });

  it('rejects malformed report hashes', () => {
    assert.throws(() => hexToBytes32('xyz'));
    assert.lengthOf(hexToBytes32('00'.repeat(32)), 32);
  });
});
