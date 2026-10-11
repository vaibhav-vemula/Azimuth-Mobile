import { useCallback, useState } from 'react';
import bs58 from 'bs58';
import type { Report, SignedReport } from '../reports/report';
import { signReport } from '../wallet/signReport';
import { useWallet } from '../wallet/useWallet';
import { useMapping } from '../mapping/useMapping';
import { submitReport } from './api';
import { verifierConfigured } from './config';

export type SubmissionState =
  | { phase: 'idle' }
  | { phase: 'signing' }
  | { phase: 'sending' }
  | { phase: 'done'; accepted: boolean; pending: boolean; message: string }
  | { phase: 'error'; message: string };

function rewardMessage(accepted: boolean, reasons: string[], reward?: { newCells: number; paidCells: number; subsidyUsdc: number; chestUsdc: number }, pending?: boolean): string {
  if (accepted && pending) return 'Submitted. You will receive AZMTest when it is verified. Check Profile for the result.';
  if (!accepted) return reasons.length ? reasons.join('. ') : 'The verifier did not accept this report.';
  const parts: string[] = [];
  if (reward?.chestUsdc) parts.push('Chest opened');
  if (reward?.newCells) parts.push(`${reward.newCells} cell${reward.newCells === 1 ? '' : 's'} new to the network${reward.subsidyUsdc ? ` (+${reward.subsidyUsdc} USDC subsidy)` : ''}`);
  return parts.length ? parts.join('. ') : 'Accepted. These cells were already known to the network.';
}

/** Signs a report with the connected wallet and sends it to the verifier. */
export function useSubmission() {
  const [state, setState] = useState<SubmissionState>({ phase: 'idle' });

  const sign = useCallback(async (report: Report): Promise<SignedReport> => {
    const address = useWallet.getState().address;
    if (!address) throw new Error('Connect a wallet to sign reports.');
    if (address !== report.node) throw new Error('This report was made for a different wallet.');
    const base64 = Buffer.from(bs58.decode(address)).toString('base64');
    return signReport(report, base64);
  }, []);

  const signOnly = useCallback(
    async (report: Report): Promise<SignedReport | null> => {
      try {
        setState({ phase: 'signing' });
        const signed = await sign(report);
        setState({ phase: 'idle' });
        return signed;
      } catch (e) {
        setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
    [sign]
  );

  const submit = useCallback(
    async (report: Report) => {
      try {
        if (!verifierConfigured) throw new Error('This build is not connected to the network, so nothing can be submitted. You can still share the signed file.');
        setState({ phase: 'signing' });
        const signed = await sign(report);
        setState({ phase: 'sending' });
        const result = await submitReport(signed);
        if (result.accepted) useMapping.getState().reportSent();
        setState({ phase: 'done', accepted: result.accepted, pending: !!result.pending, message: rewardMessage(result.accepted, result.reasons, result.reward, result.pending) });
      } catch (e) {
        setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [sign]
  );

  /** Shows a finished result without sending anything (used for test chests). */
  const finishLocally = useCallback((message: string) => setState({ phase: 'done', accepted: true, pending: false, message }), []);

  return { state, submit, signOnly, finishLocally, reset: () => setState({ phase: 'idle' }) };
}
