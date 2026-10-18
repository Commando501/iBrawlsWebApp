import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AccountInfo } from '../../services/account';
import { getStoredToken } from '../../services/account';
import type { GameplayConnectionStatus } from './multiplayerConnectionConstants';
import {
  MATCHMAKER_URL_STORAGE_KEY,
  buildRelaySocketUrl,
  getRelayWsUrl,
  normalizeRelayWsUrl,
  redactRelaySocketUrl,
  relayHttpBase,
} from '../../network/relayEndpoint';

type SocketChannel = 'lobby' | 'gameplay';

interface UseMatchmakerEndpointOptions {
  account: AccountInfo | null;
  isOnline: boolean;
  setConnectionStatus: Dispatch<SetStateAction<GameplayConnectionStatus>>;
  setConnectionError: Dispatch<SetStateAction<string>>;
}

const createOnlineInstanceId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall back below */
  }
  return `page_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
};

const ONLINE_INSTANCE_ID = createOnlineInstanceId();

export function useMatchmakerEndpoint({
  account,
  isOnline,
  setConnectionStatus,
  setConnectionError,
}: UseMatchmakerEndpointOptions) {
  const [userIp, setUserIp] = useState<string>('127.0.0.1');
  const [lanIp, setLanIp] = useState<string>('127.0.0.1');
  const [hostIdCode, setHostIdCode] = useState<string>('');
  const [joinIpOrId, setJoinIpOrId] = useState<string>('');
  const [customUrlInput, setCustomUrlInput] = useState<string>(() => getRelayWsUrl());
  const [endpointRevision, setEndpointRevision] = useState(0);

  const getWsUrl = useCallback(() => {
    return getRelayWsUrl();
  }, [endpointRevision]);

  const buildWsUrl = useCallback((
    baseUrl: string,
    type: SocketChannel,
    name?: string,
    includeAccountToken = true
  ) => {
    return buildRelaySocketUrl(baseUrl, {
      type,
      onlineInstanceId: ONLINE_INSTANCE_ID,
      name,
      accountId: account?.id,
      accountToken: account && includeAccountToken ? getStoredToken() : null,
    });
  }, [account]);

  const redactWsUrl = useCallback((url: string) => {
    return redactRelaySocketUrl(url);
  }, []);

  const getApiUrl = useCallback(() => {
    return relayHttpBase(getWsUrl());
  }, [getWsUrl]);

  useEffect(() => {
    const randCode = Math.floor(100000 + Math.random() * 900000).toString();
    setHostIdCode(randCode);

    if (!navigator.onLine) {
      setUserIp('127.0.0.1');
      setLanIp('127.0.0.1');
      setConnectionStatus('idle');
      setConnectionError('Offline mode active. Solo training is available; multiplayer needs a network connection.');
      return;
    }

    const controller = new AbortController();
    const finishMetadata = () => setConnectionStatus(previous => previous === 'fetching_ip' ? 'idle' : previous);
    setConnectionStatus(previous => previous === 'idle' || previous === 'fetching_ip' ? 'fetching_ip' : previous);
    fetch(`${getApiUrl()}/api/my-ip`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`API returned status ${res.status}`);
        return res.json();
      })
      .then(async (data) => {
        let detectedIp = data.ip || '127.0.0.1';
        const detectedLan = data.lanIp || '127.0.0.1';

        if (detectedIp === '127.0.0.1' || detectedIp === '::1' || detectedIp.startsWith('192.168.') || detectedIp.startsWith('10.')) {
          try {
            const ipifyRes = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
            const ipifyData = await ipifyRes.json();
            if (ipifyData && ipifyData.ip) {
              detectedIp = ipifyData.ip;
            }
          } catch (e) {
            if (controller.signal.aborted) return;
            console.warn('Failed to fetch from ipify, trying backup ipapi...', e);
            try {
              const ipapiRes = await fetch('https://ipapi.co/json/', { signal: controller.signal });
              const ipapiData = await ipapiRes.json();
              if (ipapiData && ipapiData.ip) {
                detectedIp = ipapiData.ip;
              }
            } catch (e2) {
              if (controller.signal.aborted) return;
              console.warn('Backup IP fetch failed:', e2);
            }
          }
        }

        if (controller.signal.aborted) return;
        setUserIp(detectedIp);
        setLanIp(detectedLan);
        finishMetadata();
      })
      .catch(async (err) => {
        if (controller.signal.aborted) return;
        console.warn('Network metadata unavailable; using offline-safe localhost fallback:', err);
        let fallbackIp = '127.0.0.1';
        if (navigator.onLine) {
          try {
            const ipifyRes = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
            const ipifyData = await ipifyRes.json();
            if (ipifyData && ipifyData.ip) {
              fallbackIp = ipifyData.ip;
            }
          } catch (e) {
            if (controller.signal.aborted) return;
            console.warn('Direct ipify fetch failed:', e);
          }
        }
        if (controller.signal.aborted) return;
        setUserIp(fallbackIp);
        setLanIp('127.0.0.1');
        finishMetadata();
      });
    return () => controller.abort();
  }, [getApiUrl, isOnline, setConnectionError, setConnectionStatus]);

  const applyMatchmakerUrl = useCallback(() => {
    try {
      const cleanUrl = normalizeRelayWsUrl(customUrlInput, window.location.protocol);
      localStorage.setItem(MATCHMAKER_URL_STORAGE_KEY, cleanUrl);
      setCustomUrlInput(cleanUrl);
      setEndpointRevision(previous => previous + 1);
      setConnectionError('Matchmaker updated. Reconnecting...');
      return true;
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not save the relay URL.');
      return false;
    }
  }, [customUrlInput, setConnectionError]);

  const resetMatchmakerUrl = useCallback(() => {
    try {
      localStorage.removeItem(MATCHMAKER_URL_STORAGE_KEY);
      setCustomUrlInput(getRelayWsUrl());
      setEndpointRevision(previous => previous + 1);
      setConnectionError('Reset to default. Reconnecting...');
      return true;
    } catch {
      setConnectionError('Could not reset the relay URL because browser storage is unavailable.');
      return false;
    }
  }, [setConnectionError]);

  return {
    userIp,
    lanIp,
    hostIdCode,
    setHostIdCode,
    joinIpOrId,
    setJoinIpOrId,
    customUrlInput,
    setCustomUrlInput,
    getWsUrl,
    buildWsUrl,
    redactWsUrl,
    applyMatchmakerUrl,
    resetMatchmakerUrl,
  };
}
