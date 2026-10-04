import * as fs from 'fs';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';

export interface ApprovedReward {
  id: string;
  node: string;
  amount_usdc: number | string;
}

export interface PayoutDeps {
  connection: Connection;
  /** Wallet that holds the tokens and pays the fees. */
  treasury: Keypair;
  mint: PublicKey;
  /** Rewards approved in the review queue and not yet paid. */
  listApproved: () => Promise<ApprovedReward[]>;
  /** Marks rewards as paid with the transaction signature. */
  markPaid: (ids: string[], tx: string) => Promise<void>;
  /** Append-only record of sent payments, so a crash after sending can never lead to paying twice. */
  journalPath: string;
  /** Refuse to send more than this many tokens in one run. */
  maxTotal: number;
  /** Show what would be paid and send nothing. */
  dryRun?: boolean;
  /** Recipients per transaction. */
  batchSize?: number;
  log?: (line: string) => void;
}

export interface PayoutLine {
  node: string;
  amount: number;
  rewardIds: string[];
}

export interface PayoutResult {
  dryRun: boolean;
  lines: PayoutLine[];
  total: number;
  transactions: string[];
  /** Payments that were sent earlier whose "paid" mark was retried now. */
  recovered: number;
}

interface JournalEntry {
  tx: string;
  ids: string[];
  marked: boolean;
}

function readJournal(path: string): JournalEntry[] {
  if (!fs.existsSync(path)) return [];
  return fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as JournalEntry);
}

function appendJournal(path: string, entry: JournalEntry) {
  fs.appendFileSync(path, JSON.stringify(entry) + '\n');
}

/** Sums rewards per wallet in whole base units, so a wallet is paid once and rounding never leaks. */
export function groupRewards(rows: ApprovedReward[], decimals: number): PayoutLine[] {
  const scale = 10 ** decimals;
  const byNode = new Map<string, { units: number; ids: string[] }>();
  for (const row of rows) {
    const units = Math.round(Number(row.amount_usdc) * scale);
    if (!Number.isFinite(units) || units <= 0) continue;
    const entry = byNode.get(row.node) ?? { units: 0, ids: [] };
    entry.units += units;
    entry.ids.push(row.id);
    byNode.set(row.node, entry);
  }
  return [...byNode.entries()].map(([node, v]) => ({ node, amount: v.units / scale, rewardIds: v.ids }));
}

export async function payWeekly(deps: PayoutDeps): Promise<PayoutResult> {
  const log = deps.log ?? (() => undefined);
  const batchSize = deps.batchSize ?? 6;
  const mintInfo = await getMint(deps.connection, deps.mint);
  const decimals = mintInfo.decimals;

  // 1. Finish the bookkeeping of any payment that was sent but not yet marked paid. These are never re-sent.
  let recovered = 0;
  const journal = readJournal(deps.journalPath);
  const markedTx = new Set(journal.filter((e) => e.marked).map((e) => e.tx));
  const unmarked = journal.filter((e) => !e.marked && !markedTx.has(e.tx));
  for (const entry of unmarked) {
    await deps.markPaid(entry.ids, entry.tx);
    appendJournal(deps.journalPath, { ...entry, marked: true });
    recovered += entry.ids.length;
    log(`recovered the paid mark for ${entry.ids.length} rewards from ${entry.tx}`);
  }

  // 2. Work out who is owed what.
  const sentIds = new Set(readJournal(deps.journalPath).flatMap((e) => e.ids));
  const rows = (await deps.listApproved()).filter((r) => !sentIds.has(r.id));
  const lines = groupRewards(rows, decimals);
  const total = lines.reduce((n, l) => n + l.amount, 0);
  const result: PayoutResult = { dryRun: !!deps.dryRun, lines, total, transactions: [], recovered };

  for (const l of lines) log(`${l.node}  ${l.amount}  (${l.rewardIds.length} rewards)`);
  log(`total ${total} to ${lines.length} wallets`);
  if (lines.length === 0 || deps.dryRun) return result;

  // 3. Safety checks before any money moves.
  if (total > deps.maxTotal) throw new Error(`Refusing to pay ${total}: more than the limit of ${deps.maxTotal}.`);
  const source = getAssociatedTokenAddressSync(deps.mint, deps.treasury.publicKey);
  const balance = Number((await getAccount(deps.connection, source)).amount) / 10 ** decimals;
  if (balance < total) throw new Error(`Treasury holds ${balance} but ${total} is owed.`);

  // 4. Pay in batches. Each batch is journalled the moment it confirms, before it is marked paid.
  for (let i = 0; i < lines.length; i += batchSize) {
    const batch = lines.slice(i, i + batchSize);
    const tx = new Transaction();
    for (const line of batch) {
      const owner = new PublicKey(line.node);
      const destination = getAssociatedTokenAddressSync(deps.mint, owner);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(deps.treasury.publicKey, destination, owner, deps.mint));
      tx.add(createTransferCheckedInstruction(source, deps.mint, destination, deps.treasury.publicKey, Math.round(line.amount * 10 ** decimals), decimals));
    }
    const signature = await sendAndConfirmTransaction(deps.connection, tx, [deps.treasury]);
    const ids = batch.flatMap((l) => l.rewardIds);
    appendJournal(deps.journalPath, { tx: signature, ids, marked: false });
    result.transactions.push(signature);
    log(`sent ${signature}`);
    await deps.markPaid(ids, signature);
    appendJournal(deps.journalPath, { tx: signature, ids, marked: true });
  }
  return result;
}

/** Command line. Reads settings from the environment; dry run unless PAYOUT_CONFIRM=yes. */
async function main() {
  const { createSupabaseSink } = require('../../server/lib/supabase.js');
  const need = (name: string) => {
    const v = process.env[name];
    if (!v) throw new Error(`Set ${name}.`);
    return v;
  };
  const sink = createSupabaseSink({ url: need('SUPABASE_URL'), serviceKey: need('SUPABASE_SERVICE_KEY') });
  const treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(need('TREASURY_KEYPAIR'), 'utf8'))));
  const result = await payWeekly({
    connection: new Connection(need('RPC_URL'), 'confirmed'),
    treasury,
    mint: new PublicKey(need('PAYOUT_MINT')),
    listApproved: () => sink.listApproved(),
    markPaid: (ids, tx) => sink.markPaid(ids, tx),
    journalPath: process.env.PAYOUT_JOURNAL ?? './payouts.jsonl',
    maxTotal: Number(process.env.PAYOUT_MAX_TOTAL ?? '100'),
    dryRun: process.env.PAYOUT_CONFIRM !== 'yes',
    log: (l) => console.log(l),
  });
  console.log(result.dryRun ? 'Dry run only. Set PAYOUT_CONFIRM=yes to send.' : `Done: ${result.transactions.length} transactions.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
