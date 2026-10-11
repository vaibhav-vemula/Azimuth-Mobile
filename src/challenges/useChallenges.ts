import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import bs58 from 'bs58';
import { fetchChallenges, fetchNodeSummary } from '../network/api';
import type { NodeSummary } from '../network/api';
import { useMapping } from '../mapping/useMapping';
import { useWallet } from '../wallet/useWallet';
import type { Challenge } from './definitions';
import { periodKey } from './periods';
import { localProgress } from './progress';
import { cardState } from './cardState';
import type { CardState } from './cardState';
import { buildClaim, signAndSubmitClaim } from './claim';

export interface ChallengeItem {
  challenge: Challenge;
  value: number;
  state: CardState;
}

export function useChallenges(): {
  items: ChallengeItem[];
  loading: boolean;
  error: string | null;
  claiming: string | null;
  message: string | null;
  claim: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const sessions = useMapping((s) => s.sessions);
  const address = useWallet((s) => s.address);
  const [list, setList] = useState<Challenge[]>([]);
  const [summary, setSummary] = useState<NodeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const haveList = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const next = await fetchChallenges();
        setList(next);
        haveList.current = true;
        setError(null);
      } catch (e) {
        // Keep the last good list; only say something when there is nothing to show.
        if (!haveList.current) setError(e instanceof Error ? e.message : String(e));
      }
      if (address) {
        try {
          setSummary(await fetchNodeSummary(address));
        } catch {
          // Progress from the phone is still shown.
        }
      } else {
        setSummary(null);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const claim = useCallback(
    async (id: string) => {
      const c = list.find((x) => x.id === id);
      if (!c || !address) return;
      setClaiming(id);
      setMessage(null);
      try {
        const now = Date.now();
        const built = buildClaim(address, c.id, periodKey(c.period, now), now);
        const base64 = Buffer.from(bs58.decode(address)).toString('base64');
        const result = await signAndSubmitClaim(built, base64);
        if (!result.accepted) {
          setMessage(result.reasons?.[0] ?? 'Could not send the claim.');
        } else {
          setMessage('Claim sent. It is checked automatically and the reward arrives once your reports are verified.');
        }
        await refresh();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setClaiming(null);
      }
    },
    [list, address, refresh]
  );

  const nowMs = Date.now();
  const verified = summary?.verified ?? [];
  const items = list.map((challenge) => {
    const value = localProgress(challenge, { sessions, verified, nowMs });
    return { challenge, value, state: cardState(challenge, { value, claims: summary?.claims, verified, nowMs }) };
  });

  return { items, loading, error, claiming, message, claim, refresh };
}
