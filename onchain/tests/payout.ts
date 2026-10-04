import * as anchor from '@coral-xyz/anchor';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createMint, createAssociatedTokenAccount, getAccount, getAssociatedTokenAddressSync, mintTo } from '@solana/spl-token';
import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ApprovedReward, groupRewards, payWeekly } from '../scripts/payout';

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

describe('weekly payout', () => {
  const treasury = Keypair.generate();
  const a = Keypair.generate();
  const b = Keypair.generate();
  let mint: PublicKey;
  let journal: string;

  const balanceOf = async (owner: PublicKey) => {
    try {
      return Number((await getAccount(provider.connection, getAssociatedTokenAddressSync(mint, owner))).amount);
    } catch {
      return 0;
    }
  };

  before(async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(treasury.publicKey, 5 * LAMPORTS_PER_SOL), 'confirmed');
    mint = await createMint(provider.connection, treasury, treasury.publicKey, null, 6);
    const ata = await createAssociatedTokenAccount(provider.connection, treasury, mint, treasury.publicKey);
    await mintTo(provider.connection, treasury, mint, ata, treasury, 10_000_000); // 10 tokens
  });

  beforeEach(() => {
    journal = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'azm-')), 'payouts.jsonl');
  });

  const rows = (): ApprovedReward[] => [
    { id: 'r1', node: a.publicKey.toBase58(), amount_usdc: '0.5' },
    { id: 'r2', node: a.publicKey.toBase58(), amount_usdc: 0.001 },
    { id: 'r3', node: b.publicKey.toBase58(), amount_usdc: 1 },
  ];

  /** A stand-in for the review queue that only returns what has not been marked paid. */
  function queue(initial: ApprovedReward[]) {
    const paid = new Map<string, string>();
    return {
      paid,
      listApproved: async () => initial.filter((r) => !paid.has(r.id)),
      markPaid: async (ids: string[], tx: string) => { ids.forEach((id) => paid.set(id, tx)); },
    };
  }

  it('adds up rewards per wallet in whole base units', () => {
    const lines = groupRewards([...rows(), { id: 'bad', node: 'x', amount_usdc: 0 }, { id: 'nan', node: 'x', amount_usdc: 'oops' }], 6);
    assert.deepEqual(lines.map((l) => [l.node, l.amount, l.rewardIds.length]), [
      [a.publicKey.toBase58(), 0.501, 2],
      [b.publicKey.toBase58(), 1, 1],
    ]);
  });

  it('a dry run shows the plan and sends nothing', async () => {
    const q = queue(rows());
    const out = await payWeekly({ connection: provider.connection, treasury, mint, ...q, journalPath: journal, maxTotal: 100, dryRun: true });
    assert.equal(out.lines.length, 2);
    assert.closeTo(out.total, 1.501, 1e-9);
    assert.lengthOf(out.transactions, 0);
    assert.equal(await balanceOf(a.publicKey), 0);
    assert.equal(q.paid.size, 0);
  });

  it('refuses to pay more than the limit or more than the treasury holds', async () => {
    const q = queue(rows());
    let failed = '';
    try { await payWeekly({ connection: provider.connection, treasury, mint, ...q, journalPath: journal, maxTotal: 1 }); } catch (e) { failed = String(e); }
    assert.match(failed, /limit/);
    const big = queue([{ id: 'big', node: a.publicKey.toBase58(), amount_usdc: 50 }]);
    failed = '';
    try { await payWeekly({ connection: provider.connection, treasury, mint, ...big, journalPath: journal, maxTotal: 1000 }); } catch (e) { failed = String(e); }
    assert.match(failed, /Treasury holds/);
    assert.equal(await balanceOf(a.publicKey), 0);
  });

  it('pays each wallet once, creates their token account, and marks the rewards paid', async () => {
    const q = queue(rows());
    const out = await payWeekly({ connection: provider.connection, treasury, mint, ...q, journalPath: journal, maxTotal: 100 });
    assert.lengthOf(out.transactions, 1);
    assert.equal(await balanceOf(a.publicKey), 501_000);
    assert.equal(await balanceOf(b.publicKey), 1_000_000);
    assert.deepEqual([...q.paid.keys()].sort(), ['r1', 'r2', 'r3']);

    // Running again the same week pays nothing more.
    const again = await payWeekly({ connection: provider.connection, treasury, mint, ...q, journalPath: journal, maxTotal: 100 });
    assert.lengthOf(again.lines, 0);
    assert.equal(await balanceOf(a.publicKey), 501_000);
  });

  it('never pays twice if marking fails after the money was sent', async () => {
    const c = Keypair.generate();
    const initial: ApprovedReward[] = [{ id: 'c1', node: c.publicKey.toBase58(), amount_usdc: 0.25 }];
    const paid = new Map<string, string>();
    let failMarking = true;
    const markPaid = async (ids: string[], tx: string) => {
      if (failMarking) throw new Error('database unreachable');
      ids.forEach((id) => paid.set(id, tx));
    };
    const listApproved = async () => initial.filter((r) => !paid.has(r.id));

    let failed = '';
    try { await payWeekly({ connection: provider.connection, treasury, mint, listApproved, markPaid, journalPath: journal, maxTotal: 100 }); } catch (e) { failed = String(e); }
    assert.match(failed, /unreachable/);
    assert.equal(await balanceOf(c.publicKey), 250_000, 'the money did go out once');
    assert.equal(paid.size, 0);

    failMarking = false;
    const retry = await payWeekly({ connection: provider.connection, treasury, mint, listApproved, markPaid, journalPath: journal, maxTotal: 100 });
    assert.equal(retry.recovered, 1);
    assert.lengthOf(retry.transactions, 0, 'no second payment');
    assert.equal(await balanceOf(c.publicKey), 250_000);
    assert.equal(paid.size, 1);
  });
});
