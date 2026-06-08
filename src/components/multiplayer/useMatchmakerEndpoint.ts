import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { AccountInfo } from '../../services/account';
import { getStoredToken } from '../../services/account';
import type { GameplayConnectionStatus } from './multiplayerConnectionConstants';

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

const getSavedMatchmakerUrl = () => {
  const saved = localStorage.getItem('ibrawls_matchmaker_url');
  if (saved) return saved;

  const envWsUrl = import.meta.env.VITE_WS_URL;
  if (envWsUrl) return envWsUrl;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let host = window.location.host;
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    host = 'ais-pre-tjrfoohpldxg7i2a3ncqfn-194609500028.us-west2.run.app';
  } else if (host.includes('ibrawlswebapp.pages.dev')) {
    host = 'ibrawlswebapp.commando501.workers.dev';
  }
  return `${protocol}//${host}/ws`;
};

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
  const [customUrlInput, setCustomUrlInput] = useState<string>(() => getSavedMatchmakerUrl());

  const getWsUrl = useCallback(() => {
    return getSavedMatchmakerUrl();
  }, []);

  const buildWsUrl = useCallback((
    baseUrl: string,
    type: SocketChannel,
    name?: string,
    includeAccountToken = true
  ) => {
    const separator = baseUrl.includes('?') ? '&' : '?';
    let url = `${baseUrl}${separator}type=${type}`;
    url += `&onlineInstanceId=${encodeURIComponent(ONLINE_INSTANCE_ID)}`;
    if (name) {
      url += `&name=${encodeURIComponent(name)}`;
    }
    const token = account ? getStoredToken() : null;
    if (account) {
      url += `&accountId=${encodeURIComponent(account.id)}`;
    }
    if (account && token && includeAccountToken) {
      url += `&accountToken=${encodeURIComponent(token)}`;
    }
    return url;
  }, [account]);

  const redactWsUrl = useCallback((url: string) => {
    return url.replace(/([?&]accountToken=)[^&]*/g, '$1[redacted]');
  }, []);

  const getApiUrl = useCallback(() => {
    const wsUrl = getWsUrl();
    let apiUrl = wsUrl.replace(/^ws/, 'http');
    if (apiUrl.endsWith('/ws')) {
      apiUrl = apiUrl.slice(0, -3);
    }
    return apiUrl;
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

    setConnectionStatus('fetching_ip');
    fetch(`${getApiUrl()}/api/my-ip`)
      .then(res => {
        if (!res.ok) throw new Error(`API returned status ${res.status}`);
        return res.json();
      })
      .then(async (data) => {
        let detectedIp = data.ip || '127.0.0.1';
        const detectedLan = data.lanIp || '127.0.0.1';

        if (detectedIp === '127.0.0.1' || detectedIp === '::1' || detectedIp.startsWith('192.168.') || detectedIp.startsWith('10.')) {
          try {
            const ipifyRes = await fetch('https://api.ipify.org?format=json');
            const ipifyData = await ipifyRes.json();
            if (ipifyData && ipifyData.ip) {
              detectedIp = ipifyData.ip;
            }
          } catch (e) {
            console.warn('Failed to fetch from ipify, trying backup ipapi...', e);
            try {
              const ipapiRes = await fetch('https://ipapi.co/json/');
              const ipapiData = await ipapiRes.json();
              if (ipapiData && ipapiData.ip) {
                detectedIp = ipapiData.ip;
              }
            } catch (e2) {
              console.warn('Backup IP fetch failed:', e2);
            }
          }
        }

        setUserIp(detectedIp);
        setLanIp(detectedLan);
        setConnectionStatus('idle');
      })
      .catch(async (err) => {
        console.warn('Network metadata unavailable; using offline-safe localhost fallback:', err);
        let fallbackIp = '127.0.0.1';
        if (navigator.onLine) {
          try {
            const ipifyRes = await fetch('https://api.ipify.org?format=json');
            const ipifyData = await ipifyRes.json();
            if (ipifyData && ipifyData.ip) {
              fallbackIp = ipifyData.ip;
            }
          } catch (e) {
            console.warn('Direct ipify fetch failed:', e);
          }
        }
        setUserIp(fallbackIp);
        setLanIp('127.0.0.1');
        setConnectionStatus('idle');
      });
  }, [getApiUrl, isOnline, setConnectionError, setConnectionStatus]);

  const applyMatchmakerUrl = useCallback(() => {
    let cleanUrl = customUrlInput.trim();
    if (!cleanUrl) return false;
    if (!cleanUrl.startsWith('ws://') && !cleanUrl.startsWith('wss://')) {
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      cleanUrl = protocol + cleanUrl;
    }
    localStorage.setItem('ibrawls_matchmaker_url', cleanUrl);
    setCustomUrlInput(cleanUrl);
    setConnectionError('Matchmaker updated. Reconnecting...');
    return true;
  }, [customUrlInput, setConnectionError]);

  const resetMatchmakerUrl = useCallback(() => {
    localStorage.removeItem('ibrawls_matchmaker_url');
    const defaultUrl = getSavedMatchmakerUrl();
    setCustomUrlInput(defaultUrl);
    setConnectionError('Reset to default. Reconnecting...');
    return true;
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
