/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GameStats, UniversalSettings, UiElementPos } from './types';
import { GrifballGame } from './components/GrifballGame';
import { HUD } from './components/HUD';
import { sfx } from './components/AudioEngine';
import { RotateCcw, Check } from 'lucide-react';
import { ChatOverlay, ChatMessage } from './components/ChatOverlay';
import { CharacterPreview } from './components/CharacterPreview';

interface OnlineClient {
  id: string;
  state: 'menu' | 'solo' | 'multi';
  roomCode?: string;
  spaceAvailable?: boolean;
}

interface LobbyChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

const LobbyChatPanel = ({ messages, onSendMessage }: LobbyChatPanelProps) => {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <div className="flex-1 flex flex-col justify-between min-h-0">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span className="w-1.5 h-3 bg-[#38bdf8]" />
        <h2 className="text-xs uppercase font-bold tracking-[0.25em] text-white">
          Real-Time Lobby Chat Room
        </h2>
      </div>

      {/* Message history container */}
      <div 
        ref={scrollRef}
        className="flex-1 min-h-[220px] max-h-[300px] overflow-y-auto bg-black/45 border border-white/10 rounded-lg p-3.5 flex flex-col gap-2.5 mb-3 scrollbar-thin scrollbar-thumb-white/10 pr-1.5"
      >
        {messages.length === 0 ? (
          <p className="text-[10.5px] font-mono text-white/35 uppercase tracking-widest text-center my-auto italic select-none">
            📡 No broadcasts active. Type below to ping online combatants.
          </p>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col gap-0.5 max-w-[90%] animate-fade-in ${
                msg.isLocal ? 'self-end bg-[#38bdf8]/10 p-2 rounded-lg border border-[#38bdf8]/20' : 'self-start'
              }`}
            >
              <div className="flex items-center gap-1.5 select-none">
                <span className={`text-[9.5px] font-mono font-black ${
                  msg.isLocal ? 'text-[#38bdf8]' : 'text-slate-400'
                }`}>
                  {msg.sender} {msg.isLocal ? '(You)' : ''}
                </span>
                <span className="text-[8px] font-mono text-white/20">
                  {msg.timestamp}
                </span>
              </div>
              <p className="text-[11.5px] font-sans text-slate-100 break-words leading-relaxed select-text font-medium leading-[1.3] pl-0.5">
                {msg.text}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Message input form */}
      <form 
        onSubmit={handleSubmit}
        className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg p-2 shrink-0 pointer-events-auto"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Send coordinates... [Press Enter]"
          className="flex-grow bg-black/50 border border-white/5 rounded px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-[#38bdf8]/40 outline-none transition-all font-sans"
          maxLength={120}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className={`px-4 py-2 rounded text-xs font-sans font-bold uppercase tracking-wider transition-all flex items-center justify-center shrink-0 ${
            inputText.trim()
              ? 'bg-[#38bdf8] hover:bg-[#38bdf8]/80 text-slate-950 font-black cursor-pointer shadow-[0_0_12px_rgba(56,189,248,0.25)] hover:shadow-[0_0_18px_rgba(56,189,248,0.4)] active:scale-95'
              : 'bg-white/5 text-white/20 border border-transparent cursor-not-allowed'
          }`}
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default function App() {
  const getWsUrl = () => {
    const envWsUrl = import.meta.env.VITE_WS_URL;
    if (envWsUrl) return envWsUrl;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws';
    let host = window.location.host;
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      host = 'ais-pre-tjrfoohpldxg7i2a3ncqfn-194609500028.us-west2.run.app';
    }
    return `${protocol}//${host}`;
  };

  const getApiUrl = () => {
    const wsUrl = getWsUrl();
    return wsUrl.replace(/^ws/, 'http');
  };

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [debugMode, setDebugMode] = useState<boolean>(false);
  const [isTerminated, setIsTerminated] = useState<boolean>(false);
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(false);
  const [showUiAdjustment, setShowUiAdjustment] = useState<boolean>(false);
  const [showLightingMenu, setShowLightingMenu] = useState<boolean>(false);

  // Chat message state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lobbyChatMessages, setLobbyChatMessages] = useState<ChatMessage[]>([]);
  const [rightPanelTab, setRightPanelTab] = useState<'manual' | 'chat' | 'customize'>('manual');
  const [unreadLobbyMessages, setUnreadLobbyMessages] = useState<number>(0);
  const [customizerWeapon, setCustomizerWeapon] = useState<'none' | 'hammer' | 'sword'>('none');
  const rightPanelTabRef = useRef<'manual' | 'chat' | 'customize'>('manual');

  useEffect(() => {
    rightPanelTabRef.current = rightPanelTab;
  }, [rightPanelTab]);

  // Retrieve saved player hue on startup
  const getSavedPlayerHue = (): number => {
    try {
      const saved = localStorage.getItem('grifball_player_hue');
      return saved ? parseInt(saved, 10) : 200;
    } catch (e) {
      return 200;
    }
  };

  // Multiplayer States
  const [connectionMode, setConnectionMode] = useState<'relay' | 'local'>('relay');
  const [activeMenuTab, setActiveMenuTab] = useState<'single' | 'multi'>('single');
  const [isMultiplayer, setIsMultiplayer] = useState<boolean>(false);
  const [multiplayerRole, setMultiplayerRole] = useState<'host' | 'client' | null>(null);
  const [multiplayerSocket, setMultiplayerSocket] = useState<WebSocket | null>(null);
  const [userIp, setUserIp] = useState<string>('127.0.0.1');
  const [lanIp, setLanIp] = useState<string>('127.0.0.1');
  const [hostIdCode, setHostIdCode] = useState<string>('');
  const [joinIpOrId, setJoinIpOrId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>('');

  // Persisting network metadata and lobby invitation parameters
  const [menuSocket, setMenuSocket] = useState<WebSocket | null>(null);
  const [clientId, setClientId] = useState<string>('');
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [onlineClients, setOnlineClients] = useState<OnlineClient[]>([]);
  const [activeInvite, setActiveInvite] = useState<{ fromId: string; roomCode: string } | null>(null);
  const [inviteNotifications, setInviteNotifications] = useState<string[]>([]);
  const [ping, setPing] = useState<number | undefined>(undefined);

  // Default positions for customizable HUD items (percentages of viewport)
  const DEFAULT_UI_POSITIONS: UiElementPos[] = [
    { id: 'objective', name: 'Objective Block', x: 3, y: 3, locked: true },
    { id: 'scoreboard', name: 'Scoreboard', x: 50, y: 3, locked: true },
    { id: 'arenaStatus', name: 'Arena Status & Controls', x: 97, y: 3, locked: true },
    { id: 'eliminationFeed', name: 'Elimination Feed', x: 3, y: 45, locked: true },
    { id: 'radar', name: 'Tactical Radar', x: 3, y: 65, locked: true },
    { id: 'weaponDash', name: 'Gear & Thrusters', x: 3, y: 82, locked: true },
    { id: 'vitality', name: 'Vitality Indicator', x: 97, y: 90, locked: true },
    { id: 'crosshair', name: 'Reticle / Target Dot', x: 50, y: 50, locked: true },
  ];

  const [uiPositions, setUiPositions] = useState<UiElementPos[]>(() => {
    try {
      const saved = localStorage.getItem('grifball_ui_positions');
      if (saved) {
        // Fallback merge to guarantee newly introduced elements exist
        const parsed = JSON.parse(saved) as UiElementPos[];
        const positions = [...DEFAULT_UI_POSITIONS];
        parsed.forEach(item => {
          const index = positions.findIndex(p => p.id === item.id);
          if (index !== -1) {
            positions[index] = item;
          }
        });
        return positions;
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_UI_POSITIONS;
  });

  const handleUpdateUiPositions = (newPositions: UiElementPos[]) => {
    setUiPositions(newPositions);
    try {
      localStorage.setItem('grifball_ui_positions', JSON.stringify(newPositions));
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetUiPositions = () => {
    setUiPositions(DEFAULT_UI_POSITIONS);
    try {
      localStorage.setItem('grifball_ui_positions', JSON.stringify(DEFAULT_UI_POSITIONS));
    } catch (e) {
      console.error(e);
    }
  };


  // Configuration settings for simulated health, speed percentage, attack offsets and impact sizes
  const [adminSettings, setAdminSettings] = useState<UniversalSettings>({
    maxHP: 1,
    speedForward: 100,
    speedSide: 100,
    speedBackward: 100,
    attackRange: 3.2,
    attackRadius: 4.5,
    dashDistance: 6.0,
    dashDuration: 0.25,
    dashCooldown: 2.0,
    respawnInvulnerabilityDuration: 1.0,
    hammerReloadTime: 0.6,
    swordLungeDistance: 14.5,
    swordLungeSpeed: 24.0,
    swordSlashSpeed: 0.22,
    swordSlashReload: 0.6,
    swordLungeReload: 1.2,
    hammerJumpPower: 6.5,
    hammerJumpTriggerRadius: 3.5,
    hammerJumpWindow: 0.6,
    visualizeJumpZone: true,
    directLightIntensity: 1.6,
    ambientLightIntensity: 0.82,
    skyboxBrightness: 4.0,
    skyboxHue: 224,
    enableSwordTrade: true,
    enableHammerSwordTrade: true,
    swordTradeWindow: 350,
    hammerSwordTradeWindow: 350,
    playerHue: getSavedPlayerHue(),
  });

  // Standard initial dummy stats to render HUD beautifully before game starts
  const [currentStats, setCurrentStats] = useState<GameStats>({
    playerHP: 1,
    playerMaxHP: 1,
    enemyHP: 1,
    enemyMaxHP: 1,
    scorePlayer: 0,
    scoreEnemy: 0,
    gameTime: 522, // 8:42
    debugMode: false,
    debugDamageRadius: 4.5,
    weaponReady: true,
    weaponCooldown: 1.0,
    lastStrikePos: null,
    lastStrikeTick: 0,
    isCrouching: false,
    isJumping: false,
    playerRespawnTimer: 0,
    enemyRespawnTimer: 0,
    playerDashCooldownTimer: 0,
    playerDashReady: true,
    settings: {
      maxHP: 1,
      speedForward: 100,
      speedSide: 100,
      speedBackward: 100,
      attackRange: 3.2,
      attackRadius: 4.5,
      dashDistance: 6.0,
      dashDuration: 0.25,
      dashCooldown: 2.0,
      respawnInvulnerabilityDuration: 1.0,
      hammerReloadTime: 0.6,
      swordLungeDistance: 14.5,
      swordLungeSpeed: 24.0,
      swordSlashSpeed: 0.22,
      swordSlashReload: 0.6,
      swordLungeReload: 1.2,
      hammerJumpPower: 6.5,
      hammerJumpTriggerRadius: 3.5,
      hammerJumpWindow: 0.6,
      visualizeJumpZone: true,
      directLightIntensity: 1.6,
      ambientLightIntensity: 0.82,
      skyboxBrightness: 4.0,
      skyboxHue: 224,
      enableSwordTrade: true,
      enableHammerSwordTrade: true,
      swordTradeWindow: 350,
      hammerSwordTradeWindow: 350,
      playerHue: getSavedPlayerHue(),
    },
    lastDeaths: [],
    playerX: 0,
    playerZ: 12,
    playerYaw: Math.PI,
    enemyX: 0,
    enemyZ: -12,
    enemyYaw: 0,
    enemyIsCrouching: false,
    playerIsCrouchMoving: false,
    enemyIsCrouchMoving: false,
    activeWeapon: 'hammer',
    crosshairColor: 'white',
  });

  // Fetch client IP on initialization and generate a quick room custom ID
  useEffect(() => {
    const randCode = Math.floor(100000 + Math.random() * 900000).toString();
    setHostIdCode(randCode);

    setConnectionStatus('fetching_ip');
    fetch(`${getApiUrl()}/api/my-ip`)
      .then(res => {
        if (!res.ok) throw new Error(`API returned status ${res.status}`);
        return res.json();
      })
      .then(async (data) => {
        let detectedIp = data.ip || '127.0.0.1';
        let detectedLan = data.lanIp || '127.0.0.1';
        
        // If detected IP is loopback or local network range (like 127.0.0.1 or ::1),
        // try to query a public WAN IP echo service to show the real internet address.
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
        console.error('Error fetching API my-ip:', err);
        let fallbackIp = '127.0.0.1';
        try {
          const ipifyRes = await fetch('https://api.ipify.org?format=json');
          const ipifyData = await ipifyRes.json();
          if (ipifyData && ipifyData.ip) {
            fallbackIp = ipifyData.ip;
          }
        } catch (e) {
          console.warn('Direct ipify fetch failed:', e);
        }
        setUserIp(fallbackIp);
        setLanIp('127.0.0.1');
        setConnectionStatus('idle');
      });
  }, []);

  // Dedicated background central server connection for counting players, measuring ping, and carrying match invitations
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let pingInterval: any = null;
    let isDestroyed = false;

    function connect() {
      if (isDestroyed) return;
      
      const wsUrl = getWsUrl();
      console.log('Connecting persistent lobby socket to:', wsUrl);
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Lobby network established.');
        if (isDestroyed) {
          ws?.close();
          return;
        }
        setMenuSocket(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'welcome') {
            setClientId(data.clientId);
          } else if (data.type === 'presence') {
            setOnlineCount(data.onlineCount || 0);
            // Capture list of online client info (excluding this browser's self)
            const others = (data.clients || []).filter((c: OnlineClient) => c.id !== data.clientId && c.id !== clientId);
            setOnlineClients(others);
          } else if (data.type === 'pong') {
            const calculatedPing = Date.now() - data.timestamp;
            setPing(calculatedPing);
          } else if (data.type === 'receive_invite') {
            setActiveInvite({
              fromId: data.fromId,
              roomCode: data.roomCode
            });
            sfx.playRespawn(); // Custom prompt trigger sound
          } else if (data.type === 'invite_declined') {
            const declString = `Client ${data.fromId} declined your match invite.`;
            setInviteNotifications(prev => [...prev, declString]);
            setTimeout(() => {
              setInviteNotifications(prev => prev.filter(n => n !== declString));
            }, 5000);
          } else if (data.type === 'lobby_chat') {
            setLobbyChatMessages(prev => {
              if (prev.some(m => m.id === data.id)) return prev;
              return [...prev, {
                id: data.id,
                sender: data.sender,
                text: data.text,
                timestamp: data.timestamp,
                role: 'client',
                isLocal: data.clientId === clientId
              }];
            });
            if (rightPanelTabRef.current !== 'chat') {
              setUnreadLobbyMessages(prev => prev + 1);
            }
          }
        } catch (e) {
          console.error('Lobby network parsing error:', e);
        }
      };

      ws.onclose = () => {
        setMenuSocket(null);
        if (!isDestroyed) {
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };

      ws.onerror = (err) => {
        ws?.close();
      };
    }

    connect();

    // Heartbeat to measure RTT latency
    pingInterval = setInterval(() => {
      const activeSock = (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) 
        ? multiplayerSocket 
        : (ws && ws.readyState === WebSocket.OPEN) ? ws : null;
      
      if (activeSock && activeSock.readyState === WebSocket.OPEN) {
        activeSock.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        }));
      }
    }, 2000);

    return () => {
      isDestroyed = true;
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
      clearInterval(pingInterval);
    };
  }, [multiplayerSocket, clientId]);

  // Synchronize player state with central lobby server
  useEffect(() => {
    if (!menuSocket || menuSocket.readyState !== WebSocket.OPEN) return;

    let status: 'menu' | 'solo' | 'multi' = 'menu';
    let roomCode: string | undefined = undefined;
    let spaceAvailable = false;

    if (isPlaying) {
      if (isMultiplayer) {
        status = 'multi';
        roomCode = multiplayerRole === 'host' ? hostIdCode : joinIpOrId;
        spaceAvailable = false; // Playing is already 2/2
      } else {
        status = 'solo';
      }
    } else {
      if (connectionStatus === 'hosting') {
        status = 'multi';
        roomCode = hostIdCode;
        spaceAvailable = true; // Hosting lobby is open (1/2)
      } else if (connectionStatus === 'connecting') {
        status = 'multi';
        roomCode = joinIpOrId;
        spaceAvailable = false;
      } else {
        status = 'menu';
      }
    }

    menuSocket.send(JSON.stringify({
      type: 'update_status',
      status,
      roomCode,
      spaceAvailable
    }));
  }, [menuSocket, isPlaying, isMultiplayer, connectionStatus, hostIdCode, joinIpOrId, multiplayerRole]);

  // Sync the real-time calculated ping to HUD stats immediately
  useEffect(() => {
    setCurrentStats(prev => ({
      ...prev,
      ping
    }));
  }, [ping]);

  // Dedicated in-game chat message sync listener
  useEffect(() => {
    if (!multiplayerSocket) return;

    const handleChatMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'sync' && data.action === 'chat') {
          setChatMessages(prev => {
            if (prev.some(m => m.id === data.id)) return prev;
            return [...prev, {
              id: data.id,
              sender: data.sender || 'Opponent',
              text: data.text || '',
              timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              role: data.role || 'client',
              isLocal: false
            }];
          });
        }
      } catch (err) {
        // Safe catch
      }
    };

    multiplayerSocket.addEventListener('message', handleChatMessage);
    return () => {
      multiplayerSocket.removeEventListener('message', handleChatMessage);
    };
  }, [multiplayerSocket]);

  const sendChatMessage = (text: string) => {
    if (!multiplayerSocket || multiplayerSocket.readyState !== WebSocket.OPEN) return;
    
    const senderName = multiplayerRole === 'host' ? 'Blue (Host)' : 'Red (Guest)';
    const msgId = Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const packet = {
      type: 'sync',
      action: 'chat',
      id: msgId,
      sender: senderName,
      text: text,
      timestamp: timestamp,
      role: multiplayerRole
    };
    
    multiplayerSocket.send(JSON.stringify(packet));
    
    // Append locally immediately
    setChatMessages(prev => [
      ...prev,
      {
        id: msgId,
        sender: `${senderName} (You)`,
        text: text,
        timestamp: timestamp,
        role: multiplayerRole!,
        isLocal: true
      }
    ]);
  };

  const sendLobbyChatMessage = (text: string) => {
    if (!menuSocket || menuSocket.readyState !== WebSocket.OPEN) return;
    
    const packet = {
      type: 'lobby_chat',
      sender: `Client ${clientId}`,
      text: text
    };
    
    menuSocket.send(JSON.stringify(packet));
  };

  const handleHostGame = () => {
    setConnectionError('');
    setConnectionStatus('hosting');
    setChatMessages([]);

    const wsUrl = connectionMode === 'relay' ? getWsUrl() : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    console.log('WS Host connection target URL resolved to:', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WS Connection opened. Registering host...');
      ws.send(JSON.stringify({
        type: 'host',
        ip: userIp,
        lanIp: lanIp,
        customId: hostIdCode
      }));
    };

    const handleHostMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'hosted') {
          console.log('Successfully hosted lobby inside room of keys:', data.keys);
        } else if (data.type === 'connected') {
          // Unsubscribe to prevent packet intercept or duplication
          ws.removeEventListener('message', handleHostMessage);

          setMultiplayerSocket(ws);
          setIsMultiplayer(true);
          setMultiplayerRole('host');
          setConnectionStatus('connected');

          sfx.init();
          sfx.resume();
          sfx.playRespawn();

          setIsPlaying(true);
          setIsPaused(false);
          setIsTerminated(false);
        } else if (data.type === 'error') {
          setConnectionError(data.message);
          setConnectionStatus('error');
          ws.close();
        }
      } catch (err) {
        console.error('Error parsing onmessage host data:', err);
      }
    };

    ws.addEventListener('message', handleHostMessage);

    ws.onclose = () => {
      console.log('Host socket disconnected.');
      setConnectionStatus('idle');
      setMultiplayerSocket(null);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Host Error:', err);
      setConnectionError('Matchmaker registration failed.');
      setConnectionStatus('error');
    };
  };

  const handleJoinGame = (target: string) => {
    if (!target) {
      setConnectionError('Please provide a Host IP address or Room Code.');
      return;
    }
    setJoinIpOrId(target);
    setConnectionError('');
    setConnectionStatus('connecting');
    setChatMessages([]);

    const cleanTarget = target.trim().replace(/^(hw|http|https|ws|wss):\/\//i, '');
    const isDirectAddress = cleanTarget.includes('.') || cleanTarget.includes(':') || isNaN(Number(cleanTarget));

    const protocol = (window.location.protocol === 'https:' || connectionMode === 'relay') ? 'wss:' : 'ws:';
    let wsUrl = '';

    if (connectionMode === 'relay') {
      wsUrl = getWsUrl();
    } else {
      if (isDirectAddress) {
        // Direct LAN IP connection
        let hostWithPort = cleanTarget;
        if (!hostWithPort.includes(':')) {
          hostWithPort = `${hostWithPort}:3000`;
        }
        const directProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${directProtocol}//${hostWithPort}`;
      } else {
        // Centralized matchmaking Room Code connection
        wsUrl = `${protocol}//${window.location.host}`;
      }
    }

    console.log('WS Join connection target URL resolved to:', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WS Connection opened. Joining:', target);
      ws.send(JSON.stringify({
        type: 'join',
        targetIpOrId: target.trim()
      }));
    };

    const handleJoinMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          // Unsubscribe to prevent packet intercept or duplication
          ws.removeEventListener('message', handleJoinMessage);

          setMultiplayerSocket(ws);
          setIsMultiplayer(true);
          setMultiplayerRole('client');
          setConnectionStatus('connected');

          sfx.init();
          sfx.resume();
          sfx.playRespawn();

          setIsPlaying(true);
          setIsPaused(false);
          setIsTerminated(false);
        } else if (data.type === 'error') {
          setConnectionError(data.message);
          setConnectionStatus('error');
          ws.close();
        }
      } catch (e) {
        console.error(e);
      }
    };

    ws.addEventListener('message', handleJoinMessage);

    ws.onclose = () => {
      console.log('Guest join socket disconnected.');
      setConnectionStatus('idle');
      setMultiplayerSocket(null);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Join Error:', err);
      setConnectionError('Matching connection failed.');
      setConnectionStatus('error');
    };
  };

  const handleCancelHostOrJoin = () => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setConnectionStatus('idle');
    setConnectionError('');
    setMultiplayerSocket(null);
  };

  const handleStartGame = () => {
    // Initialise and resume synthesizer context securely on user click gesture!
    sfx.init();
    sfx.resume();
    sfx.playRespawn();

    setIsMultiplayer(false);
    setMultiplayerRole(null);
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setMultiplayerSocket(null);

    setIsPlaying(true);
    setIsPaused(false);
    setIsTerminated(false);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  };

  const handleCloseGame = () => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setIsTerminated(true);
    setIsPlaying(false);
    setIsPaused(false);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  };

  const handleResumeGame = () => {
    sfx.resume();
    setIsPaused(false);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  };

  const handleResetMatch = () => {
    // Refresh page / state indices reload
    sfx.playRespawn();
    window.location.reload();
  };

  const handleReturnToMain = () => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setIsPlaying(false);
    setIsPaused(false);
    setIsMultiplayer(false);
    setMultiplayerRole(null);
    setMultiplayerSocket(null);
    setConnectionStatus('idle');
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  };

  const toggleDebugMode = () => {
    setDebugMode(prev => !prev);
  };

  // Callback to sync game stats live
  const handleStatsUpdate = (stats: GameStats) => {
    setCurrentStats({
      ...stats,
      isMultiplayer,
      multiplayerRole,
      opponentConnected: isMultiplayer && !!multiplayerSocket
    });
  };

  const handlePauseToggle = () => {
    if (showUiAdjustment) {
      setShowUiAdjustment(false);
      return;
    }
    setIsPaused(prev => !prev);
    // Auto-return to main pause menu next time paused
    if (isPaused) {
      setShowAdminPanel(false);
      setShowLightingMenu(false);
    }
  };

  return (
    <div className="relative w-full h-screen bg-[#050b1a] text-white overflow-hidden select-none font-sans flex flex-col">
      {/* BACKGROUND ARENA SIMULATION GRID */}
      <div 
        className="absolute inset-0 z-0 opacity-20 pointer-events-none" 
        style={{
          backgroundImage: `
            radial-gradient(circle at center, transparent 0%, #050b1a 80%),
            repeating-linear-gradient(0deg, #1e293b 0px, #1e293b 1px, transparent 1px, transparent 40px),
            repeating-linear-gradient(90deg, #1e293b 0px, #1e293b 1px, transparent 1px, transparent 40px)
          `,
        }}
      />

      {/* THREE.JS ACTIVE PERSPECTIVE IF PLAYING */}
      {isPlaying && !isTerminated && (
        <GrifballGame
          isPlaying={isPlaying}
          isPaused={isPaused}
          debugMode={debugMode}
          adminSettings={adminSettings}
          onStatsUpdate={handleStatsUpdate}
          onPauseToggle={handlePauseToggle}
          isMultiplayer={isMultiplayer}
          multiplayerRole={multiplayerRole}
          multiplayerSocket={multiplayerSocket}
        />
      )}

      {/* FIRST PERSON USER OVERLAY HEADS-UP-DISPLAY */}
      {isPlaying && (!isPaused || showUiAdjustment) && (
        <HUD 
          stats={currentStats}
          onPauseClick={handlePauseToggle}
          uiPositions={uiPositions}
          onUpdateUiPositions={handleUpdateUiPositions}
          isAdjustmentMode={showUiAdjustment}
        />
      )}

      {/* IN-GAME MULTIPLAYER CHAT PANEL */}
      {isPlaying && isMultiplayer && (
        <ChatOverlay 
          messages={chatMessages}
          onSendMessage={sendChatMessage}
          isMultiplayer={isMultiplayer}
          multiplayerRole={multiplayerRole}
        />
      )}

      {/* START MENU CONTROLLER SCREEN */}
      {!isPlaying && !isTerminated && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-xl p-4 md:p-8 transition-all duration-300 overflow-y-auto">
          <div className="w-full max-w-4xl bg-slate-900/40 border border-white/10 rounded-2xl p-6 md:p-10 backdrop-blur-md flex flex-col md:grid md:grid-cols-12 gap-8 shadow-2xl select-none max-h-[95vh] overflow-y-auto">
            
            {/* TAB SELECTOR HEADER - FULL SPAN */}
            <div className="col-span-12 flex flex-col sm:flex-row justify-between items-center gap-4 border-b border-white/10 pb-4 mb-2">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveMenuTab('single')}
                  className={`pb-2 px-4 font-bold text-xs uppercase tracking-widest border-b-2 transition-all cursor-pointer ${
                    activeMenuTab === 'single'
                      ? 'border-blue-500 text-white shadow-[inset_0_-8px_8px_-8px_rgba(56,189,248,0.3)]'
                      : 'border-transparent text-white/40 hover:text-white/70'
                  }`}
                >
                  🎮 Training Sandbox
                </button>
                <button
                  onClick={() => setActiveMenuTab('multi')}
                  className={`pb-2 px-4 font-bold text-xs uppercase tracking-widest border-b-2 transition-all cursor-pointer ${
                    activeMenuTab === 'multi'
                      ? 'border-[#38bdf8] text-white shadow-[inset_0_-8px_8px_-8px_rgba(56,189,248,0.3)]'
                      : 'border-transparent text-white/40 hover:text-white/70'
                  }`}
                >
                  📡 Direct IP Multiplayer (P2P)
                </button>
              </div>

              {/* Online Player Count */}
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold text-emerald-400">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                ONLINE PLAYERS: {onlineCount || 1}
              </div>
            </div>

            {/* COLUMN 1: BRANDING & PRIMARY ACTIONS (col-span-5) */}
            <div className="md:col-span-12 lg:col-span-5 flex flex-col justify-start text-center md:text-left h-full lg:min-h-[520px]">
              {/* Header / Title block */}
              <div className="mb-6">
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-sans font-black tracking-tighter italic text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 uppercase select-none">
                  GRIFPROTOTYPE
                </h1>
                <p className="text-[#38bdf8] tracking-[0.34em] uppercase text-[10px] md:text-xs mt-2 font-bold font-display select-none">
                  Voxel Combat Simulation
                </p>
                <div className="h-[2px] w-12 bg-[#38bdf8] mt-4 mx-auto md:mx-0 opacity-80" />
              </div>

              {activeMenuTab === 'single' ? (
                <>
                  <p className="text-white/60 text-xs md:text-sm leading-relaxed mb-6 md:max-w-xs text-left">
                    Welcome to the futuristic simulation battlefield. Grab your Grav Hammer and Energy Sword to train against tactical defensive AI bots in responsive first-person combat!
                  </p>
                  
                  {/* Primary Action Button Containers */}
                  <div className="w-full flex flex-col gap-3.5">
                    <button 
                      id="play-game-btn"
                      onClick={handleStartGame}
                      className="group relative w-full h-14 bg-white hover:bg-sky-400 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-2xl border border-white/20 select-none pointer-events-auto"
                    >
                      {/* Background hover dynamic animation slide */}
                      <div className="absolute inset-0 bg-blue-600 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300" />
                      <span className="relative z-10 text-slate-900 font-sans font-black text-sm uppercase tracking-widest group-hover:text-white pointer-events-none flex items-center gap-2">
                        Start Local Training
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                      </span>
                    </button>
                    
                    <button 
                      id="close-game-btn"
                      onClick={handleCloseGame}
                      className="w-full h-12 bg-white/5 border border-white/10 backdrop-blur-md flex items-center justify-center hover:bg-white/10 hover:border-white/25 active:scale-[0.99] transition-all cursor-pointer rounded pointer-events-auto select-none"
                    >
                      <span className="text-white/80 font-sans font-bold text-xs uppercase tracking-widest pointer-events-none">
                        Close Sandbox
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                  /* HIGH-TECH P2P DIRECT-IP MATCHMAKER INTERFACE */
                  <div className="w-full flex flex-col gap-4 text-left pointer-events-auto">
                    
                    {/* CONNECTION MODE SELECTOR */}
                    <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 gap-1 select-none">
                      <button
                        onClick={() => setConnectionMode('relay')}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
                          connectionMode === 'relay'
                            ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                            : 'text-white/40 hover:text-white/70'
                        }`}
                      >
                        🌐 Cloud Relay
                      </button>
                      <button
                        onClick={() => setConnectionMode('local')}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
                          connectionMode === 'local'
                            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                            : 'text-white/40 hover:text-white/70'
                        }`}
                      >
                        📶 Local LAN IP
                      </button>
                    </div>

                    {/* Your IP Block */}
                    <div className={connectionMode === 'relay' ? "bg-sky-500/5 border border-sky-500/20 rounded-lg p-3" : "bg-white/5 border border-white/10 rounded-lg p-3"}>
                      <p className="text-[10px] text-[#38bdf8] font-bold uppercase tracking-wider mb-2"> Your Connection Coordinates</p>
                      <div className="flex flex-col gap-1.5 font-mono text-xs font-semibold">
                        {connectionMode === 'relay' ? (
                          <div className="flex justify-between items-center bg-black/40 px-2.5 py-1.5 rounded border border-white/5">
                            <span className="text-white/45 uppercase text-[9px] font-bold font-sans">Relay Status:</span>
                            <span className="text-sky-400 font-extrabold flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse inline-block" /> ONLINE (SECURE)
                            </span>
                          </div>
                        ) : (
                          <div className="flex justify-between items-center bg-black/40 px-2.5 py-1.5 rounded border border-white/5">
                            <span className="text-white/45 uppercase text-[9px] font-bold">Web/Host IP:</span>
                            <span className="text-[#38bdf8] font-black">{userIp === '127.0.0.1' ? '127.0.0.1' : userIp}</span>
                          </div>
                        )}
                        {connectionMode === 'local' && lanIp && lanIp !== '127.0.0.1' && (
                          <div className="flex justify-between items-center bg-emerald-500/10 px-2.5 py-1.5 rounded border border-emerald-500/10">
                            <span className="text-emerald-400 uppercase text-[9px] font-bold">LAN Network IP:</span>
                            <span className="text-emerald-400 font-extrabold">{lanIp}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center bg-black/40 px-2.5 py-1.5 rounded border border-white/5">
                          <span className="text-white/45 uppercase text-[9px] font-bold">Room Code:</span>
                          <span className="text-amber-400 font-black tracking-widest">{hostIdCode}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-white/50 mt-2.5 leading-relaxed font-sans">
                        {connectionMode === 'relay' ? (
                          <>
                            📡 <strong>Cloud Relay:</strong> Bypasses restrictive firewalls and cellular CGNAT setups globally. No port-forwarding needed! Enter your partner's <strong>Room Code ({hostIdCode})</strong> below.
                          </>
                        ) : (
                          <>
                            📶 <strong>Local LAN:</strong> Pure local network. Ensure you're both connected to the same Wi-Fi router and run the game using standard <code>http://localhost:3000</code>.
                          </>
                        )}
                      </p>
                    </div>

                    {/* MATCHMAKING CONNECTION STATUS */}
                    {connectionStatus === 'hosting' && (
                      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex flex-col items-center justify-center text-center gap-1.5 animate-pulse">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                        <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Lobby Live & Broadcasting</p>
                        <p className="text-[10px] text-white/60">Awaiting target player to join match...</p>
                        <button
                          onClick={handleCancelHostOrJoin}
                          className="mt-2.5 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-[10px] font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer transition-all"
                        >
                          Cancel Broadcast
                        </button>
                      </div>
                    )}

                    {connectionStatus === 'connecting' && (
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex flex-col items-center justify-center text-center gap-1.5 animate-pulse">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
                        <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">Connecting Protocol</p>
                        <p className="text-[10px] text-white/60">Attaching to target host session...</p>
                        <button
                          onClick={handleCancelHostOrJoin}
                          className="mt-2.5 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-[10px] font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer transition-all"
                        >
                          Cancel Connection
                        </button>
                      </div>
                    )}

                    {/* NORMAL CONNECT/HOST ACTION KEYBOARD */}
                    {(connectionStatus === 'idle' || connectionStatus === 'error' || connectionStatus === 'fetching_ip') && (
                      <div className="flex flex-col gap-3.5">
                        {/* Host Event Button */}
                        <button
                          onClick={handleHostGame}
                          className="w-full h-11 bg-white hover:bg-emerald-500 text-slate-900 hover:text-white hover:border-emerald-400 font-sans font-black text-xs uppercase tracking-widest transition-all rounded shadow-lg border border-white/10 cursor-pointer flex items-center justify-center gap-2"
                        >
                          🎙️ Host New Match
                        </button>

                        <div className="flex items-center gap-2 py-0.5">
                          <hr className="flex-grow border-white/10" />
                          <span className="text-[9px] text-white/30 uppercase tracking-widest font-mono">OR DIRECT JOIN</span>
                          <hr className="flex-grow border-white/10" />
                        </div>

                        {/* Join Direct IP */}
                        <div className="flex flex-col gap-1.5">
                          <input
                            type="text"
                            value={joinIpOrId}
                            onChange={(e) => setJoinIpOrId(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleJoinGame(joinIpOrId);
                            }}
                            placeholder="Host IP address or Room Code..."
                            className="w-full h-11 bg-black/60 border border-white/10 rounded px-4 py-1 text-center font-mono text-sm tracking-wide text-[#38bdf8] placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all"
                          />
                          
                          <button
                            onClick={() => handleJoinGame(joinIpOrId)}
                            disabled={!joinIpOrId}
                            className={`w-full h-11 font-sans font-black text-xs uppercase tracking-widest rounded transition-all border outline-none ${
                              joinIpOrId 
                                ? 'bg-[#38bdf8]/15 hover:bg-[#38bdf8]/35 border-[#38bdf8]/50 text-[#38bdf8] cursor-pointer hover:shadow-[0_0_15px_rgba(56,189,248,0.25)]' 
                                : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                            }`}
                          >
                            ⚡ Direct Connect to match
                          </button>
                        </div>
                      </div>
                    )}

                    {/* error message logging */}
                    {connectionStatus === 'error' && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center mt-1">
                        <p className="text-[10px] text-red-400 font-black uppercase tracking-wider mb-0.5">⚠️ Sync Timeout</p>
                        <p className="text-[10px] text-white/70">{connectionError || 'Connection could not be established.'}</p>
                      </div>
                    )}

                    {/* List of Connected Clients */}
                    <div className="bg-slate-950/40 border border-white/10 rounded-lg p-3.5 mt-2 flex flex-col gap-2 h-[190px]">
                      <div className="flex justify-between items-center pb-2 border-b border-white/5 shrink-0">
                        <p className="text-[10px] text-[#38bdf8] font-black uppercase tracking-wider flex items-center gap-1.5">
                          <span className="w-1 px-1 h-2.5 bg-[#38bdf8] inline-block rounded-sm" />
                          Online Clients ({onlineClients.length})
                        </p>
                        {clientId && (
                          <span className="text-[9px] font-mono text-white/45 bg-white/5 px-2 py-0.5 rounded border border-white/5">
                            ID: {clientId}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2 pt-1 pr-1">
                        {onlineClients.length === 0 ? (
                          <p className="text-[10.5px] text-white/45 italic font-medium m-auto text-center py-4">No other players online yet.</p>
                        ) : (
                          onlineClients.map(client => (
                            <div key={client.id} className="flex justify-between items-center bg-black/45 px-3 py-2.5 rounded border border-white/5 text-xs font-mono shrink-0">
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-white/80 font-semibold truncate max-w-[130px]">
                                  Client {client.id}
                                </span>
                                {/* Player state indicator */}
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {client.state === 'menu' && (
                                    <span className="text-[9px] text-slate-400/80 font-bold uppercase tracking-wider flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                      In Menu
                                    </span>
                                  )}
                                  {client.state === 'solo' && (
                                    <span className="text-[9px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                      Solo Training
                                    </span>
                                  )}
                                  {client.state === 'multi' && (
                                    client.spaceAvailable ? (
                                      <button
                                        onClick={() => {
                                          if (client.roomCode) {
                                            handleJoinGame(client.roomCode);
                                          }
                                        }}
                                        title="Click to join this player's match"
                                        className="text-[9px] bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-400 font-bold uppercase tracking-wider px-2 py-0.5 rounded cursor-pointer transition-all flex items-center gap-1 animate-pulse hover:shadow-[0_0_8px_rgba(16,185,129,0.3)] active:scale-95 text-left"
                                      >
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping" />
                                        Match Open (Join)
                                      </button>
                                    ) : (
                                      <span className="text-[9px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        In Match (Full)
                                      </span>
                                    )
                                  )}
                                </div>
                              </div>
                              
                              {/* Actions (Invite button) */}
                              <div className="flex items-center gap-2 shrink-0">
                                {connectionStatus === 'hosting' && connectionMode === 'relay' && (
                                  <button
                                    onClick={() => {
                                      if (menuSocket && menuSocket.readyState === WebSocket.OPEN) {
                                        menuSocket.send(JSON.stringify({
                                          type: 'send_invite',
                                          targetId: client.id,
                                          roomCode: hostIdCode
                                        }));
                                        // notify host that invite was sent
                                        setInviteNotifications(prev => [
                                          ...prev,
                                          `Lobby invite dispatched to Client ${client.id}.`
                                        ]);
                                        setTimeout(() => {
                                          setInviteNotifications(prev => prev.filter(n => !n.includes(client.id)));
                                        }, 5000);
                                      }
                                    }}
                                    className="px-2 py-1 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-[10px] font-sans font-black uppercase tracking-wider text-white rounded cursor-pointer transition-all active:scale-95 border border-sky-400/20"
                                  >
                                    Invite
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                  </div>
                )}
            </div>

            {/* COLUMN 2: FULL COMPREHENSIVE HOTKEY DIRECTORY OR LOBBY CHAT (col-span-7) */}
            <div className="md:col-span-7 border-t md:border-t-0 md:border-l border-white/10 pt-6 md:pt-0 md:pl-8 flex flex-col min-h-[480px]">
              {/* Tabs header */}
              <div className="flex gap-4 border-b border-white/10 pb-3 mb-4 select-none shrink-0 flex-wrap">
                <button
                  onClick={() => setRightPanelTab('manual')}
                  className={`pb-1 font-sans font-bold text-xs uppercase tracking-widest border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                    rightPanelTab === 'manual'
                      ? 'border-[#38bdf8] text-white'
                      : 'border-transparent text-white/40 hover:text-white/70'
                  }`}
                >
                  📖 Combat Manual
                </button>
                <button
                  onClick={() => setRightPanelTab('customize')}
                  className={`pb-1 font-sans font-bold text-xs uppercase tracking-widest border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                    rightPanelTab === 'customize'
                      ? 'border-[#38bdf8] text-white'
                      : 'border-transparent text-white/40 hover:text-white/70'
                  }`}
                >
                  🎨 Customize Armor
                </button>
                <button
                  onClick={() => {
                    setRightPanelTab('chat');
                    setUnreadLobbyMessages(0);
                  }}
                  className={`pb-1 font-sans font-bold text-xs uppercase tracking-widest border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                    rightPanelTab === 'chat'
                      ? 'border-[#38bdf8] text-white'
                      : 'border-transparent text-white/40 hover:text-white/70'
                  }`}
                >
                  💬 Lobby Chat
                  {unreadLobbyMessages > 0 && (
                    <span className="bg-[#38bdf8] text-slate-950 font-black font-mono text-[9px] px-1.5 py-0.5 rounded-full animate-bounce">
                      {unreadLobbyMessages}
                    </span>
                  )}
                </button>
              </div>

              {rightPanelTab === 'manual' && (
                <div className="flex-grow flex flex-col justify-between min-h-0">
                  <div>
                    <div className="flex items-center gap-2 mb-4 shrink-0">
                      <span className="w-1.5 h-3 bg-[#38bdf8]" />
                      <h2 className="text-xs uppercase font-bold tracking-[0.25em] text-white">
                        Combat manual & Gameplay Hotkeys
                      </h2>
                    </div>

                    <div className="flex flex-col gap-4 font-sans text-xs">
                      
                      {/* Category: Movement */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-wider mb-2.5">Arena Navigation</p>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-white/80">
                          <div className="flex items-center gap-3">
                            <div className="flex gap-1">
                              <kbd className="min-w-6 h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[10px] shadow-sm select-none text-[#38bdf8]">W</kbd>
                              <kbd className="min-w-6 h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[10px] shadow-sm select-none text-[#38bdf8]">A</kbd>
                              <kbd className="min-w-6 h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[10px] shadow-sm select-none text-[#38bdf8]">S</kbd>
                              <kbd className="min-w-6 h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[10px] shadow-sm select-none text-[#38bdf8]">D</kbd>
                            </div>
                            <span className="text-white/60 text-[11px] font-medium">Move Combatant</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <kbd className="min-w-[4.5rem] h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[9px] shadow-sm select-none text-amber-500 uppercase">Space</kbd>
                            <span className="text-white/60 text-[11px] font-medium">Jump (Normal/Boost)</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <kbd className="min-w-6 h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[10px] shadow-sm select-none text-[#38bdf8]">Q</kbd>
                            <span className="text-white/60 text-[11px] font-medium">Sonic Dash (Evade)</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <kbd className="min-w-6 h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[10px] shadow-sm select-none text-[#38bdf8]">C</kbd>
                            <span className="text-white/60 text-[11px] font-medium">Crouch (Slide Profile)</span>
                          </div>
                        </div>
                      </div>

                      {/* Category: Weaponry */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-wider mb-2.5">Arsenal Control & Swapping</p>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-white/80">
                          <div className="flex items-center gap-3">
                            <div className="flex gap-1.5 items-center">
                              <kbd className="min-w-6 h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[10px] shadow-sm text-cyan-400">1</kbd>
                            </div>
                            <span className="text-white/60 text-[11px] font-medium">Equip Grav Hammer</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex gap-1.5 items-center">
                              <kbd className="min-w-6 h-6 bg-black/50 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[10px] shadow-sm text-purple-400">2</kbd>
                            </div>
                            <span className="text-white/60 text-[11px] font-medium">Equip Energy Sword</span>
                          </div>

                          <div className="flex items-center gap-3 col-span-2 border-t border-white/5 pt-2 mt-1">
                            <span className="text-amber-400 font-mono text-[9px] uppercase tracking-widest mr-1">Switch:</span>
                            <span className="text-white/70 text-[11px]">Use <kbd className="bg-black/30 px-1 border border-white/10 rounded font-bold text-[10px]">SCROLL WHEEL</kbd> to quickly cycle weapons anytime</span>
                          </div>
                        </div>
                      </div>

                      {/* Category: Offensive Actions */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-wider mb-2.5">Combat Techniques</p>
                        <div className="flex flex-col gap-2.5">
                          <div className="flex items-start gap-2.5 text-white/70">
                            <kbd className="min-w-[2.5rem] h-6 bg-cyan-950/40 border border-cyan-500/30 rounded flex items-center justify-center font-mono font-black text-[9px] shadow-sm text-cyan-400 select-none shrink-0">LMB</kbd>
                            <div>
                              <p className="text-[11px] text-white/90 font-bold"><strong className="text-cyan-400">Grav Slam</strong> (With Hammer)</p>
                              <p className="text-[10px] text-white/55">Blows back the ball, repels hostile bots, and deals massive radial kinetic shockwaves.</p>
                            </div>
                          </div>

                          <div className="flex items-start gap-2.5 text-white/70 border-t border-white/5 pt-2">
                            <kbd className="min-w-[2.5rem] h-6 bg-red-950/40 border border-red-500/30 rounded flex items-center justify-center font-mono font-black text-[9px] shadow-sm text-red-400 select-none shrink-0">LMB</kbd>
                            <div>
                              <p className="text-[11px] text-white/90 font-bold"><strong className="text-red-400">Assault Lunge</strong> (With Sword + Red Reticle)</p>
                              <p className="text-[10px] text-white/55">Dashes directly to targeted enemies instantly with high locking distance velocity.</p>
                            </div>
                          </div>

                          <div className="flex items-start gap-2.5 text-white/70 border-t border-white/5 pt-2">
                            <kbd className="min-w-[2.5rem] h-6 bg-purple-950/40 border border-purple-500/30 rounded flex items-center justify-center font-mono font-black text-[9px] shadow-sm text-purple-400 select-none shrink-0">RMB</kbd>
                            <div>
                              <p className="text-[11px] text-white/90 font-bold"><strong className="text-purple-400">Quick Slash</strong> (With Sword)</p>
                              <p className="text-[10px] text-white/55">Swipes front arc swiftly for close-quarters counter attacks without lock-on requirements.</p>
                            </div>
                          </div>

                          {/* Special Combo */}
                          <div className="flex items-center gap-2 border-t border-amber-500/10 bg-amber-500/5 p-2 rounded mt-1">
                            <span className="text-amber-500 text-[12px] font-bold select-none">🔥 Combo:</span>
                            <span className="text-white/80 text-[10px]">
                              <strong>Hammer Jump</strong>: Left Click to swing Hammer, then immediately press <kbd className="bg-black/30 px-1 font-bold rounded">SPACE</kbd> to launch high up!
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Category: System */}
                      <div className="flex items-center justify-between px-3 py-2 border-t border-white/5 mt-1 font-mono text-[10px] text-white/40 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <kbd className="min-w-6 h-5 bg-black/60 border border-white/20 rounded flex items-center justify-center font-mono font-bold text-[9px] shadow-sm text-amber-500">ESC</kbd>
                          <span>PAUSE & LIGHTING SETTINGS</span>
                        </div>
                        <span>VERSION 1.4 PROTOTYPE</span>
                      </div>

                    </div>
                  </div>
                </div>
              )}

              {rightPanelTab === 'customize' && (
                <div className="flex-grow flex flex-col justify-between min-h-0 bg-slate-950/20 rounded-xl border border-white/5 p-4 md:p-5 select-none">
                  <div className="flex flex-col gap-4">
                    {/* Header */}
                    <div className="flex justify-between items-center pb-2 border-b border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-3 bg-[#38bdf8]" />
                        <h2 className="text-xs uppercase font-bold tracking-[0.25em] text-white">
                          Character Customizer & Armor Hue
                        </h2>
                      </div>
                      <span className="text-[9px] font-mono text-emerald-400 font-extrabold uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                        Visualizing 3D
                      </span>
                    </div>

                    {/* 3D Model Rotating Preview */}
                    <CharacterPreview hue={adminSettings.playerHue ?? 200} heldWeapon={customizerWeapon} />

                    {/* Controls Grid */}
                    <div className="flex flex-col gap-3 font-sans text-xs">
                      {/* Interactive HSL slider */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-wider">Armor Color Hue angle</span>
                          <span 
                            className="font-mono text-[10px] font-black uppercase px-2 py-0.5 rounded border shadow"
                            style={{ 
                              color: `hsl(${adminSettings.playerHue}, 100%, 65%)`,
                              backgroundColor: `hsl(${adminSettings.playerHue}, 90%, 12%)`,
                              borderColor: `hsl(${adminSettings.playerHue}, 50%, 30%)`
                            }}
                          >
                            {adminSettings.playerHue}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="360"
                          value={adminSettings.playerHue ?? 200}
                          onChange={(e) => {
                            const newHue = parseInt(e.target.value, 10);
                            setAdminSettings(prev => ({ ...prev, playerHue: newHue }));
                            try {
                              localStorage.setItem('grifball_player_hue', newHue.toString());
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="w-full h-2 bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-cyan-500 via-blue-500 via-purple-500 to-red-500 rounded-lg appearance-none cursor-pointer outline-none"
                          style={{ WebkitAppearance: 'none' }}
                        />
                      </div>

                      {/* Presets */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                        <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Color presets Swatches</span>
                        <div className="flex flex-wrap gap-2 justify-between">
                          {[
                            { name: 'Red', hue: 0, bg: 'bg-[#ef4444]' },
                            { name: 'Orange', hue: 20, bg: 'bg-[#f97316]' },
                            { name: 'Gold', hue: 45, bg: 'bg-[#fbbf24]' },
                            { name: 'Green', hue: 120, bg: 'bg-[#22c55e]' },
                            { name: 'Cyan', hue: 180, bg: 'bg-[#06b6d4]' },
                            { name: 'Blue', hue: 200, bg: 'bg-[#3b82f6]' },
                            { name: 'Purple', hue: 270, bg: 'bg-[#a855f7]' },
                            { name: 'Magenta', hue: 300, bg: 'bg-[#d946ef]' },
                            { name: 'Pink', hue: 330, bg: 'bg-[#ec4899]' },
                          ].map((p) => (
                            <button
                              key={p.name}
                              onClick={() => {
                                setAdminSettings(prev => ({ ...prev, playerHue: p.hue }));
                                try {
                                  localStorage.setItem('grifball_player_hue', p.hue.toString());
                                } catch (err) {
                                  console.error(err);
                                }
                              }}
                              title={p.name}
                              className={`w-6 h-6 rounded-full cursor-pointer transition-all active:scale-90 relative ${p.bg} ${
                                adminSettings.playerHue === p.hue 
                                  ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-950 scale-110 shadow-lg' 
                                  : 'hover:scale-105 hover:opacity-90'
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Held Weapon Selection */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                        <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-wider block mb-2.5">Pose Weapon preview</span>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { id: 'none', label: '🛡️ Fists' },
                            { id: 'hammer', label: '🔨 Hammer' },
                            { id: 'sword', label: '⚔️ Sword' },
                          ].map((w) => (
                            <button
                              key={w.id}
                              onClick={() => setCustomizerWeapon(w.id as any)}
                              className={`py-2 text-[10px] font-black uppercase tracking-wider border rounded cursor-pointer transition-all active:scale-98 ${
                                customizerWeapon === w.id
                                  ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                                  : 'bg-black/30 border-white/10 text-white/50 hover:text-white hover:border-white/20'
                              }`}
                            >
                              {w.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {rightPanelTab === 'chat' && (
                <LobbyChatPanel
                  messages={lobbyChatMessages}
                  onSendMessage={sendLobbyChatMessage}
                />
              )}
            </div>

          </div>
        </div>
      )}

      {/* TERMINATED STATE OVERLAY SCREEN */}
      {isTerminated && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-2xl transition-all duration-300">
          <div className="w-full max-w-sm text-center px-4">
            <div className="w-16 h-16 rounded-full border border-red-500/30 flex items-center justify-center bg-red-950/30 mx-auto mb-6">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            
            <h2 className="text-3xl font-display font-black uppercase tracking-wider mb-2 text-red-400">
              SIMULATION CLOSED
            </h2>
            <p className="text-sm text-white/60 mb-8 leading-relaxed">
              The Grifball VR Sandbox prototype is offline. You can relaunch the client by clicking the button below.
            </p>

            <button 
              id="reboot-sim-btn"
              onClick={handleStartGame}
              className="px-8 py-3.5 bg-blue-600 rounded text-xs select-none hover:bg-blue-500 active:scale-95 border border-blue-400/30 font-black tracking-widest uppercase transition-all duration-150 cursor-pointer pointer-events-auto"
            >
              Reboot Simulation
            </button>
          </div>
        </div>
      )}

      {/* PAUSE DRAWER MODAL COVER (FROSTED GLASS PANEL OVERLAY) */}
      {isPaused && isPlaying && !showUiAdjustment && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-xl transition-all duration-300">
          {!showAdminPanel && !showLightingMenu ? (
            <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl p-8 w-[380px] shadow-2xl flex flex-col items-center select-none">
              {/* Logo header */}
              <div className="text-center mb-8 border-b border-white/5 pb-5 w-full">
                <p className="text-[10px] text-blue-400 font-bold tracking-[0.3em] uppercase mb-1 font-display">SIMULATION PAUSED</p>
                <h3 className="text-3xl font-sans font-black tracking-tighter italic uppercase text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-300">
                  GRIFVX PROTO
                </h3>
              </div>
 
              {/* Primary Pause utility actions */}
              <div className="w-full flex flex-col gap-3.5 pointer-events-auto">
                <button 
                  id="resume-btn"
                  onClick={handleResumeGame}
                  className="w-full h-12 bg-white text-slate-900 font-bold text-sm uppercase tracking-widest hover:bg-blue-400 hover:text-white active:scale-98 transition-all duration-150 cursor-pointer rounded"
                >
                  Resume Game
                </button>

                {/* UI ADJUSTMENT CONTROLLER BUTTON */}
                <button 
                  id="ui-adjustment-btn"
                  onClick={() => setShowUiAdjustment(true)}
                  className="w-full h-12 bg-cyan-950/30 hover:bg-cyan-900/40 border border-cyan-500/30 text-cyan-400 hover:text-cyan-200 font-bold text-xs uppercase tracking-widest transition-all cursor-pointer rounded flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                  UI Adjustment
                </button>

                {/* LIGHTING & SHADOWS CONTROLLER BUTTON */}
                <button 
                  id="lighting-controls-btn"
                  onClick={() => setShowLightingMenu(true)}
                  className="w-full h-12 bg-amber-950/30 hover:bg-amber-900/40 border border-amber-500/30 text-amber-400 font-bold text-xs uppercase tracking-widest transition-all cursor-pointer rounded flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m11.314 11.314l.707-.707M12 17a5 5 0 100-10 5 5 0 000 10z" />
                  </svg>
                  Lighting & Shadows
                </button>
 
                {/* ADMIN CONTROLLER TOGGLE BUTTON */}
                <button 
                  id="admin-controls-btn"
                  onClick={() => setShowAdminPanel(true)}
                  className="w-full h-12 bg-[#38bdf8]/10 hover:bg-[#38bdf8]/20 border border-[#38bdf8]/30 text-[#38bdf8] font-bold text-xs uppercase tracking-widest transition-all cursor-pointer rounded flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4 animate-spin-slow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Admin Controls
                </button>

                <button 
                  id="reset-match-btn"
                  onClick={handleResetMatch}
                  className="w-full h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs uppercase tracking-widest transition-all cursor-pointer rounded"
                >
                  Reset Match
                </button>

                {/* Debug toggle controls */}
                <button 
                  id="toggle-debug-btn"
                  onClick={toggleDebugMode}
                  className={`w-full h-12 border rounded font-semibold text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    debugMode 
                      ? 'bg-red-500/20 border-red-500 text-red-200 hover:bg-red-500/30' 
                      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${debugMode ? 'bg-red-500 shadow-[0_0_8px_red]' : 'bg-white/30'}`} />
                  {debugMode ? 'DISABLE DAMAGE TRACES' : 'ENABLE DAMAGE TRACES'}
                </button>

                <button 
                  id="quit-btn"
                  onClick={handleReturnToMain}
                  className="w-full h-12 bg-red-950/30 border border-red-500/20 hover:bg-red-950/50 text-red-400 font-bold text-xs uppercase tracking-widest transition-all cursor-pointer rounded mt-3"
                >
                  Quit to Title Screen
                </button>
              </div>

              {/* Tiny escape instructions */}
              <p className="mt-6 text-[9px] text-white/50 tracking-wider">
                Press <span className="font-mono text-[10px] text-blue-400 font-bold">ESC</span> inside game window to pause/unpause
              </p>
            </div>
          ) : showAdminPanel ? (
            /* ADMIN CONTROLS MULTIPANEL DENSE DASHBOARD */
            <div className="bg-slate-950/95 border border-white/10 backdrop-blur-2xl rounded-2xl p-5 w-[940px] max-w-[95vw] shadow-2xl flex flex-col select-none max-h-[95vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
                <div className="flex flex-col items-start text-left">
                  <p className="text-[9px] text-[#38bdf8] font-bold tracking-[0.3em] uppercase mb-0.5 font-display">SYSTEM OVERRIDE</p>
                  <h3 className="text-xl font-sans font-black tracking-tight uppercase text-white">
                    Admin Controls
                  </h3>
                </div>
                <div className="text-[10px] text-white/50 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 font-mono">
                  Press ESC to close
                </div>
              </div>

              {/* 3-Column Dense Settings Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pointer-events-auto mb-5 text-left">
                
                {/* COLUMN 1: LOCOMOTION, ACTIONS & HEALTH */}
                <div className="flex flex-col gap-3">
                  
                  {/* General Configuration */}
                  <div className="border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2">
                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono">1. Health & Protection</p>
                    
                    {/* Universal HP */}
                    <div className="flex items-center justify-between text-xs py-0.5">
                      <div className="flex flex-col">
                        <span className="font-bold text-white/90">Universal HP</span>
                        <span className="text-[9px] text-white/40">Hits needed to kill</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button 
                          onClick={() => setAdminSettings(prev => ({ ...prev, maxHP: Math.max(1, prev.maxHP - 1) }))}
                          className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
                        >
                          -
                        </button>
                        <span className="font-mono text-xs font-bold text-[#38bdf8] w-12 text-center bg-black/40 py-0.5 rounded border border-white/5">
                          {adminSettings.maxHP} HP
                        </span>
                        <button 
                          onClick={() => setAdminSettings(prev => ({ ...prev, maxHP: Math.min(100, prev.maxHP + 1) }))}
                          className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Spawn Invulnerability Window */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
                      <div className="flex flex-col">
                        <span className="font-bold text-white/90">Spawn Shield</span>
                        <span className="text-[9px] text-white/40">Protection duration</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button 
                          onClick={() => setAdminSettings(prev => ({ ...prev, respawnInvulnerabilityDuration: Math.max(0.0, parseFloat((prev.respawnInvulnerabilityDuration - 0.1).toFixed(1))) }))}
                          className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
                          title="Decrease Duration"
                        >
                          -
                        </button>
                        <span className="font-mono text-xs font-bold text-[#38bdf8] w-12 text-center bg-black/40 py-0.5 rounded border border-white/5">
                          {adminSettings.respawnInvulnerabilityDuration.toFixed(1)}s
                        </span>
                        <button 
                          onClick={() => setAdminSettings(prev => ({ ...prev, respawnInvulnerabilityDuration: Math.min(5.0, parseFloat((prev.respawnInvulnerabilityDuration + 0.1).toFixed(1))) }))}
                          className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
                          title="Increase Duration"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Velocity Modifiers */}
                  <div className="border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5">
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono">2. Velocity Modifiers</p>
                    
                    {/* Forward Speed */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Forward Speed</span>
                        <span className="text-[#38bdf8] font-mono">{adminSettings.speedForward}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="20" 
                        max="300" 
                        value={adminSettings.speedForward} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, speedForward: parseInt(e.target.value) }))}
                        className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Side Speed */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Strafe Speed</span>
                        <span className="text-[#38bdf8] font-mono">{adminSettings.speedSide}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="20" 
                        max="300" 
                        value={adminSettings.speedSide} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, speedSide: parseInt(e.target.value) }))}
                        className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Backward Speed */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Backward Speed</span>
                        <span className="text-[#38bdf8] font-mono">{adminSettings.speedBackward}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="20" 
                        max="300" 
                        value={adminSettings.speedBackward} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, speedBackward: parseInt(e.target.value) }))}
                        className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Dash Evades */}
                  <div className="border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5">
                    <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono">3. Dash Thrusters</p>
                    
                    {/* Dash Distance */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Dash Distance</span>
                        <span className="text-[#38bdf8] font-mono">{adminSettings.dashDistance.toFixed(1)}m</span>
                      </div>
                      <input 
                        type="range" 
                        min="2.0" 
                        max="15.0" 
                        step="0.1"
                        value={adminSettings.dashDistance} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, dashDistance: parseFloat(e.target.value) }))}
                        className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Dash Duration */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Dash Travel Time</span>
                        <span className="text-[#38bdf8] font-mono">{adminSettings.dashDuration.toFixed(2)}s</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.10" 
                        max="1.00" 
                        step="0.05"
                        value={adminSettings.dashDuration} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, dashDuration: parseFloat(e.target.value) }))}
                        className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Dash Cooldown */}
                    <div className="flex justify-between items-center text-xs pt-1 border-t border-white/5">
                      <div className="flex flex-col">
                        <span className="font-bold text-white/90">Dash Cooldown</span>
                        <span className="text-[9px] text-white/40">Time between boosts</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button 
                          onClick={() => setAdminSettings(prev => ({ ...prev, dashCooldown: Math.max(0.5, parseFloat((prev.dashCooldown - 0.1).toFixed(1))) }))}
                          className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
                          title="Decrease Cooldown"
                        >
                          -
                        </button>
                        <span className="font-mono text-xs font-bold text-[#38bdf8] w-12 text-center bg-black/40 py-0.5 rounded border border-white/5">
                          {adminSettings.dashCooldown.toFixed(1)}s
                        </span>
                        <button 
                          onClick={() => setAdminSettings(prev => ({ ...prev, dashCooldown: Math.min(10.0, parseFloat((prev.dashCooldown + 0.1).toFixed(1))) }))}
                          className="w-7 h-7 rounded bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center font-bold text-sm transition-all cursor-pointer select-none"
                          title="Increase Cooldown"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* COLUMN 2: GRAVITY HAMMER & JUMPING */}
                <div className="flex flex-col gap-3">
                  
                  {/* Hammer Combat */}
                  <div className="border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5">
                    <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono">4. Gravity Hammer</p>
                    
                    {/* Attack Range */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Shockwave Reach</span>
                        <span className="text-amber-400 font-mono">{adminSettings.attackRange.toFixed(1)}m</span>
                      </div>
                      <input 
                        type="range" 
                        min="1.0" 
                        max="10.0" 
                        step="0.1"
                        value={adminSettings.attackRange} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, attackRange: parseFloat(e.target.value) }))}
                        className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Attack Sphere size */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Sphere Blast Radius</span>
                        <span className="text-amber-400 font-mono">{adminSettings.attackRadius.toFixed(1)}m</span>
                      </div>
                      <input 
                        type="range" 
                        min="1.0" 
                        max="15.0" 
                        step="0.1"
                        value={adminSettings.attackRadius} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, attackRadius: parseFloat(e.target.value) }))}
                        className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Hammer Reload Time */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Hammer Recovery Delay</span>
                        <span className="text-amber-400 font-mono">{adminSettings.hammerReloadTime.toFixed(1)}s</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="5.0" 
                        step="0.1"
                        value={adminSettings.hammerReloadTime} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, hammerReloadTime: parseFloat(e.target.value) }))}
                        className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Hammer Jumping */}
                  <div className="border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5">
                    <p className="text-[10px] text-yellow-400 font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono">5. Gravity Launch Jump</p>
                    
                    {/* Jump Power */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Launch Upwards Boost</span>
                        <span className="text-yellow-400 font-mono">+{adminSettings.hammerJumpPower.toFixed(1)} m/s</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.0" 
                        max="15.0" 
                        step="0.5"
                        value={adminSettings.hammerJumpPower} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, hammerJumpPower: parseFloat(e.target.value) }))}
                        className="w-full accent-yellow-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Trigger Radius */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Ground Trigger Zone</span>
                        <span className="text-yellow-400 font-mono">{adminSettings.hammerJumpTriggerRadius.toFixed(1)}m</span>
                      </div>
                      <input 
                        type="range" 
                        min="1.0" 
                        max="10.0" 
                        step="0.1"
                        value={adminSettings.hammerJumpTriggerRadius} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, hammerJumpTriggerRadius: parseFloat(e.target.value) }))}
                        className="w-full accent-yellow-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Jump Window */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Timing Trigger Window</span>
                        <span className="text-yellow-400 font-mono">{adminSettings.hammerJumpWindow.toFixed(2)}s</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.10" 
                        max="2.00" 
                        step="0.05"
                        value={adminSettings.hammerJumpWindow} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, hammerJumpWindow: parseFloat(e.target.value) }))}
                        className="w-full accent-yellow-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Ground zone visualization toggle */}
                    <div className="flex justify-between items-center text-xs pt-1 border-t border-white/5">
                      <div className="flex flex-col">
                        <span className="font-bold text-white/90 font-mono text-[10px]">Draw Blast Zone Ring</span>
                        <span className="text-[9px] text-white/40 font-mono">Render circle on ground</span>
                      </div>
                      <button 
                        onClick={() => setAdminSettings(prev => ({ ...prev, visualizeJumpZone: !prev.visualizeJumpZone }))}
                        className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          adminSettings.visualizeJumpZone ? 'bg-yellow-400' : 'bg-white/10'
                        }`}
                      >
                        <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-slate-900 shadow transition duration-200 ease-in-out ${
                          adminSettings.visualizeJumpZone ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* COLUMN 3: ENERGY SWORD & TRADING CONFIGS */}
                <div className="flex flex-col gap-3">
                  
                  {/* Energy Sword */}
                  <div className="border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5">
                    <p className="text-[10px] text-[#22d3ee] font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono">6. Energy Sword</p>
                    
                    {/* Lunge Distance */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Lunge Distance (Red Reticle)</span>
                        <span className="text-[#22d3ee] font-mono">{adminSettings.swordLungeDistance.toFixed(1)}m</span>
                      </div>
                      <input 
                        type="range" 
                        min="1.0" 
                        max="25.0" 
                        step="0.5"
                        value={adminSettings.swordLungeDistance} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, swordLungeDistance: parseFloat(e.target.value) }))}
                        className="w-full accent-[#22d3ee] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Lunge Speed */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Lunge Glide Velocity</span>
                        <span className="text-[#22d3ee] font-mono">{adminSettings.swordLungeSpeed.toFixed(1)}m/s</span>
                      </div>
                      <input 
                        type="range" 
                        min="5.0" 
                        max="50.0" 
                        step="1.0"
                        value={adminSettings.swordLungeSpeed} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, swordLungeSpeed: parseFloat(e.target.value) }))}
                        className="w-full accent-[#22d3ee] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Row of quick values */}
                    <div className="grid grid-cols-2 gap-2 text-[10px] pt-1.5 border-t border-white/5">
                      <div>
                        <span className="text-white/40 block uppercase tracking-wider">Slash Duration</span>
                        <input 
                          type="range" 
                          min="0.05" 
                          max="1.00" 
                          step="0.01"
                          value={adminSettings.swordSlashSpeed} 
                          onChange={(e) => setAdminSettings(prev => ({ ...prev, swordSlashSpeed: parseFloat(e.target.value) }))}
                          className="w-full accent-[#22d3ee] h-1 mt-1 bg-white/10 rounded appearance-none cursor-pointer"
                        />
                        <span className="text-[#22d3ee] font-mono mt-0.5 block">{adminSettings.swordSlashSpeed.toFixed(2)}s</span>
                      </div>
                      <div>
                        <span className="text-white/40 block uppercase tracking-wider">Slash Reload</span>
                        <input 
                          type="range" 
                          min="0.1" 
                          max="3.0" 
                          step="0.1"
                          value={adminSettings.swordSlashReload} 
                          onChange={(e) => setAdminSettings(prev => ({ ...prev, swordSlashReload: parseFloat(e.target.value) }))}
                          className="w-full accent-[#22d3ee] h-1 mt-1 bg-white/10 rounded appearance-none cursor-pointer"
                        />
                        <span className="text-[#22d3ee] font-mono mt-0.5 block">{adminSettings.swordSlashReload.toFixed(1)}s</span>
                      </div>
                    </div>

                    {/* Lunge Reload */}
                    <div className="flex flex-col gap-1 pt-1.5 border-t border-white/5">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Lunge Recovery Delay</span>
                        <span className="text-[#22d3ee] font-mono">{adminSettings.swordLungeReload.toFixed(1)}s</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="5.0" 
                        step="0.1"
                        value={adminSettings.swordLungeReload} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, swordLungeReload: parseFloat(e.target.value) }))}
                        className="w-full accent-[#22d3ee] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Weapon Trading Controls Section (New!) */}
                  <div className="border border-red-900/30 rounded-xl p-2.5 bg-red-950/10 flex flex-col gap-2 border-red-500/20 shadow-[inset_0_0_12px_rgba(239,68,68,0.05)]">
                    <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest border-b border-red-500/20 pb-1 font-mono flex items-center justify-between">
                      <span>7. Combat Trades</span>
                      <span className="text-[8px] bg-red-500/20 text-red-300 px-1.5 py-0.2 rounded font-sans tracking-normal uppercase border border-red-500/30">Lethal window</span>
                    </p>
                    
                    {/* Sword vs Sword Group */}
                    <div className="flex flex-col gap-1 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-white/90">Sword vs. Sword Trades</span>
                        <button 
                          onClick={() => setAdminSettings(prev => ({ ...prev, enableSwordTrade: !prev.enableSwordTrade }))}
                          className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            adminSettings.enableSwordTrade ? 'bg-red-500' : 'bg-white/10'
                          }`}
                        >
                          <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-slate-900 shadow transition duration-200 ease-in-out ${
                            adminSettings.enableSwordTrade ? 'translate-x-4' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                      {adminSettings.enableSwordTrade && (
                        <div className="flex flex-col gap-0.5 mt-0.5 bg-black/30 p-1.5 rounded animate-fade-in border border-white/5">
                          <div className="flex justify-between text-[10px] text-white/60">
                            <span>Sword Trade Timing</span>
                            <span className="text-red-400 font-mono font-bold">{adminSettings.swordTradeWindow} ms</span>
                          </div>
                          <input 
                            type="range" 
                            min="50" 
                            max="1000" 
                            step="10"
                            value={adminSettings.swordTradeWindow} 
                            onChange={(e) => setAdminSettings(prev => ({ ...prev, swordTradeWindow: parseInt(e.target.value) }))}
                            className="w-full accent-red-500 h-1 bg-white/10 rounded appearance-none cursor-pointer"
                          />
                        </div>
                      )}
                    </div>

                    {/* Hammer vs Sword Group */}
                    <div className="flex flex-col gap-1 text-xs pt-1.5 border-t border-red-500/10">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-white/90">Hammer vs. Sword Trades</span>
                        <button 
                          onClick={() => setAdminSettings(prev => ({ ...prev, enableHammerSwordTrade: !prev.enableHammerSwordTrade }))}
                          className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            adminSettings.enableHammerSwordTrade ? 'bg-red-500' : 'bg-white/10'
                          }`}
                        >
                          <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-slate-900 shadow transition duration-200 ease-in-out ${
                            adminSettings.enableHammerSwordTrade ? 'translate-x-4' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                      {adminSettings.enableHammerSwordTrade && (
                        <div className="flex flex-col gap-0.5 mt-0.5 bg-black/30 p-1.5 rounded animate-fade-in border border-white/5">
                          <div className="flex justify-between text-[10px] text-white/60">
                            <span>Hammer/Lunge Trade Timing</span>
                            <span className="text-red-400 font-mono font-bold">{adminSettings.hammerSwordTradeWindow} ms</span>
                          </div>
                          <input 
                            type="range" 
                            min="50" 
                            max="1000" 
                            step="10"
                            value={adminSettings.hammerSwordTradeWindow} 
                            onChange={(e) => setAdminSettings(prev => ({ ...prev, hammerSwordTradeWindow: parseInt(e.target.value) }))}
                            className="w-full accent-red-500 h-1 bg-white/10 rounded appearance-none cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>

              {/* Close and return */}
              <button 
                id="apply-admin-btn"
                onClick={() => setShowAdminPanel(false)}
                className="w-full h-11 bg-white hover:bg-sky-400 hover:text-white text-slate-900 text-xs font-black uppercase tracking-widest rounded cursor-pointer transition-colors active:scale-98 flex items-center justify-center gap-2 shadow-lg"
              >
                <Check className="w-4 h-4" />
                Apply Changes & Resume Sandbox
              </button>
            </div>
          ) : (
            /* LIGHTING CONTROLS SLIDERS CONTAINER */
            <div className="bg-slate-950/90 border border-white/10 backdrop-blur-2xl rounded-2xl p-6 w-[400px] max-w-full shadow-2xl flex flex-col select-none">
              {/* Header */}
              <div className="text-center mb-6 border-b border-white/5 pb-4">
                <p className="text-[9px] text-amber-400 font-bold tracking-[0.3em] uppercase mb-1 font-display">ATMOSPHERE & CONFIG</p>
                <h3 className="text-2xl font-sans font-black tracking-tight uppercase text-white">
                  Lighting & Shadows
                </h3>
              </div>

              {/* Sliders list */}
              <div className="flex flex-col gap-6 pointer-events-auto mb-6">
                
                {/* Exposure / Sunlight Intensity */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <span>Direct Sunlight Intensity</span>
                    <span className="text-amber-400 font-mono">{adminSettings.directLightIntensity.toFixed(2)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="4.0" 
                    step="0.05"
                    value={adminSettings.directLightIntensity} 
                    onChange={(e) => setAdminSettings(prev => ({ ...prev, directLightIntensity: parseFloat(e.target.value) }))}
                    className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-white/40">Adjusts direct light intensity / exposure (increases general brightness).</p>
                </div>

                {/* Ambient Soft Fill (Shadow Harshness) */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <span>Shadow Softness (Ambient Fill)</span>
                    <span className="text-amber-400 font-mono">{adminSettings.ambientLightIntensity.toFixed(2)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="3.5" 
                    step="0.05"
                    value={adminSettings.ambientLightIntensity} 
                    onChange={(e) => setAdminSettings(prev => ({ ...prev, ambientLightIntensity: parseFloat(e.target.value) }))}
                    className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-white/40">Fills in shadowed regions to make them brighter and softer.</p>
                </div>

                {/* Skybox Brightness slider */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <span>Skybox & Fog Brightness</span>
                    <span className="text-amber-400 font-mono">{adminSettings.skyboxBrightness}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    step="1"
                    value={adminSettings.skyboxBrightness} 
                    onChange={(e) => setAdminSettings(prev => ({ ...prev, skyboxBrightness: parseInt(e.target.value) }))}
                    className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-white/40">Adjusts background depth brightness and matching volumetric foggy horizon.</p>
                </div>

                {/* Skybox Color Hue slider */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <div className="flex items-center gap-2">
                      <span>Skybox & Fog Color Hue</span>
                      <div 
                        className="w-4 h-4 rounded-full border border-white/20 shadow-inner" 
                        style={{ backgroundColor: `hsl(${adminSettings.skyboxHue}, 70%, ${Math.max(25, adminSettings.skyboxBrightness)}%)` }} 
                        title="Selected color color preview"
                      />
                    </div>
                    <span className="text-amber-400 font-mono">{adminSettings.skyboxHue}°</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="360" 
                    step="1"
                    value={adminSettings.skyboxHue} 
                    onChange={(e) => setAdminSettings(prev => ({ ...prev, skyboxHue: parseInt(e.target.value) }))}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
                    style={{
                      background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
                    }}
                  />
                  <p className="text-[10px] text-white/40">Rotate color hue to select sky atmospheric styling (eg. Blue, Neon Cyan, Purple, Crimson, Amber).</p>
                </div>

              </div>

              {/* Button to close and return */}
              <button 
                id="apply-lighting-btn"
                onClick={() => setShowLightingMenu(false)}
                className="w-full h-11 bg-white text-slate-900 hover:bg-amber-400 hover:text-white text-xs font-black uppercase tracking-widest rounded cursor-pointer transition-colors active:scale-98"
              >
                Apply & Return
              </button>
            </div>
          )}
        </div>
      )}

      {/* FLOATING ACTION TOOLBAR DURING UI CUSTOMIZATION MODE */}
      {showUiAdjustment && (
        <div className="absolute top-6 left-1/2 -track-x-1/2 -translate-x-1/2 z-50 bg-slate-950/90 border border-cyan-500/50 backdrop-blur-md rounded-xl p-4 shadow-2xl flex items-center gap-6 pointer-events-auto max-w-[90vw] select-none">
          <div className="flex flex-col">
            <h4 className="text-xs font-sans font-black tracking-widest text-cyan-400 uppercase">HUD Canvas Adjuster</h4>
            <p className="text-[10px] text-white/55 font-medium">Click UNLOCKED on an element to drag it. Click LOCK/UNLOCK to toggle attributes.</p>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              id="ui-adjustment-reset"
              onClick={handleResetUiPositions}
              className="px-3 py-1.5 bg-slate-900 border border-slate-700 hover:border-slate-600 text-[10px] font-mono font-bold tracking-widest uppercase transition-all duration-150 rounded cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              Reset
            </button>

            <button 
              id="ui-adjustment-save"
              onClick={() => setShowUiAdjustment(false)}
              className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border border-cyan-400/30 text-[10px] font-sans font-extrabold tracking-widest uppercase text-white transition-all duration-150 rounded shadow-[0_0_15px_rgba(6,182,212,0.3)] cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Save & Exit
            </button>
          </div>
        </div>
      )}

      {/* DIRECT MULTIPLAYER INVITE POPUP MODAL */}
      {activeInvite && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 select-none">
          <div className="w-full max-w-sm bg-slate-900 border border-sky-500/35 rounded-2xl p-6 shadow-2xl text-center flex flex-col gap-5">
            <div className="flex justify-center flex-col items-center gap-1">
              <span className="text-[10px] text-[#38bdf8] font-bold uppercase tracking-[0.2em] mb-1">Combat Invitation</span>
              <div className="w-12 h-12 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mb-2">
                <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-black tracking-tight text-white uppercase font-display">Match invite received!</h3>
            </div>
            
            <p className="text-xs text-white/70 leading-relaxed">
              Client <strong className="text-amber-400 font-mono text-sm font-black">{activeInvite.fromId}</strong> has invited you. Do you join?
            </p>
            
            <div className="flex gap-4 mt-2">
              <button
                onClick={() => {
                  const roomToJoin = activeInvite.roomCode;
                  setActiveInvite(null);
                  setConnectionMode('relay'); // force relay connection
                  handleJoinGame(roomToJoin);
                }}
                className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-xs text-white uppercase font-black tracking-widest transition-all rounded-lg border border-emerald-400/20 shadow-lg cursor-pointer flex items-center justify-center gap-2"
              >
                🎮 Yes
              </button>
              <button
                onClick={() => {
                  if (menuSocket && menuSocket.readyState === WebSocket.OPEN) {
                    menuSocket.send(JSON.stringify({
                      type: 'decline_invite',
                      targetId: activeInvite.fromId
                    }));
                  }
                  setActiveInvite(null);
                }}
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 active:scale-95 text-xs text-white/70 hover:text-white uppercase font-black tracking-widest transition-all rounded-lg border border-white/10 cursor-pointer"
              >
                ❌ No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING INVITE NOTIFICATIONS DRAWER */}
      {inviteNotifications.length > 0 && (
        <div className="fixed top-6 right-6 z-[101] flex flex-col gap-3 pointer-events-none select-none max-w-sm">
          {inviteNotifications.map((notif, index) => (
            <div key={index} className="bg-slate-950/95 border border-sky-400/40 rounded-xl px-4 py-3 shadow-xl backdrop-blur-md flex items-center gap-3 pointer-events-auto">
              <span className="w-2 h-2 rounded-full bg-sky-454 bg-sky-400 animate-ping shrink-0" />
              <p className="text-[11px] font-bold text-sky-200 mt-0.5">{notif}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
