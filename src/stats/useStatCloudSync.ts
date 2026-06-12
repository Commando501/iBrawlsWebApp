import { useCallback, useEffect, useRef } from 'react';
import type { AccountInfo } from '../services/account';
import { fetchCloudStats, ingestStatDelta } from '../services/playerStats';
import { loadMergedAccountId, profileToDelta, saveMergedAccountId } from './statStore';
import { statTracker } from './statTracker';
import { isDeltaEmpty } from './statTypes';
import type { StatDelta } from './statTypes';

/**
 * Keeps the local stat profile and the account's cloud stats in step.
 *
 * - On login: a one-time merge pushes the pre-account local history into the
 *   account (guarded by a per-account marker), then the server's merged
 *   totals become the local baseline.
 * - After gameplay commits: pending deltas are pushed (debounced). On failure
 *   they fold back into the pending queue and retry on the next commit/login.
 * - Logged out: everything simply accrues locally.
 */

const PUSH_DEBOUNCE_MS = 4000;

export function shouldPushInitialStatProfile(localDelta: StatDelta): boolean {
  return !isDeltaEmpty(localDelta);
}

export function useStatCloudSync(account: AccountInfo | null) {
  const accountId = account?.id ?? null;
  const syncBusyRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  const pushPending = useCallback(async () => {
    if (!accountIdRef.current || syncBusyRef.current) return;
    const delta = statTracker.beginFlush();
    if (!delta || isDeltaEmpty(delta)) return;
    syncBusyRef.current = true;
    try {
      const result = await ingestStatDelta(delta);
      if (result.ok && result.data?.stats) {
        statTracker.completeFlush(result.data.stats);
      } else {
        statTracker.abortFlush();
      }
    } catch {
      statTracker.abortFlush();
    } finally {
      syncBusyRef.current = false;
    }
  }, []);

  const schedulePush = useCallback(() => {
    if (!accountIdRef.current) return;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      void pushPending();
    }, PUSH_DEBOUNCE_MS);
  }, [pushPending]);

  // Push whenever the tracker commits new stats (debounced).
  useEffect(() => {
    const unsubscribe = statTracker.subscribe(schedulePush);
    return () => {
      unsubscribe();
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
    };
  }, [schedulePush]);

  // Login / account switch: first-time merge or fetch-and-adopt.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      if (syncBusyRef.current) return;
      syncBusyRef.current = true;
      try {
        if (loadMergedAccountId() !== accountId) {
          // First login on this device: fold the entire local history into the
          // account, then adopt the merged result as the new baseline. Pending
          // changes are drained into the in-flight slot first — their effects
          // are already inside the profile snapshot being pushed, so
          // completeFlush settles them without double counting.
          statTracker.beginFlush();
          const localDelta = profileToDelta(statTracker.getProfile());
          if (shouldPushInitialStatProfile(localDelta)) {
            const result = await ingestStatDelta(localDelta);
            if (!cancelled && result.ok && result.data?.stats) {
              saveMergedAccountId(accountId);
              statTracker.completeFlush(result.data.stats);
            } else {
              statTracker.abortFlush();
            }
          } else {
            const result = await fetchCloudStats();
            if (!cancelled && result.ok) {
              saveMergedAccountId(accountId);
              if (result.data?.stats) statTracker.adoptServerProfile(result.data.stats);
            } else {
              statTracker.abortFlush();
            }
          }
        } else {
          const result = await fetchCloudStats();
          if (!cancelled && result.ok) {
            if (result.data?.stats) statTracker.adoptServerProfile(result.data.stats);
            // Anything earned while logged out is still pending — push it.
            if (statTracker.hasUnsyncedChanges()) {
              syncBusyRef.current = false;
              await pushPending();
            }
          }
        }
      } finally {
        syncBusyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, pushPending]);

  // Make sure debounced localStorage writes land when the tab is hidden.
  useEffect(() => {
    const flush = () => statTracker.flushToStorage();
    window.addEventListener('visibilitychange', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('visibilitychange', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);
}
