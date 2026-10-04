import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotent } from '@solana/spl-token';

export interface PendingSettlement {
  ledgerId: number;
  node: string;
  onchainBounty: string;
  reportHash: string; // hex, 32 bytes
  amountUsdc: number;
}

export interface SettleDeps {
  program: Program;
  connection: anchor.web3.Connection;
  verifier: Keypair;
  /** Pending, verifier-accepted payouts (from GET /v1/settlements/pending). */
  pending: PendingSettlement[];
  /** Records the transaction in the verifier (POST /v1/settlements/:id). */
  markDone: (ledgerId: number, tx: string) => Promise<void>;
}

export interface SettleOutcome {
  ledgerId: number;
  ok: boolean;
  tx?: string;
  error?: string;
}

export function hexToBytes32(hex: string): number[] {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('report hash must be 64 hex characters');
  return Array.from(Buffer.from(hex, 'hex'));
}

/** Pays each pending claim on-chain. One failure does not stop the rest. */
export async function settlePending(deps: SettleDeps): Promise<SettleOutcome[]> {
  const outcomes: SettleOutcome[] = [];
  for (const item of deps.pending) {
    try {
      const bountyKey = new PublicKey(item.onchainBounty);
      const node = new PublicKey(item.node);
      const bounty: any = await (deps.program.account as any).bounty.fetch(bountyKey);
      const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), bountyKey.toBuffer()], deps.program.programId);
      const [claim] = PublicKey.findProgramAddressSync([Buffer.from('claim'), bountyKey.toBuffer(), node.toBuffer()], deps.program.programId);

      const nodeToken = await createAssociatedTokenAccountIdempotent(deps.connection, deps.verifier, bounty.mint, node);
      const tx = await deps.program.methods
        .settleClaim(hexToBytes32(item.reportHash))
        .accounts({
          verifier: deps.verifier.publicKey,
          bounty: bountyKey,
          mint: bounty.mint,
          vault,
          node,
          nodeToken,
          claim,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([deps.verifier])
        .rpc();
      await deps.markDone(item.ledgerId, tx);
      outcomes.push({ ledgerId: item.ledgerId, ok: true, tx });
    } catch (e) {
      outcomes.push({ ledgerId: item.ledgerId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return outcomes;
}

/** Command line: VERIFIER_URL, OPERATOR_KEY and the verifier keypair path are read from the environment. */
async function main() {
  const base = (process.env.VERIFIER_URL || '').replace(/\/+$/, '');
  const operatorKey = process.env.OPERATOR_KEY;
  if (!base || !operatorKey) throw new Error('Set VERIFIER_URL and OPERATOR_KEY.');

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.azimuthBounty as Program;
  const verifier = (provider.wallet as anchor.Wallet).payer;

  const headers = { 'x-operator-key': operatorKey, 'content-type': 'application/json' };
  const pending = ((await (await fetch(`${base}/v1/settlements/pending`, { headers })).json()) as { settlements: PendingSettlement[] }).settlements;
  const outcomes = await settlePending({
    program,
    connection: provider.connection,
    verifier,
    pending,
    markDone: async (id, tx) => {
      const res = await fetch(`${base}/v1/settlements/${id}`, { method: 'POST', headers, body: JSON.stringify({ tx }) });
      if (!res.ok) throw new Error(`verifier refused to record settlement ${id}`);
    },
  });
  for (const o of outcomes) console.log(o.ok ? `paid #${o.ledgerId} ${o.tx}` : `FAILED #${o.ledgerId}: ${o.error}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
