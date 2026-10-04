import type { SignedReport } from '../reports/report';
import { SUPABASE_KEY, SUPABASE_URL, VERIFIER_URL, directMode, verifierConfigured } from './config';
import { createSupabaseApi } from './supabaseApi';

const TIMEOUT_MS = 15_000;

let supabase: ReturnType<typeof createSupabaseApi> | null = null;
function direct() {
  supabase ??= createSupabaseApi({ url: SUPABASE_URL, key: SUPABASE_KEY });
  return supabase;
}

export interface Chest {
  id: string;
  title: string;
  kind: 'gap' | 'dead-zone' | 'wifi-quality' | 'visit' | 'weather-radio' | 'noise' | 'satellite-pass' | 'sonde';
  cellId: string;
  rewardUsdc: number;
  remaining: number;
  expiresMs: number;
  requester: string;
  requires: 'phone' | 'dongle';
  spec: { minSamples?: number; noradId?: string; windowStartMs?: number; windowEndMs?: number; radiusCells?: number; beaconName?: string; minRssi?: number; frequencyHz?: number; serial?: string; lastSeenMs?: number };
}

export interface SubmitResult {
  accepted: boolean;
  /** Direct mode: stored, but not checked yet. A reward, if any, appears after review. */
  pending?: boolean;
  hash?: string;
  reasons: string[];
  reward?: { newCells: number; paidCells: number; subsidyUsdc: number; chestUsdc: number };
}

export interface NodeSummary {
  address: string;
  totalUsdc: number;
  /** Submissions still waiting for a person to check them. */
  pendingReports?: number;
  rejectedReports?: number;
  pendingUsdc?: number;
  approvedUsdc?: number;
  paidUsdc?: number;
  entries: { kind: string; ref: string; amount_usdc: number; status: string; created_ms: number }[];
  seekerMint: string | null;
}

export interface SeekerCheck {
  eligible: boolean;
  mint: string | null;
  reason: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  if (!verifierConfigured) throw new Error('No verifier is configured for this build.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${VERIFIER_URL}${path}`, { ...init, signal: controller.signal });
    const body = (await res.json()) as T;
    return { status: res.status, body };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('The verifier took too long to answer.');
    throw new Error('Could not reach the verifier. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
}

export async function submitReport(signed: SignedReport): Promise<SubmitResult> {
  if (directMode) return direct().submitReport(signed);
  const { body } = await request<SubmitResult>('/v1/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signed),
  });
  return body;
}

export async function fetchChests(): Promise<Chest[]> {
  if (directMode) return direct().fetchChests();
  const { body } = await request<{ bounties: Chest[] }>('/v1/bounties');
  return body.bounties;
}

export async function fetchNodeSummary(address: string): Promise<NodeSummary> {
  if (directMode) return direct().fetchNodeSummary(address);
  const { body } = await request<NodeSummary>(`/v1/nodes/${address}`);
  return body;
}

export async function fetchKnownCells(): Promise<string[]> {
  if (directMode) return [];
  const { body } = await request<{ cells: string[] }>('/v1/atlas/cells');
  return body.cells;
}

export async function verifySeeker(address: string): Promise<SeekerCheck> {
  if (directMode) return { eligible: false, mint: null, reason: 'Your Seeker is checked when your reports are reviewed.' };
  const { body } = await request<SeekerCheck>(`/v1/nodes/${address}/verify`, { method: 'POST' });
  return body;
}

export interface DeleteResult {
  ok: boolean;
  /** Direct mode: the request was filed and will be carried out at the next review. */
  queued?: boolean;
  error?: string;
  deletedBuckets?: number;
  deletedReports?: number;
}

export async function deleteMyData(address: string, issuedAtMs: number, signature: string): Promise<DeleteResult> {
  if (directMode) return direct().deleteMyData(address, issuedAtMs, signature);
  const { body } = await request<DeleteResult>(`/v1/nodes/${address}/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ issuedAtMs, signature }),
  });
  return body;
}
