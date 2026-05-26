/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GameStats, UniversalSettings, UiElementPos, Keybindings, DEFAULT_KEYBINDINGS } from './types';
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

interface GlobalChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

const GlobalChatPanel = ({ messages, onSendMessage }: GlobalChatPanelProps) => {
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
      {/* Message history container */}
      <div 
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto bg-black/45 border border-white/10 rounded-xl p-4 flex flex-col gap-3 mb-4 scrollbar-thin scrollbar-thumb-white/10 pr-1.5"
      >
        {messages.length === 0 ? (
          <p className="text-xs font-mono text-white/35 uppercase tracking-widest text-center my-auto italic select-none">
            📡 No active broadcast logs. Type below to transmit message.
          </p>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col gap-1 max-w-[90%] animate-fade-in ${
                msg.isLocal ? 'self-end bg-[#38bdf8]/10 p-2.5 rounded-lg border border-[#38bdf8]/20' : 'self-start'
              }`}
            >
              <div className="flex items-center gap-2 select-none">
                <span className={`text-[11px] font-mono font-black ${
                  msg.isLocal ? 'text-[#38bdf8]' : 'text-slate-400'
                }`}>
                  {msg.sender} {msg.isLocal ? '(You)' : ''}
                </span>
                <span className="text-[10px] font-mono text-white/20">
                  {msg.timestamp}
                </span>
              </div>
              <p className="text-sm font-sans text-slate-100 break-words leading-relaxed select-text font-medium leading-[1.3] pl-0.5">
                {msg.text}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Message input form */}
      <form 
        onSubmit={handleSubmit}
        className="flex items-center gap-2.5 bg-black/40 border border-white/10 rounded-lg p-2.5 shrink-0 pointer-events-auto"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type global message... [Press Enter]"
          className="flex-grow h-11 bg-black/50 border border-white/5 rounded px-3.5 text-sm text-white placeholder:text-white/30 focus:border-[#38bdf8]/40 outline-none transition-all font-sans"
          maxLength={120}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className={`h-11 px-5 rounded text-sm font-sans font-bold uppercase tracking-wider transition-all flex items-center justify-center shrink-0 ${
            inputText.trim()
              ? 'bg-[#38bdf8] hover:bg-[#38bdf8]/80 text-slate-950 font-black cursor-pointer shadow-[0_0_12px_rgba(56,189,248,0.25)] hover:shadow-[0_0_18px_rgba(56,189,248,0.4)] active:scale-95'
              : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
          }`}
        >
          Send
        </button>
      </form>
    </div>
  );
};


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

interface SaveData {
  version: number;
  playerName: string;
  playerHue: number;
  uiPositions: UiElementPos[];
  adminSettings: Omit<UniversalSettings, 'playerHue' | 'playerName'>;
  keybindings?: Keybindings;
}

const ENCRYPTION_KEY = "GRIFBALL_NEURAL_LINK_2026";

function encryptSaveData(data: SaveData): string {
  try {
    const jsonStr = JSON.stringify(data);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(jsonStr);
    const keyBytes = encoder.encode(ENCRYPTION_KEY);
    
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
    }
    
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return "GRIF-DEC-" + btoa(binary);
  } catch (e) {
    console.error("Encryption failed:", e);
    throw new Error("Failed to encode neural backup.");
  }
}

function decryptSaveCode(code: string): SaveData {
  if (!code || !code.startsWith("GRIF-DEC-")) {
    throw new Error("Invalid format. Code must begin with 'GRIF-DEC-'.");
  }
  try {
    const base64Str = code.substring(9).trim();
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    const keyBytes = new TextEncoder().encode(ENCRYPTION_KEY);
    
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
    }
    
    const decryptedJson = new TextDecoder().decode(bytes);
    return JSON.parse(decryptedJson) as SaveData;
  } catch (e) {
    console.error("Decryption failed:", e);
    throw new Error("Failed to decrypt neural code. Ensure it is correct and untampered.");
  }
}


const BOT_COLOR_PRESETS = [
  { label: 'Red',     hue: 0   },
  { label: 'Orange',  hue: 28  },
  { label: 'Yellow',  hue: 55  },
  { label: 'Lime',    hue: 85  },
  { label: 'Green',   hue: 120 },
  { label: 'Teal',    hue: 168 },
  { label: 'Cyan',    hue: 190 },
  { label: 'Blue',    hue: 215 },
  { label: 'Purple',  hue: 275 },
  { label: 'Magenta', hue: 310 },
] as const;

export default function App() {
  const getWsUrl = () => {
    return getSavedMatchmakerUrl();
  };

  const getApiUrl = () => {
    const wsUrl = getWsUrl();
    let apiUrl = wsUrl.replace(/^ws/, 'http');
    if (apiUrl.endsWith('/ws')) {
      apiUrl = apiUrl.slice(0, -3);
    }
    return apiUrl;
  };

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [matchmakerUrl, setMatchmakerUrl] = useState<string>(getSavedMatchmakerUrl());
  const [customUrlInput, setCustomUrlInput] = useState<string>(matchmakerUrl);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [debugMode, setDebugMode] = useState<boolean>(false);
  const [isTerminated, setIsTerminated] = useState<boolean>(false);
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(false);
  const [showUiAdjustment, setShowUiAdjustment] = useState<boolean>(false);
  const [showLightingMenu, setShowLightingMenu] = useState<boolean>(false);
  const [offlineBotCount, setOfflineBotCount] = useState<number>(3); // Default to 3 bots (total 4 combatants)
  const [botDifficulties, setBotDifficulties] = useState<Record<string, 'easy' | 'normal' | 'hard' | 'nightmare'>>({
    main_ai: 'normal',
    bot_2: 'normal',
    bot_3: 'normal',
    bot_4: 'normal',
    bot_5: 'normal',
    bot_6: 'normal',
    bot_7: 'normal',
  });
  const [botColors, setBotColors] = useState<Record<string, number>>({
    main_ai: 0,
    bot_2: 120,
    bot_3: 280,
    bot_4: 45,
    bot_5: 60,
    bot_6: 320,
    bot_7: 180,
  });
  const [showBotSetupMenu, setShowBotSetupMenu] = useState<boolean>(false);

  // Chat message state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lobbyChatMessages, setLobbyChatMessages] = useState<ChatMessage[]>([]);
  const [rightPanelTab, setRightPanelTab] = useState<'manual' | 'customize'>('manual');
  const [customizerWeapon, setCustomizerWeapon] = useState<'none' | 'hammer' | 'sword'>('none');
  const [keybindings, setKeybindings] = useState<Keybindings>(() => {
    try {
      const saved = localStorage.getItem('grifball_keybindings');
      if (saved) return { ...DEFAULT_KEYBINDINGS, ...JSON.parse(saved) };
    } catch (e) {}
    return { ...DEFAULT_KEYBINDINGS };
  });
  const [rebindingAction, setRebindingAction] = useState<keyof Keybindings | null>(null);

  // Retrieve saved player name or generate one
  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      const savedName = localStorage.getItem('grifball_player_name');
      if (savedName) return savedName;
    } catch (e) {}
    return `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;
  });

  const handlePlayerNameChange = (newName: string) => {
    const trimmed = newName.substring(0, 10);
    setPlayerName(trimmed);
    setAdminSettings(prev => ({ ...prev, playerName: trimmed }));
    try {
      localStorage.setItem('grifball_player_name', trimmed);
    } catch (e) {}
  };

  const getSavedPlayerHue = (): number => {
    try {
      const saved = localStorage.getItem('grifball_player_hue');
      return saved ? parseInt(saved, 10) : 200;
    } catch (e) {
      return 200;
    }
  };

  const getSavedAdminSettings = (): UniversalSettings => {
    const defaultSettings: UniversalSettings = {
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
      playerHue: 200,
      nameVisibilityDistance: 15.0,
      nameVisibilityColor: '#00ffff',
      nameVisibilityOpacity: 0.8,
      nameVisibilityFontSize: 16,
      aiDifficulty: 'normal',
      aiReactionLatency: 0.25,
      aiAnticipationFactor: 0.40,
      aiMovementComplexity: 50,
      aiWeaponSwapIQ: 50,
    };

    try {
      const savedAdmin = localStorage.getItem('grifball_admin_settings');
      let admin = savedAdmin ? JSON.parse(savedAdmin) : {};
      
      const savedHue = localStorage.getItem('grifball_player_hue');
      const playerHue = savedHue ? parseInt(savedHue, 10) : 200;

      const savedName = localStorage.getItem('grifball_player_name');
      const nameVal = savedName || `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;

      return {
        ...defaultSettings,
        ...admin,
        playerHue,
        playerName: nameVal
      };
    } catch (e) {
      return defaultSettings;
    }
  };

  const [saveCodeImportInput, setSaveCodeImportInput] = useState<string>("");
  const [saveSystemStatus, setSaveSystemStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: "" });

  const handleExportSaveCode = () => {
    try {
      const { playerHue, playerName: sName, ...restSettings } = adminSettings;
      const dataToSave: SaveData = {
        version: 1,
        playerName: playerName,
        playerHue: playerHue ?? 200,
        uiPositions: uiPositions,
        adminSettings: restSettings,
        keybindings: keybindings
      };
      
      const code = encryptSaveData(dataToSave);
      navigator.clipboard.writeText(code);
      
      setSaveSystemStatus({
        type: 'success',
        message: 'Neural Backup Copied to Clipboard!'
      });
      setTimeout(() => setSaveSystemStatus({ type: null, message: "" }), 4000);
    } catch (err: any) {
      setSaveSystemStatus({
        type: 'error',
        message: err.message || 'Export failed.'
      });
    }
  };

  const handleImportSaveCode = (code: string) => {
    if (!code) {
      setSaveSystemStatus({ type: 'error', message: 'Please paste a save code first.' });
      return;
    }
    try {
      const decrypted = decryptSaveCode(code);
      if (!decrypted || !decrypted.playerName || decrypted.playerHue === undefined) {
        throw new Error("Malformed save data structure.");
      }

      // Apply Name
      handlePlayerNameChange(decrypted.playerName);

      // Apply Hue
      localStorage.setItem('grifball_player_hue', decrypted.playerHue.toString());

      // Apply UI Positions
      if (decrypted.uiPositions && Array.isArray(decrypted.uiPositions)) {
        setUiPositions(decrypted.uiPositions);
        localStorage.setItem('grifball_ui_positions', JSON.stringify(decrypted.uiPositions));
      }

      // Apply Admin Settings
      if (decrypted.adminSettings) {
        const fullSettings: UniversalSettings = {
          ...adminSettings,
          ...decrypted.adminSettings,
          playerHue: decrypted.playerHue,
          playerName: decrypted.playerName
        };
        setAdminSettings(fullSettings);
        localStorage.setItem('grifball_admin_settings', JSON.stringify(decrypted.adminSettings));
      }

      // Apply Keybindings
      if (decrypted.keybindings) {
        const merged = { ...DEFAULT_KEYBINDINGS, ...decrypted.keybindings };
        setKeybindings(merged);
        localStorage.setItem('grifball_keybindings', JSON.stringify(merged));
      }

      setSaveSystemStatus({
        type: 'success',
        message: `Neural Link Synced! Welcome back, ${decrypted.playerName}.`
      });
      setSaveCodeImportInput("");
      setTimeout(() => setSaveSystemStatus({ type: null, message: "" }), 6000);
    } catch (err: any) {
      setSaveSystemStatus({
        type: 'error',
        message: err.message || 'Import failed.'
      });
    }
  };

  const handleResetAllSettings = () => {
    if (confirm("Are you sure you want to completely erase all client saves, custom layout configurations, and restore all default values?")) {
      try {
        localStorage.removeItem('grifball_player_name');
        localStorage.removeItem('grifball_player_hue');
        localStorage.removeItem('grifball_ui_positions');
        localStorage.removeItem('grifball_admin_settings');
        localStorage.removeItem('grifball_keybindings');
        
        // Reset states
        const defaultName = `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;
        setPlayerName(defaultName);
        setUiPositions(DEFAULT_UI_POSITIONS);
        setKeybindings({ ...DEFAULT_KEYBINDINGS });
        
        const defaultAdmin: UniversalSettings = {
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
          playerHue: 200,
          nameVisibilityDistance: 15.0,
          nameVisibilityColor: '#00ffff',
          nameVisibilityOpacity: 0.8,
          nameVisibilityFontSize: 16,
          playerName: defaultName,
          aiDifficulty: 'normal',
          aiReactionLatency: 0.25,
          aiAnticipationFactor: 0.40,
          aiMovementComplexity: 50,
          aiWeaponSwapIQ: 50,
        };
        setAdminSettings(defaultAdmin);
        
        setSaveSystemStatus({
          type: 'success',
          message: 'All saves purged. Neural connection reset.'
        });
        setTimeout(() => setSaveSystemStatus({ type: null, message: "" }), 4000);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Keybind rebinding listener
  useEffect(() => {
    if (!rebindingAction) return;

    const handleRebindKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRebindingAction(null);
        return;
      }
      const newKey = e.key.toLowerCase();
      setKeybindings(prev => {
        const updated = { ...prev, [rebindingAction]: newKey };
        try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (err) {}
        return updated;
      });
      setRebindingAction(null);
    };

    const handleRebindMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mouseMap: Record<number, string> = { 0: 'lmb', 2: 'rmb', 1: 'mmb' };
      const newKey = mouseMap[e.button];
      if (!newKey) return;
      setKeybindings(prev => {
        const updated = { ...prev, [rebindingAction]: newKey };
        try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (err) {}
        return updated;
      });
      setRebindingAction(null);
    };

    window.addEventListener('keydown', handleRebindKey, true);
    window.addEventListener('mousedown', handleRebindMouse, true);
    return () => {
      window.removeEventListener('keydown', handleRebindKey, true);
      window.removeEventListener('mousedown', handleRebindMouse, true);
    };
  }, [rebindingAction]);

  // Multiplayer States
  const [connectionMode, setConnectionMode] = useState<'relay' | 'local'>('relay');
  const [activeMenuTab, setActiveMenuTab] = useState<'single' | 'multi'>('single');
  const [isMultiplayer, setIsMultiplayer] = useState<boolean>(false);
  const [multiplayerRole, setMultiplayerRole] = useState<'host' | 'client' | 'observer' | null>(null);
  const [multiplayerSocket, setMultiplayerSocket] = useState<WebSocket | null>(null);
  const [userIp, setUserIp] = useState<string>('127.0.0.1');
  const [lanIp, setLanIp] = useState<string>('127.0.0.1');
  const [hostIdCode, setHostIdCode] = useState<string>('');
  const [joinIpOrId, setJoinIpOrId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>('');
  const [quickPlayStatus, setQuickPlayStatus] = useState<'idle' | 'searching' | 'matching'>('idle');

  const [opponentClientId, setOpponentClientId] = useState<string>('');

  // Persisting network metadata and lobby invitation parameters
  const [menuSocket, setMenuSocket] = useState<WebSocket | null>(null);
  const [clientId, setClientId] = useState<string>('');
  const clientIdRef = useRef<string>('');
  const handleHostGameRef = useRef<(overrideCode?: string) => void>(() => {});
  const handleJoinGameRef = useRef<(target: string) => void>(() => {});

  useEffect(() => {
    handleHostGameRef.current = handleHostGame;
    handleJoinGameRef.current = handleJoinGame;
  });

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
    { id: 'spectatorCard', name: 'Spectator Controller', x: 50, y: 88, locked: true },
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
  const [adminSettings, setAdminSettings] = useState<UniversalSettings>(() => getSavedAdminSettings());

  // Automatically save admin settings and hue changes locally
  useEffect(() => {
    try {
      const { playerHue, playerName: sName, ...restSettings } = adminSettings;
      localStorage.setItem('grifball_admin_settings', JSON.stringify(restSettings));
      if (playerHue !== undefined) {
        localStorage.setItem('grifball_player_hue', playerHue.toString());
      }
    } catch (e) {
      console.error('Failed to save settings locally:', e);
    }
  }, [adminSettings]);

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
      aiDifficulty: 'normal',
      aiReactionLatency: 0.25,
      aiAnticipationFactor: 0.40,
      aiMovementComplexity: 50,
      aiWeaponSwapIQ: 50,
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
            clientIdRef.current = data.clientId;
          } else if (data.type === 'presence') {
            setOnlineCount(data.onlineCount || 0);
            // Capture list of online client info (excluding this browser's self)
            const others = (data.clients || []).filter((c: OnlineClient) => c.id !== clientIdRef.current);
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
                isLocal: data.clientId === clientIdRef.current
              }];
            });
          } else if (data.type === 'quickplay_queued') {
            setQuickPlayStatus('searching');
          } else if (data.type === 'quickplay_host') {
            setQuickPlayStatus('matching');
            handleHostGameRef.current(data.roomCode);
          } else if (data.type === 'quickplay_match_found') {
            setQuickPlayStatus('idle');
            handleJoinGameRef.current(data.roomCode);
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

    return () => {
      isDestroyed = true;
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  // Heartbeat to measure RTT latency
  useEffect(() => {
    const pingInterval = setInterval(() => {
      const activeSock = (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) 
        ? multiplayerSocket 
        : (menuSocket && menuSocket.readyState === WebSocket.OPEN) ? menuSocket : null;
      
      if (activeSock && activeSock.readyState === WebSocket.OPEN) {
        try {
          activeSock.send(JSON.stringify({
            type: 'ping',
            timestamp: Date.now()
          }));
        } catch (e) {
          console.error('Error sending ping:', e);
        }
      }
    }, 2000);

    return () => clearInterval(pingInterval);
  }, [multiplayerSocket, menuSocket]);

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
      spaceAvailable,
      name: playerName
    }));
  }, [menuSocket, isPlaying, isMultiplayer, connectionStatus, hostIdCode, joinIpOrId, multiplayerRole, playerName]);

  // Sync the real-time calculated ping to HUD stats immediately
  useEffect(() => {
    setCurrentStats(prev => ({
      ...prev,
      ping
    }));
  }, [ping]);

  // Dedicated in-game message and role listener
  useEffect(() => {
    if (!multiplayerSocket) return;

    const handleMultiplayerMessage = (event: MessageEvent) => {
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
        } else if (data.type === 'role_changed') {
          console.log('Role authoritatively updated to:', data.role);
          setMultiplayerRole(data.role);
          if (data.role === 'observer') {
            setIsPaused(false); // Unpause upon transitioning to observer
          }
        } else if (data.type === 'opponent_role_changed') {
          console.log('Opponent role updated to:', data.role);
          if (data.role === 'observer') {
            setOpponentClientId('Opponent (Spectating)');
          } else {
            setOpponentClientId('Opponent');
          }
        } else if (data.type === 'error') {
          alert(data.message);
        }
      } catch (err) {
        // Safe catch
      }
    };

    multiplayerSocket.addEventListener('message', handleMultiplayerMessage);
    return () => {
      multiplayerSocket.removeEventListener('message', handleMultiplayerMessage);
    };
  }, [multiplayerSocket]);

  const sendChatMessage = (text: string) => {
    if (!multiplayerSocket || multiplayerSocket.readyState !== WebSocket.OPEN) return;
    
    const baseSender = multiplayerRole === 'host' ? 'Blue (Host)' : 'Red (Guest)';
    const senderName = playerName ? `${playerName} (${multiplayerRole === 'host' ? 'Host' : 'Guest'})` : baseSender;
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
      sender: playerName || `Client ${clientId}`,
      text: text
    };
    
    menuSocket.send(JSON.stringify(packet));
  };

  const handleHostGame = (overrideCode?: string) => {
    setConnectionError('');
    setConnectionStatus('hosting');
    setChatMessages([]);

    const activeCode = overrideCode || hostIdCode;
    if (overrideCode) {
      setHostIdCode(overrideCode);
    }

    const wsUrl = connectionMode === 'relay' ? getWsUrl() : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    console.log('WS Host connection target URL resolved to:', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WS Connection opened. Registering host...');
      ws.send(JSON.stringify({
        type: 'host',
        ip: userIp,
        lanIp: lanIp,
        customId: activeCode
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
          setOpponentClientId(data.clientClientId || 'Opponent');

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

  const handleJoinGame = (target: string, isObserver: boolean = false) => {
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

    console.log('WS Join connection target URL resolved to:', wsUrl, 'isObserver:', isObserver);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WS Connection opened. Joining:', target, 'isObserver:', isObserver);
      ws.send(JSON.stringify({
        type: 'join',
        targetIpOrId: target.trim(),
        isObserver
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
          setMultiplayerRole(data.role || 'client');
          setConnectionStatus('connected');
          setOpponentClientId(data.hostClientId || 'Opponent');

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
    setQuickPlayStatus('idle');
  };

  const handleQuickPlay = () => {
    if (!menuSocket || menuSocket.readyState !== WebSocket.OPEN) {
      setConnectionError('Matchmaker connection offline. Retrying...');
      return;
    }
    setConnectionError('');
    setQuickPlayStatus('searching');
    menuSocket.send(JSON.stringify({ type: 'quickplay_join' }));
  };

  const handleCancelQuickPlay = () => {
    if (menuSocket && menuSocket.readyState === WebSocket.OPEN) {
      menuSocket.send(JSON.stringify({ type: 'quickplay_leave' }));
    }
    setQuickPlayStatus('idle');
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
    setQuickPlayStatus('idle');
  };

  const handleResumeGame = () => {
    sfx.resume();
    setIsPaused(false);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  };

  const handleJoinObserver = () => {
    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({
        type: 'change_role',
        role: 'observer'
      }));
    } else {
      // Singleplayer observer mode toggle
      setMultiplayerRole('observer');
      setIsPaused(false);
    }
  };

  const handleJoinPlayer = () => {
    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({
        type: 'change_role',
        role: 'player'
      }));
    } else {
      // Singleplayer player mode toggle
      setMultiplayerRole(null);
      setIsPaused(false);
    }
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
    setQuickPlayStatus('idle');
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
    setOpponentClientId('');
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
      opponentConnected: isMultiplayer && !!multiplayerSocket,
      playerClientId: clientId || 'Player',
      opponentClientId: opponentClientId || 'Opponent'
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
          opponentClientId={opponentClientId}
          keybindings={keybindings}
          offlineBotCount={offlineBotCount}
          botDifficulties={botDifficulties}
          botColors={botColors}
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
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-xl p-4 lg:p-8 transition-all duration-300 overflow-y-auto">
          <div className="w-full max-w-7xl bg-slate-900/40 border border-white/10 rounded-3xl p-8 backdrop-blur-md flex flex-col gap-8 shadow-2xl select-none lg:h-[780px] max-h-[95vh] overflow-y-auto lg:overflow-hidden">
            
            {/* UNIFIED CARD HEADER */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-6 border-b border-white/10 pb-5 shrink-0">
              {/* Brand Branding Section */}
              <div className="flex items-center gap-4">
                <h1 className="text-4xl font-sans font-black tracking-tighter italic text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 select-none">
                  iBrawls
                </h1>
                <span className="text-[#38bdf8] tracking-[0.2em] uppercase text-xs font-bold font-display select-none px-3.5 py-1 border border-[#38bdf8]/30 rounded bg-[#38bdf8]/5 hidden sm:inline-block">
                  Voxel Grifball Tech Demo
                </span>
              </div>

              {/* Pill Segmented Mode Switcher */}
              <div className="flex bg-black/40 p-1.5 rounded-full border border-white/10 gap-2 select-none shrink-0 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]">
                <button
                  onClick={() => setActiveMenuTab('single')}
                  className={`px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                    activeMenuTab === 'single'
                      ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)]'
                      : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  🎮 Training Sandbox
                </button>
                <button
                  onClick={() => setActiveMenuTab('multi')}
                  className={`px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                    activeMenuTab === 'multi'
                      ? 'bg-[#38bdf8] text-slate-900 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                      : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  📡 Multiplayer (P2P)
                </button>
              </div>

              {/* Online Player Count */}
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-4 py-2 rounded-full text-xs font-mono font-bold text-emerald-400 shrink-0">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                ONLINE PLAYERS: {onlineCount || 1}
              </div>
            </div>

            {/* MAIN 3-COLUMN RESPONSIVE GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
              
              {/* COLUMN 1: GAME SETUP & ACTIONS */}
              <div className="flex flex-col h-full min-h-0 justify-between">
                
                {/* 🆔 SPARTAN IDENTITY PROFILE CARD */}
                <div className="bg-slate-950/45 border border-white/10 rounded-xl p-4.5 flex flex-col gap-2 shrink-0 mb-4 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)] select-none text-left">
                  <div className="flex justify-between items-center pb-1.5 border-b border-white/5">
                    <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5 font-display">
                      🆔 Spartan Pilot Identity
                    </span>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-500/20 px-2 py-0.5 rounded">
                      MAX_10_CHARS
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 text-left mt-1">
                    <span className="text-[10.5px] text-white/40 uppercase tracking-widest font-mono">Customize Nameplate Callout:</span>
                    <div className="relative">
                      <input
                        type="text"
                        maxLength={10}
                        value={playerName}
                        onChange={(e) => handlePlayerNameChange(e.target.value)}
                        placeholder="Spartan Tag..."
                        className="w-full h-11 bg-black/60 border border-white/10 rounded px-3.5 text-sm tracking-wide text-[#38bdf8] placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all font-semibold uppercase pr-8 font-sans"
                      />
                      <div className="absolute right-3.5 top-3.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    </div>
                  </div>
                </div>

                {activeMenuTab === 'single' ? (
                  <div className="flex flex-col h-full min-h-0 justify-between">
                    <div className="flex flex-col gap-5">
                      <div className="flex items-center gap-2.5 mb-1">
                        <span className="w-2 h-4 bg-blue-500" />
                        <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
                          Training Sandbox Setup
                        </h2>
                      </div>
                      <p className="text-white/60 text-sm leading-relaxed bg-white/5 border border-white/5 rounded-lg p-4 leading-normal select-text">
                        This is a Grifball iBrawls simulator. The game can be played solo against AI or online against other players. All Admin Controls only impact you, so coordinate with your opponent on the dials you want to match.
                      </p>

                      {/* AI Difficulty Neural Configuration */}
                      <div className="bg-slate-950/45 border border-white/10 rounded-xl p-4.5 flex flex-col gap-3.5 text-left">
                        <div className="flex justify-between items-center pb-2 border-b border-white/5">
                          <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5 font-display">
                            🤖 AI Combat Neural Net
                          </span>
                          <span className="text-[10px] font-mono text-[#38bdf8] bg-[#38bdf8]/10 border border-[#38bdf8]/20 px-2 py-0.5 rounded uppercase font-black">
                            Offline Play
                          </span>
                        </div>

                        {/* Difficulty Selector */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10.5px] text-white/50 uppercase tracking-widest font-mono">Cognitive Matrix Preset:</span>
                          <select
                            value={adminSettings.aiDifficulty || 'normal'}
                            onChange={(e) => setAdminSettings(prev => ({ ...prev, aiDifficulty: e.target.value as any }))}
                            className="w-full h-11 bg-black/60 border border-white/10 rounded px-2.5 text-sm text-[#38bdf8] font-bold uppercase outline-none focus:border-[#38bdf8] transition-all cursor-pointer font-sans"
                          >
                            <option value="easy">🟢 Easy (Sub-Normal)</option>
                            <option value="normal">🔵 Normal (Adaptive)</option>
                            <option value="hard">🟡 Hard (Punishing)</option>
                            <option value="nightmare">🔴 Nightmare (Grandmaster)</option>
                            <option value="custom">⚙️ Custom Matrix Override</option>
                          </select>
                        </div>

                        {/* Custom Parameter Sliders */}
                        {(adminSettings.aiDifficulty === 'custom') && (
                          <div className="flex flex-col gap-4 pt-1 animate-fade-in">
                            {/* Reaction Latency */}
                            <div className="flex flex-col gap-1.5">
                              <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                                <span>Reflex Latency</span>
                                <span className="text-cyan-400 font-bold">{(adminSettings.aiReactionLatency ?? 0.25).toFixed(2)}s</span>
                              </div>
                              <input 
                                type="range" 
                                min="0.00" 
                                max="1.50" 
                                step="0.05"
                                value={adminSettings.aiReactionLatency ?? 0.25} 
                                onChange={(e) => setAdminSettings(prev => ({ ...prev, aiReactionLatency: parseFloat(e.target.value) }))}
                                className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                              />
                            </div>

                            {/* Anticipation Factor */}
                            <div className="flex flex-col gap-1.5">
                              <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                                <span>Anticipation Engine</span>
                                <span className="text-cyan-400 font-bold">{Math.round((adminSettings.aiAnticipationFactor ?? 0.40) * 100)}%</span>
                              </div>
                              <input 
                                type="range" 
                                min="0.00" 
                                max="1.00" 
                                step="0.05"
                                value={adminSettings.aiAnticipationFactor ?? 0.40} 
                                onChange={(e) => setAdminSettings(prev => ({ ...prev, aiAnticipationFactor: parseFloat(e.target.value) }))}
                                className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                              />
                            </div>

                            {/* Movement Complexity */}
                            <div className="flex flex-col gap-1.5">
                              <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                                <span>Strafe & Evade Complexity</span>
                                <span className="text-cyan-400 font-bold">{adminSettings.aiMovementComplexity ?? 50}%</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="100" 
                                step="5"
                                value={adminSettings.aiMovementComplexity ?? 50} 
                                onChange={(e) => setAdminSettings(prev => ({ ...prev, aiMovementComplexity: parseInt(e.target.value) }))}
                                className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                              />
                            </div>

                            {/* Weapon Swap IQ */}
                            <div className="flex flex-col gap-1.5">
                              <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                                <span>Weapon Swapping IQ</span>
                                <span className="text-cyan-400 font-bold">{adminSettings.aiWeaponSwapIQ ?? 50}%</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="100" 
                                step="5"
                                value={adminSettings.aiWeaponSwapIQ ?? 50} 
                                onChange={(e) => setAdminSettings(prev => ({ ...prev, aiWeaponSwapIQ: parseInt(e.target.value) }))}
                                className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Training Actions */}
                    <div className="flex flex-col gap-3.5 mt-auto shrink-0 pt-4">
                      <button 
                        id="play-game-btn"
                        onClick={() => setShowBotSetupMenu(true)}
                        className="group relative w-full h-16 bg-white hover:bg-sky-400 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-2xl border border-white/20 select-none pointer-events-auto"
                      >
                        <div className="absolute inset-0 bg-blue-600 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300" />
                        <span className="relative z-10 text-slate-900 font-sans font-black text-sm uppercase tracking-widest group-hover:text-white pointer-events-none flex items-center gap-2">
                          Start Local Training
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                          </svg>
                        </span>
                      </button>
                      
                      <button 
                        id="close-game-btn"
                        onClick={handleCloseGame}
                        className="w-full h-14 bg-white/5 border border-white/10 backdrop-blur-md flex items-center justify-center hover:bg-white/10 hover:border-white/25 active:scale-[0.99] transition-all cursor-pointer rounded pointer-events-auto select-none"
                      >
                        <span className="text-white/80 font-sans font-bold text-sm uppercase tracking-widest pointer-events-none">
                          Close Sandbox
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full min-h-0 justify-between gap-5">
                    <div className="flex flex-col gap-4 shrink-0">
                      <div className="flex items-center gap-2.5 mb-1">
                        <span className="w-2 h-4 bg-[#38bdf8]" />
                        <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
                          Multiplayer Setup
                        </h2>
                      </div>
                      
                      {/* CONNECTION MODE SELECTOR */}
                      <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/5 gap-2 select-none shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
                        <button
                          onClick={() => setConnectionMode('relay')}
                          className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
                            connectionMode === 'relay'
                              ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                              : 'text-white/40 hover:text-white/70'
                          }`}
                        >
                          🌐 Cloud Relay
                        </button>
                        <button
                          onClick={() => setConnectionMode('local')}
                          className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded transition-all cursor-pointer text-center ${
                            connectionMode === 'local'
                              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                              : 'text-white/40 hover:text-white/70'
                          }`}
                        >
                          📶 Local LAN IP
                        </button>
                      </div>

                      {/* Connection coordinates */}
                      <div className={`p-3.5 rounded-lg border text-xs ${connectionMode === 'relay' ? "bg-sky-500/5 border-sky-500/20" : "bg-white/5 border-white/10"}`}>
                        <p className="text-[11px] text-[#38bdf8] font-bold uppercase tracking-wider mb-2">Your Connection Coordinates</p>
                        <div className="flex flex-col gap-1.5 font-mono text-xs font-semibold">
                          {connectionMode === 'relay' ? (
                            <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
                              <span className="text-white/45 uppercase text-[10px] font-bold">Relay Status:</span>
                              <span className="text-sky-400 font-extrabold flex items-center gap-1.5">
                                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse inline-block" /> ONLINE
                              </span>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
                              <span className="text-white/45 uppercase text-[10px] font-bold">Web/Host IP:</span>
                              <span className="text-[#38bdf8] font-black">{userIp === '127.0.0.1' ? '127.0.0.1' : userIp}</span>
                            </div>
                          )}
                          {connectionMode === 'local' && lanIp && lanIp !== '127.0.0.1' && (
                            <div className="flex justify-between items-center bg-emerald-500/10 px-3 py-1.5 rounded border border-emerald-500/10">
                              <span className="text-emerald-400 uppercase text-[10px] font-bold">LAN Network IP:</span>
                              <span className="text-emerald-400 font-extrabold">{lanIp}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center bg-black/40 px-3 py-1.5 rounded border border-white/5">
                            <span className="text-white/45 uppercase text-[10px] font-bold">Room Code:</span>
                            <span className="text-amber-400 font-black tracking-widest">{hostIdCode}</span>
                          </div>
                        </div>
                      </div>

                      {/* Connection States */}
                      {connectionStatus === 'hosting' && (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3.5 flex flex-col items-center justify-center text-center gap-1.5 animate-pulse">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                          <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Lobby Live & Broadcasting</p>
                          <p className="text-[10px] text-white/60">Awaiting player to join...</p>
                          <button
                            onClick={handleCancelHostOrJoin}
                            className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {connectionStatus === 'connecting' && (
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3.5 flex flex-col items-center justify-center text-center gap-1.5 animate-pulse">
                          <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
                          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">Connecting Protocol</p>
                          <p className="text-[10px] text-white/60">Attaching to host session...</p>
                          <button
                            onClick={handleCancelHostOrJoin}
                            className="mt-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-widest text-white border border-white/10 rounded cursor-pointer transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* Quick Play Search State */}
                      {quickPlayStatus === 'searching' && (
                        <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden">
                          {/* Pulsing radar scanning animation */}
                          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                            <div className="w-32 h-32 border border-sky-500/20 rounded-full animate-ping absolute" />
                            <div className="w-20 h-20 border border-sky-500/30 rounded-full animate-pulse absolute" />
                          </div>
                          
                          <span className="text-3xl animate-spin inline-block">📡</span>
                          <p className="text-sm font-black text-sky-400 uppercase tracking-widest">Searching for Match...</p>
                          <p className="text-xs text-white/60">Scanning open rooms and queuing players</p>
                          
                          <button
                            onClick={handleCancelQuickPlay}
                            className="z-10 px-5 py-2 bg-red-500/25 hover:bg-red-500/40 text-xs font-bold uppercase tracking-widest text-red-400 border border-red-500/30 rounded cursor-pointer transition-all active:scale-[0.97]"
                          >
                            Cancel Search
                          </button>
                        </div>
                      )}

                      {quickPlayStatus === 'matching' && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-6 flex flex-col items-center justify-center text-center gap-2 animate-pulse">
                          <span className="text-2xl">⚡</span>
                          <p className="text-sm font-black text-amber-400 uppercase tracking-widest font-bold">Match Found!</p>
                          <p className="text-xs text-white/60">Configuring arena host credentials...</p>
                        </div>
                      )}

                      {/* Host/Connect triggers */}
                      {(connectionStatus === 'idle' || connectionStatus === 'error' || connectionStatus === 'fetching_ip') && quickPlayStatus === 'idle' && (
                        <div className="flex flex-col gap-2.5">
                          <button
                            onClick={handleQuickPlay}
                            className="w-full h-14 bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-500 hover:from-sky-500 hover:to-purple-600 text-slate-950 hover:text-white font-sans font-black text-xs uppercase tracking-[0.2em] transition-all rounded shadow-lg shadow-sky-500/25 border border-sky-300/30 cursor-pointer flex items-center justify-center gap-2 hover:shadow-indigo-500/40 active:scale-[0.98] select-none"
                          >
                            ⚡ Quick Play Matchmaking
                          </button>

                          <div className="flex items-center gap-2 py-0.5">
                            <hr className="flex-grow border-white/5" />
                            <span className="text-[10px] text-white/20 uppercase tracking-widest font-mono">OR DIRECT PLAY</span>
                            <hr className="flex-grow border-white/5" />
                          </div>

                          <button
                            onClick={() => handleHostGame()}
                            className="w-full h-12 bg-white hover:bg-emerald-500 text-slate-900 hover:text-white hover:border-emerald-400 font-sans font-black text-xs uppercase tracking-widest transition-all rounded shadow border border-white/10 cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            🎙️ Host New Match
                          </button>

                          <div className="flex items-center gap-2 py-0.5">
                            <hr className="flex-grow border-white/10" />
                            <span className="text-[10px] text-white/30 uppercase tracking-widest font-mono">OR JOIN ROOM</span>
                            <hr className="flex-grow border-white/10" />
                          </div>

                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={joinIpOrId}
                              onChange={(e) => setJoinIpOrId(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleJoinGame(joinIpOrId);
                              }}
                              placeholder="Room Code or IP..."
                              className="flex-1 h-12 bg-black/60 border border-white/10 rounded px-3.5 text-center font-mono text-sm tracking-wide text-[#38bdf8] placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all"
                            />
                            <button
                              onClick={() => handleJoinGame(joinIpOrId)}
                              disabled={!joinIpOrId}
                              className={`px-4.5 h-12 font-sans font-black text-xs uppercase tracking-widest rounded transition-all border outline-none ${
                                joinIpOrId 
                                  ? 'bg-[#38bdf8]/15 hover:bg-[#38bdf8]/35 border-[#38bdf8]/50 text-[#38bdf8] cursor-pointer' 
                                  : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                              }`}
                            >
                              Connect
                            </button>
                            <button
                              onClick={() => handleJoinGame(joinIpOrId, true)}
                              disabled={!joinIpOrId}
                              className={`px-4.5 h-12 font-sans font-black text-xs uppercase tracking-widest rounded transition-all border outline-none ${
                                joinIpOrId 
                                  ? 'bg-amber-500/10 hover:bg-amber-500/30 border-amber-500/50 text-amber-400 cursor-pointer shadow-[0_0_12px_rgba(245,158,11,0.1)]' 
                                  : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                              }`}
                            >
                              Spectate
                            </button>
                          </div>
                        </div>
                      )}

                      {connectionStatus === 'error' && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center animate-pulse">
                          <p className="text-xs text-red-400 font-black uppercase tracking-wider mb-0.5">⚠️ Sync Timeout</p>
                          <p className="text-xs text-white/70">{connectionError || 'Connection failed.'}</p>
                        </div>
                      )}

                      {/* Collapsible Advanced Settings Panel */}
                      <div className="mt-3.5 border-t border-white/5 pt-3.5">
                        <details className="group">
                          <summary className="flex justify-between items-center text-xs text-[#38bdf8] font-bold uppercase tracking-wider cursor-pointer select-none hover:text-white transition-colors">
                            <span>⚙️ Advanced Settings</span>
                            <span className="text-[10px] transition-transform group-open:rotate-180 font-sans">▼</span>
                          </summary>
                          
                          <div className="flex flex-col gap-2.5 mt-2.5 bg-black/30 p-3 rounded border border-white/5">
                            <label className="text-[10px] text-white/50 uppercase tracking-widest font-mono">Matchmaker Server URL:</label>
                            <input
                              type="text"
                              value={customUrlInput}
                              onChange={(e) => setCustomUrlInput(e.target.value)}
                              placeholder="wss://..."
                              className="w-full h-10 bg-black/60 border border-white/10 rounded px-2.5 font-mono text-xs tracking-wide text-white focus:border-[#38bdf8] outline-none transition-all"
                            />
                            <div className="flex gap-2.5">
                              <button
                                onClick={() => {
                                  let cleanUrl = customUrlInput.trim();
                                  if (cleanUrl) {
                                    if (!cleanUrl.startsWith('ws://') && !cleanUrl.startsWith('wss://')) {
                                      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                                      cleanUrl = protocol + cleanUrl;
                                    }
                                    localStorage.setItem('ibrawls_matchmaker_url', cleanUrl);
                                    setMatchmakerUrl(cleanUrl);
                                    setCustomUrlInput(cleanUrl);
                                    setConnectionError('Matchmaker updated. Reconnecting...');
                                    if (menuSocket) {
                                      menuSocket.close();
                                    }
                                  }
                                }}
                                className="flex-1 h-9 bg-[#38bdf8] hover:bg-[#38bdf8]/80 text-slate-950 font-sans font-black text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.97]"
                              >
                                Apply
                              </button>
                              <button
                                onClick={() => {
                                  localStorage.removeItem('ibrawls_matchmaker_url');
                                  const defaultUrl = getSavedMatchmakerUrl();
                                  setMatchmakerUrl(defaultUrl);
                                  setCustomUrlInput(defaultUrl);
                                  setConnectionError('Reset to default. Reconnecting...');
                                  if (menuSocket) {
                                    menuSocket.close();
                                  }
                                }}
                                className="h-9 px-3 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 rounded text-xs font-bold uppercase tracking-wider cursor-pointer transition-all"
                              >
                                Reset
                              </button>
                            </div>
                          </div>
                        </details>
                      </div>
                    </div>

                    {/* Online clients */}
                    <div className="bg-slate-950/40 border border-white/10 rounded-lg p-3.5 flex flex-col gap-2 flex-grow min-h-[160px] overflow-hidden lg:h-[260px]">
                      <div className="flex justify-between items-center pb-2 border-b border-white/5 shrink-0">
                        <p className="text-xs text-[#38bdf8] font-black uppercase tracking-wider flex items-center gap-1.5">
                          <span className="w-1 px-0.5 h-2.5 bg-[#38bdf8] inline-block rounded-sm" />
                          Online Clients ({onlineClients.length})
                        </p>
                        {clientId && (
                          <span className="text-[10px] font-mono text-white/45 bg-white/5 px-2.5 py-0.5 rounded border border-white/5">
                            ID: {clientId}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2 pr-1">
                        {onlineClients.length === 0 ? (
                          <p className="text-xs text-white/45 italic font-medium m-auto text-center py-4">No other players online yet.</p>
                        ) : (
                          onlineClients.map(client => (
                            <div key={client.id} className="flex justify-between items-center bg-black/45 px-3 py-2.5 rounded border border-white/5 text-xs font-mono shrink-0">
                              <div className="flex flex-col gap-1 min-w-0">
                                <span className="text-white/80 font-semibold truncate max-w-[130px]" title={client.name ? `${client.name} (${client.id})` : `Client ${client.id}`}>
                                  {client.name ? client.name : `Client ${client.id}`}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {client.state === 'menu' && (
                                    <span className="text-[10px] text-slate-400/80 font-bold uppercase tracking-wider flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                      In Menu
                                    </span>
                                  )}
                                  {client.state === 'solo' && (
                                    <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
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
                                        className="text-[10px] bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-400 font-bold uppercase tracking-wider px-2 py-0.5 rounded cursor-pointer transition-all flex items-center gap-1"
                                      >
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping" />
                                        Join
                                      </button>
                                    ) : (
                                      <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        In Match
                                      </span>
                                    )
                                  )}
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-1 shrink-0">
                                {connectionStatus === 'hosting' && connectionMode === 'relay' && (
                                  <button
                                    onClick={() => {
                                      if (menuSocket && menuSocket.readyState === WebSocket.OPEN) {
                                        menuSocket.send(JSON.stringify({
                                          type: 'send_invite',
                                          targetId: client.id,
                                          roomCode: hostIdCode
                                        }));
                                        setInviteNotifications(prev => [
                                          ...prev,
                                          `Lobby invite dispatched to Client ${client.id}.`
                                        ]);
                                        setTimeout(() => {
                                          setInviteNotifications(prev => prev.filter(n => !n.includes(client.id)));
                                        }, 5000);
                                      }
                                    }}
                                    className="px-2.5 py-1 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-[9px] font-sans font-black uppercase tracking-wider text-white rounded cursor-pointer transition-all border border-sky-400/20 active:scale-95"
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

              {/* COLUMN 2: KEYBIND REFERENCE & CUSTOMIZER */}
              <div className="flex flex-col h-full min-h-0 border-t lg:border-t-0 lg:border-l lg:border-r border-white/10 pt-6 lg:pt-0 lg:px-6">
                {/* Segmented Middle Switcher */}
                <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/5 gap-2 select-none shrink-0 mb-4 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
                  <button
                    onClick={() => setRightPanelTab('manual')}
                    className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 ${
                      rightPanelTab === 'manual'
                        ? 'bg-[#38bdf8] text-slate-900 shadow-md font-bold'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    ⌨️ Keybind Reference
                  </button>
                  <button
                    onClick={() => setRightPanelTab('customize')}
                    className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 ${
                      rightPanelTab === 'customize'
                        ? 'bg-[#38bdf8] text-slate-900 shadow-md font-bold'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    🎨 Customize Armor
                  </button>
                </div>

                {rightPanelTab === 'manual' && (
                  <div className="flex-grow flex flex-col min-h-0 overflow-y-auto pr-1">
                    <div className="flex flex-col gap-3 font-sans text-sm">

                      {/* Rebind Instructions */}
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-500/5 border border-amber-500/15 rounded text-[11px] text-amber-400/80 font-medium select-none">
                        <span>⚡</span>
                        <span>Click any key below to rebind. Press <kbd className="bg-black/40 px-1.5 py-0.5 rounded border border-white/10 text-[10px] font-mono font-bold">ESC</kbd> to cancel.</span>
                      </div>

                      {/* Movement Controls */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                        <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Arena Navigation</p>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-white/80">
                          {([
                            { action: 'moveForward' as keyof Keybindings, label: 'Move Forward' },
                            { action: 'moveLeft' as keyof Keybindings, label: 'Move Left' },
                            { action: 'moveBackward' as keyof Keybindings, label: 'Move Backward' },
                            { action: 'moveRight' as keyof Keybindings, label: 'Move Right' },
                            { action: 'jump' as keyof Keybindings, label: 'Jump (Boost)' },
                            { action: 'dash' as keyof Keybindings, label: 'Sonic Dash' },
                            { action: 'crouch' as keyof Keybindings, label: 'Crouch / Slide' },
                            { action: 'scoreboard' as keyof Keybindings, label: 'Scoreboard' },
                          ]).map(({ action, label }) => (
                            <div key={action} className="flex items-center gap-2.5">
                              <button
                                onClick={() => setRebindingAction(rebindingAction === action ? null : action)}
                                className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-bold text-xs border cursor-pointer transition-all select-none ${
                                  rebindingAction === action
                                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                    : 'bg-black/50 border-white/20 text-[#38bdf8] hover:border-[#38bdf8]/50 hover:bg-[#38bdf8]/10'
                                }`}
                              >
                                {rebindingAction === action ? '...' : (
                                  keybindings[action] === ' ' ? 'SPACE' : keybindings[action].toUpperCase()
                                )}
                              </button>
                              <span className="text-white/60 text-xs font-medium">{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Weapon Controls */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                        <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Arsenal Control & Swapping</p>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-white/80">
                          {([
                            { action: 'weapon1' as keyof Keybindings, label: 'Grav Hammer', color: 'text-cyan-400' },
                            { action: 'weapon2' as keyof Keybindings, label: 'Energy Sword', color: 'text-purple-400' },
                          ]).map(({ action, label, color }) => (
                            <div key={action} className="flex items-center gap-2.5">
                              <button
                                onClick={() => setRebindingAction(rebindingAction === action ? null : action)}
                                className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-bold text-xs border cursor-pointer transition-all select-none ${
                                  rebindingAction === action
                                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                    : `bg-black/50 border-white/20 ${color} hover:border-[#38bdf8]/50 hover:bg-[#38bdf8]/10`
                                }`}
                              >
                                {rebindingAction === action ? '...' : (
                                  keybindings[action] === ' ' ? 'SPACE' : keybindings[action].toUpperCase()
                                )}
                              </button>
                              <span className="text-white/60 text-xs font-medium">{label}</span>
                            </div>
                          ))}
                          <div className="flex items-center gap-2.5 col-span-2 border-t border-white/5 pt-2.5 mt-1">
                            <span className="text-amber-400 font-mono text-[10px] uppercase tracking-widest mr-1.5">Switch:</span>
                            <span className="text-white/70 text-xs">Use <kbd className="bg-black/30 px-1.5 py-0.5 border border-white/10 rounded font-bold text-xs">SCROLL WHEEL</kbd> to cycle weapons</span>
                          </div>
                        </div>
                      </div>

                      {/* Combat Controls */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                        <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Combat Techniques</p>
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-3 text-white/70">
                            <button
                              onClick={() => setRebindingAction(rebindingAction === 'attack' ? null : 'attack')}
                              className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-black text-[10px] border cursor-pointer transition-all select-none shrink-0 ${
                                rebindingAction === 'attack'
                                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                  : 'bg-cyan-950/40 border-cyan-500/30 text-cyan-400 hover:border-cyan-400/60 hover:bg-cyan-500/15'
                              }`}
                            >
                              {rebindingAction === 'attack' ? '...' : keybindings.attack.toUpperCase()}
                            </button>
                            <div>
                              <p className="text-xs text-white/90 font-bold"><strong className="text-cyan-400">Grav Slam</strong> (With Hammer) / <strong className="text-red-400">Assault Lunge</strong> (Sword)</p>
                              <p className="text-[11px] text-white/55 leading-normal">Primary attack — context-sensitive by equipped weapon.</p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3 text-white/70 border-t border-white/5 pt-2.5">
                            <button
                              onClick={() => setRebindingAction(rebindingAction === 'altAttack' ? null : 'altAttack')}
                              className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-black text-[10px] border cursor-pointer transition-all select-none shrink-0 ${
                                rebindingAction === 'altAttack'
                                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                                  : 'bg-purple-950/40 border-purple-500/30 text-purple-400 hover:border-purple-400/60 hover:bg-purple-500/15'
                              }`}
                            >
                              {rebindingAction === 'altAttack' ? '...' : keybindings.altAttack.toUpperCase()}
                            </button>
                            <div>
                              <p className="text-xs text-white/90 font-bold"><strong className="text-purple-400">Quick Slash</strong> (With Sword)</p>
                              <p className="text-[11px] text-white/55 leading-normal">Swift front slash for immediate counter attacks.</p>
                            </div>
                          </div>

                          {/* Special Combo */}
                          <div className="flex items-center gap-2.5 border-t border-amber-500/10 bg-amber-500/5 p-2.5 rounded mt-1">
                            <span className="text-amber-500 text-xs font-bold select-none">Combo:</span>
                            <span className="text-white/80 text-[11px] leading-relaxed">
                              <strong>Hammer Jump</strong>: {keybindings.attack.toUpperCase()} then immediately press <kbd className="bg-black/30 px-1.5 py-0.5 font-bold rounded text-[10px]">{keybindings.jump === ' ' ? 'SPACE' : keybindings.jump.toUpperCase()}</kbd> to launch high!
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Mouse Diagram */}
                      <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                        <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Mouse Controls</p>
                        <div className="flex items-center justify-center gap-6">
                          <div className="relative w-20 h-28 flex flex-col rounded-[2rem] border-2 border-white/15 bg-black/40 overflow-hidden select-none">
                            {/* Left Button */}
                            <div className={`flex-1 flex items-center justify-center border-b border-r border-white/10 text-[9px] font-mono font-black uppercase tracking-wider transition-colors ${
                              keybindings.attack === 'lmb' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-white/5 text-white/30'
                            }`}>
                              {keybindings.attack === 'lmb' ? 'ATK' : ''}
                            </div>
                            {/* Right Button */}
                            <div className={`flex-1 flex items-center justify-center border-b border-l border-white/10 text-[9px] font-mono font-black uppercase tracking-wider transition-colors absolute top-0 right-0 w-1/2 h-1/2 ${
                              keybindings.altAttack === 'rmb' ? 'bg-purple-500/15 text-purple-400' : 'bg-white/5 text-white/30'
                            }`}>
                              {keybindings.altAttack === 'rmb' ? 'ALT' : ''}
                            </div>
                            {/* Scroll Wheel */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-5 bg-white/10 rounded-full border border-white/20" />
                            {/* Body */}
                            <div className="flex-1" />
                          </div>
                          <div className="flex flex-col gap-1.5 text-[11px] text-white/60">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-cyan-500/60" />
                              <span>Left Click — <span className="text-cyan-400 font-bold">Attack</span></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-purple-500/60" />
                              <span>Right Click — <span className="text-purple-400 font-bold">Alt Attack</span></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-500/60" />
                              <span>Scroll Wheel — <span className="text-amber-400 font-bold">Swap Weapon</span></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-white/30" />
                              <span>Mouse Move — <span className="text-white/80 font-bold">Aim / Look</span></span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Reset + Footer */}
                      <div className="flex items-center justify-between px-2 py-2 border-t border-white/5 mt-1 font-mono text-xs text-white/40 shrink-0">
                        <button
                          onClick={() => {
                            setKeybindings({ ...DEFAULT_KEYBINDINGS });
                            setRebindingAction(null);
                            try { localStorage.setItem('grifball_keybindings', JSON.stringify(DEFAULT_KEYBINDINGS)); } catch (e) {}
                          }}
                          className="text-[10px] text-amber-400/70 hover:text-amber-400 font-bold uppercase tracking-wider cursor-pointer transition-colors bg-transparent border-none p-0"
                        >
                          ↻ Reset All Keybinds
                        </button>
                        <span>VERSION 1.4 PROTOTYPE</span>
                      </div>

                    </div>
                  </div>
                )}

                {rightPanelTab === 'customize' && (
                  <div className="flex-grow flex flex-col min-h-0 overflow-y-auto pr-1 justify-between gap-4">
                    <div className="flex flex-col gap-4">
                      {/* Rotating 3D character */}
                      <div className="relative bg-slate-950/30 border border-white/5 rounded-xl select-none overflow-hidden h-[380px] shrink-0">
                        <CharacterPreview hue={adminSettings.playerHue ?? 200} heldWeapon={customizerWeapon} />
                      </div>

                      {/* Controls grid */}
                      <div className="flex flex-col gap-3 font-sans text-xs">
                        
                        {/* Interactive HSL slider */}
                        <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">Armor Color Hue angle</span>
                            <span 
                              className="font-mono text-xs font-black uppercase px-2 py-0.5 rounded border shadow"
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
                            className="w-full h-2.5 bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-cyan-500 via-blue-500 via-purple-500 to-red-500 rounded-lg appearance-none cursor-pointer outline-none shadow-inner"
                            style={{ WebkitAppearance: 'none' }}
                          />
                        </div>

                        {/* Presets */}
                        <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                          <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Color presets Swatches</span>
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
                                    ? 'ring-1 ring-white ring-offset-2 ring-offset-slate-950 scale-110 shadow-lg' 
                                    : 'hover:scale-105 hover:opacity-90'
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Held Weapon Selection */}
                        <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                          <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Pose Weapon preview</span>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { id: 'none', label: '🛡️ Fists' },
                              { id: 'hammer', label: '🔨 Hammer' },
                              { id: 'sword', label: '⚔️ Sword' },
                            ].map((w) => (
                              <button
                                key={w.id}
                                onClick={() => setCustomizerWeapon(w.id as any)}
                                className={`py-2 text-xs font-bold uppercase tracking-wider border rounded cursor-pointer transition-all active:scale-98 ${
                                  customizerWeapon === w.id
                                    ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.2)] font-black'
                                    : 'bg-black/30 border-white/10 text-white/50 hover:text-white hover:border-white/20'
                                }`}
                              >
                                {w.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Spartan Nickname Handle */}
                        <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                          <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Spartan Nickname Handle</span>
                          <div className="relative">
                            <input
                              type="text"
                              maxLength={10}
                              value={playerName}
                              onChange={(e) => handlePlayerNameChange(e.target.value)}
                              placeholder="Max 10 characters..."
                              className="w-full h-11 bg-black/60 border border-white/10 rounded px-3.5 text-sm tracking-wide text-white focus:border-[#38bdf8] outline-none transition-all font-sans"
                            />
                            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          </div>
                        </div>

                        {/* Neural Save System Panel */}
                        <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-2.5">
                          <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5">
                              💾 Neural Backup System
                            </span>
                            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1.5 shrink-0 select-none animate-pulse">
                              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block" />
                              LOCAL_COOKIE_ACTIVE
                            </span>
                          </div>
                          
                          <p className="text-xs text-white/50 leading-normal">
                            All configs, layouts, colors, and Spartan handles are synced locally. Export a decryption code to share or migrate your profile!
                          </p>

                          {saveSystemStatus.type && (
                            <div className={`p-2.5 rounded text-xs font-mono border ${
                              saveSystemStatus.type === 'success' 
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                                : 'bg-red-500/10 border-red-500/30 text-red-400'
                            }`}>
                              {saveSystemStatus.type === 'success' ? '⚡ ' : '⚠️ '}
                              {saveSystemStatus.message}
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button
                              onClick={handleExportSaveCode}
                              className="flex-1 py-2 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/30 border border-[#38bdf8]/30 text-[#38bdf8] font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98]"
                            >
                              📋 Export Save Code
                            </button>
                            <button
                              onClick={handleResetAllSettings}
                              className="py-2 px-3.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98]"
                              title="Wipe client database"
                            >
                              💥 Wipe Saves
                            </button>
                          </div>

                          <div className="flex flex-col gap-1.5 mt-1 border-t border-white/5 pt-2.5">
                            <span className="text-[10px] text-white/30 uppercase tracking-widest font-mono">Import Cybernetic Code:</span>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={saveCodeImportInput}
                                onChange={(e) => setSaveCodeImportInput(e.target.value)}
                                placeholder="Paste GRIF-DEC- code here..."
                                className="flex-1 h-10 bg-black/60 border border-white/10 rounded px-3 font-mono text-xs text-white placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all"
                              />
                              <button
                                onClick={() => handleImportSaveCode(saveCodeImportInput)}
                                disabled={!saveCodeImportInput}
                                className={`px-4 h-10 font-sans font-bold text-xs uppercase tracking-wider rounded transition-all border outline-none ${
                                  saveCodeImportInput
                                    ? 'bg-emerald-500/15 hover:bg-emerald-500/35 border-emerald-500/40 text-emerald-400 cursor-pointer'
                                    : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                                }`}
                              >
                                Decrypt
                              </button>
                            </div>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* COLUMN 3: GLOBAL CHAT (ALWAYS VISIBLE!) */}
              <div className="flex flex-col h-full min-h-0 border-t lg:border-t-0 lg:border-l border-white/10 pt-8 lg:pt-0 lg:pl-8">
                <div className="flex items-center gap-2.5 mb-4 shrink-0">
                  <span className="w-2 h-4 bg-[#38bdf8]" />
                  <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
                    🌐 Global Chat
                  </h2>
                </div>

                <GlobalChatPanel
                  messages={lobbyChatMessages}
                  onSendMessage={sendLobbyChatMessage}
                />
              </div>

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

                {multiplayerRole === 'observer' ? (
                  <button 
                    id="join-player-btn"
                    onClick={handleJoinPlayer}
                    className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-widest transition-all cursor-pointer rounded flex items-center justify-center gap-2 border border-emerald-400/30"
                  >
                    🚀 Join As Player
                  </button>
                ) : (
                  <button 
                    id="join-observer-btn"
                    onClick={handleJoinObserver}
                    className="w-full h-12 bg-amber-600/30 hover:bg-amber-500/40 border border-amber-500/30 text-amber-400 font-bold text-xs uppercase tracking-widest transition-all cursor-pointer rounded flex items-center justify-center gap-2"
                  >
                    👁️ Join Observer
                  </button>
                )}

                {!isMultiplayer && (
                  <button 
                    id="bot-config-btn"
                    onClick={() => setShowBotSetupMenu(true)}
                    className="w-full h-12 bg-blue-950/30 hover:bg-blue-900/40 border border-blue-500/30 text-blue-400 font-bold text-xs uppercase tracking-widest transition-all cursor-pointer rounded flex items-center justify-center gap-2"
                  >
                    🤖 Bot Configuration
                  </button>
                )}

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

                  {/* AI Neural Configuration Section (New!) */}
                  <div className="border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5">
                    <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono flex items-center justify-between">
                      <span>9. AI Combat Neural Matrix</span>
                      <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.2 rounded font-sans tracking-normal uppercase border border-cyan-500/30">Intelligence</span>
                    </p>

                    {/* Preset dropdown */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-white/50 uppercase tracking-widest font-mono">Cognitive Matrix Preset:</span>
                      <select
                        value={adminSettings.aiDifficulty || 'normal'}
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, aiDifficulty: e.target.value as any }))}
                        className="w-full h-8 bg-black/60 border border-white/10 rounded px-2 text-xs text-cyan-400 font-bold uppercase outline-none focus:border-cyan-400 cursor-pointer transition-all font-sans"
                      >
                        <option value="easy">🟢 Easy (Sub-Normal)</option>
                        <option value="normal">🔵 Normal (Adaptive)</option>
                        <option value="hard">🟡 Hard (Punishing)</option>
                        <option value="nightmare">🔴 Nightmare (Grandmaster)</option>
                        <option value="custom">⚙️ Custom Matrix Override</option>
                      </select>
                    </div>

                    {/* Custom Matrix Override Controls */}
                    {adminSettings.aiDifficulty === 'custom' && (
                      <div className="flex flex-col gap-2.5 pt-1 border-t border-white/5 mt-1 animate-fade-in">
                        {/* Reaction Latency */}
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-[9px] font-mono uppercase tracking-wider text-white/60">
                            <span>Reflex Latency</span>
                            <span className="text-cyan-400 font-bold">{(adminSettings.aiReactionLatency ?? 0.25).toFixed(2)}s</span>
                          </div>
                          <input 
                            type="range" 
                            min="0.00" 
                            max="1.50" 
                            step="0.05"
                            value={adminSettings.aiReactionLatency ?? 0.25} 
                            onChange={(e) => setAdminSettings(prev => ({ ...prev, aiReactionLatency: parseFloat(e.target.value) }))}
                            className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>

                        {/* Anticipation Factor */}
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-[9px] font-mono uppercase tracking-wider text-white/60">
                            <span>Anticipation Engine</span>
                            <span className="text-cyan-400 font-bold">{Math.round((adminSettings.aiAnticipationFactor ?? 0.40) * 100)}%</span>
                          </div>
                          <input 
                            type="range" 
                            min="0.00" 
                            max="1.00" 
                            step="0.05"
                            value={adminSettings.aiAnticipationFactor ?? 0.40} 
                            onChange={(e) => setAdminSettings(prev => ({ ...prev, aiAnticipationFactor: parseFloat(e.target.value) }))}
                            className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>

                        {/* Movement Complexity */}
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-[9px] font-mono uppercase tracking-wider text-white/60">
                            <span>Strafe & Evade Complexity</span>
                            <span className="text-cyan-400 font-bold">{adminSettings.aiMovementComplexity ?? 50}%</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            step="5"
                            value={adminSettings.aiMovementComplexity ?? 50} 
                            onChange={(e) => setAdminSettings(prev => ({ ...prev, aiMovementComplexity: parseInt(e.target.value) }))}
                            className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>

                        {/* Weapon Swap IQ */}
                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between text-[9px] font-mono uppercase tracking-wider text-white/60">
                            <span>Weapon Swapping IQ</span>
                            <span className="text-cyan-400 font-bold">{adminSettings.aiWeaponSwapIQ ?? 50}%</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            step="5"
                            value={adminSettings.aiWeaponSwapIQ ?? 50} 
                            onChange={(e) => setAdminSettings(prev => ({ ...prev, aiWeaponSwapIQ: parseInt(e.target.value) }))}
                            className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                      </div>
                    )}
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

                  {/* Name Visibility Controls (New!) */}
                  <div className="border border-white/5 rounded-xl p-2.5 bg-white/1 flex flex-col gap-2.5">
                    <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest border-b border-white/5 pb-1 font-mono flex items-center justify-between">
                      <span>8. Name Visibility</span>
                      <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.2 rounded font-sans tracking-normal uppercase border border-cyan-500/30">Visuals</span>
                    </p>
                    
                    {/* Name Appearance Distance */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Appearance Distance</span>
                        <span className="text-cyan-400 font-mono">{adminSettings.nameVisibilityDistance?.toFixed(1) ?? '15.0'}m</span>
                      </div>
                      <input 
                        type="range" 
                        min="1.0" 
                        max="50.0" 
                        step="1.0"
                        value={adminSettings.nameVisibilityDistance ?? 15.0} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, nameVisibilityDistance: parseFloat(e.target.value) }))}
                        className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Name Font Size */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Font Size</span>
                        <span className="text-cyan-400 font-mono">{adminSettings.nameVisibilityFontSize ?? 16}px</span>
                      </div>
                      <input 
                        type="range" 
                        min="10" 
                        max="36" 
                        step="1"
                        value={adminSettings.nameVisibilityFontSize ?? 16} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, nameVisibilityFontSize: parseInt(e.target.value) }))}
                        className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Name Opacity */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                        <span>Opacity</span>
                        <span className="text-cyan-400 font-mono">{Math.round((adminSettings.nameVisibilityOpacity ?? 0.8) * 100)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.10" 
                        max="1.00" 
                        step="0.05"
                        value={adminSettings.nameVisibilityOpacity ?? 0.8} 
                        onChange={(e) => setAdminSettings(prev => ({ ...prev, nameVisibilityOpacity: parseFloat(e.target.value) }))}
                        className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Name Color */}
                    <div className="flex justify-between items-center text-xs pt-1.5 border-t border-white/5 gap-2">
                      <div className="flex flex-col text-left">
                        <span className="font-bold text-white/90">Name Color</span>
                        <span className="text-[9px] text-white/40">HUD text fill</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input 
                          type="color" 
                          value={adminSettings.nameVisibilityColor ?? '#00ffff'} 
                          onChange={(e) => setAdminSettings(prev => ({ ...prev, nameVisibilityColor: e.target.value }))}
                          className="w-8 h-8 rounded border border-white/20 bg-transparent cursor-pointer p-0 animate-fade-in"
                          title="Choose Color"
                        />
                        <input 
                          type="text" 
                          value={adminSettings.nameVisibilityColor ?? '#00ffff'} 
                          onChange={(e) => setAdminSettings(prev => ({ ...prev, nameVisibilityColor: e.target.value }))}
                          className="w-20 h-7 bg-black/40 border border-white/10 rounded px-2 font-mono text-[10px] tracking-wide text-white focus:border-cyan-400 outline-none text-center"
                        />
                      </div>
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

      {/* BOT SETUP MENU MODAL OVERLAY */}
      {showBotSetupMenu && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none">
          <div className="w-full max-w-2xl bg-slate-900/60 border border-blue-500/20 backdrop-blur-2xl rounded-2xl p-6 shadow-[0_0_60px_rgba(56,189,248,0.08)] flex flex-col gap-5 max-h-[95vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div className="flex flex-col">
                <p className="text-[10px] text-blue-400 font-bold tracking-[0.3em] uppercase mb-1 font-display">COMBAT SIMULATION</p>
                <h3 className="text-xl font-sans font-black tracking-tight uppercase text-white">
                  AI Combatant Grid Setup
                </h3>
              </div>
              <button
                onClick={() => setShowBotSetupMenu(false)}
                className="text-white/40 hover:text-white text-lg font-bold cursor-pointer transition-colors px-2 py-1 rounded hover:bg-white/5"
              >
                ✕
              </button>
            </div>

            {/* Bot Count Slider */}
            <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Active AI Combatants</span>
                <span className="text-lg font-black font-mono text-blue-400">{offlineBotCount} <span className="text-xs text-white/40 font-normal">BOTS</span></span>
              </div>
              <input
                type="range"
                min="1"
                max="7"
                value={offlineBotCount}
                onChange={(e) => setOfflineBotCount(parseInt(e.target.value))}
                className="w-full accent-blue-400 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-white/30 uppercase">
                <span>1 Bot</span>
                <span>7 Bots</span>
              </div>
            </div>

            {/* Holographic Combatant Grid */}
            <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">Holographic Combatant Grid</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* Slot 1: Player */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex flex-col items-center gap-1.5 text-center">
                  <div className="w-8 h-8 rounded-full border-2 border-blue-400 flex items-center justify-center text-sm" style={{ backgroundColor: `hsl(${adminSettings.playerHue}, 80%, 25%)` }}>
                    👤
                  </div>
                  <span className="text-[10px] font-black text-blue-300 uppercase tracking-wider truncate max-w-full">{playerName}</span>
                  <span className="text-[8px] font-mono text-blue-400/60 uppercase">PLAYER</span>
                </div>

                {/* Slot 2: Main AI (DoomBot Blue) */}
                <div className={`rounded-lg p-3 flex flex-col items-center gap-1.5 text-center transition-all ${1 <= offlineBotCount ? 'bg-white/5 border border-white/10' : 'bg-white/2 border border-white/5 opacity-20'}`}>
                  <div
                    className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm"
                    style={{
                      borderColor: `hsl(${botColors.main_ai ?? 0}, 60%, 50%)`,
                      backgroundColor: `hsl(${botColors.main_ai ?? 0}, 60%, 15%)`,
                    }}
                  >
                    🤖
                  </div>
                  <span className="text-[10px] font-bold text-white/60 uppercase tracking-wide">DoomBot</span>
                  <div className="flex flex-wrap justify-center gap-0.5">
                    {BOT_COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.hue}
                        title={preset.label}
                        onClick={() => setBotColors(prev => ({ ...prev, main_ai: preset.hue }))}
                        className="w-3 h-3 rounded-full cursor-pointer transition-transform hover:scale-125"
                        style={{
                          backgroundColor: `hsl(${preset.hue}, 75%, 50%)`,
                          outline: (botColors.main_ai ?? 0) === preset.hue ? '2px solid white' : '2px solid transparent',
                          outlineOffset: '1px',
                        }}
                      />
                    ))}
                  </div>
                  {1 <= offlineBotCount && (
                    <select
                      value={botDifficulties.main_ai || 'normal'}
                      onChange={(e) => setBotDifficulties(prev => ({ ...prev, main_ai: e.target.value as any }))}
                      className="w-full h-7 bg-black/60 border border-white/10 rounded px-1.5 text-[10px] text-white/70 font-bold uppercase outline-none focus:border-blue-400 cursor-pointer transition-all font-sans"
                    >
                      <option value="easy">🟢 Easy</option>
                      <option value="normal">🔵 Normal</option>
                      <option value="hard">🟡 Hard</option>
                      <option value="nightmare">🔴 Nightmare</option>
                    </select>
                  )}
                </div>

                {/* Slots 3-8: Custom bots */}
                {[
                  { id: 'bot_2', name: 'DoomBot Green', hue: 120 },
                  { id: 'bot_3', name: 'DoomBot Purple', hue: 280 },
                  { id: 'bot_4', name: 'DoomBot Orange', hue: 45 },
                  { id: 'bot_5', name: 'DoomBot Yellow', hue: 60 },
                  { id: 'bot_6', name: 'DoomBot Magenta', hue: 320 },
                  { id: 'bot_7', name: 'DoomBot Cyan', hue: 180 },
                ].map((bot, idx) => {
                  const slotActive = idx + 2 <= offlineBotCount;
                  return (
                    <div
                      key={bot.id}
                      className={`rounded-lg p-3 flex flex-col items-center gap-1.5 text-center transition-all ${slotActive ? 'bg-white/5 border border-white/10' : 'bg-white/2 border border-white/5 opacity-20'}`}
                    >
                      <div
                        className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm"
                        style={{
                          borderColor: `hsl(${botColors[bot.id] ?? bot.hue}, 60%, 50%)`,
                          backgroundColor: `hsl(${botColors[bot.id] ?? bot.hue}, 60%, 15%)`,
                        }}
                      >
                        🤖
                      </div>
                      <span className="text-[10px] font-bold text-white/60 uppercase tracking-wide truncate max-w-full">{bot.name}</span>
                      <div className="flex flex-wrap justify-center gap-0.5">
                        {BOT_COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.hue}
                            title={preset.label}
                            onClick={() => setBotColors(prev => ({ ...prev, [bot.id]: preset.hue }))}
                            className="w-3 h-3 rounded-full cursor-pointer transition-transform hover:scale-125"
                            style={{
                              backgroundColor: `hsl(${preset.hue}, 75%, 50%)`,
                              outline: (botColors[bot.id] ?? bot.hue) === preset.hue ? '2px solid white' : '2px solid transparent',
                              outlineOffset: '1px',
                            }}
                          />
                        ))}
                      </div>
                      {slotActive && (
                        <select
                          value={botDifficulties[bot.id] || 'normal'}
                          onChange={(e) => setBotDifficulties(prev => ({ ...prev, [bot.id]: e.target.value as any }))}
                          className="w-full h-7 bg-black/60 border border-white/10 rounded px-1.5 text-[10px] text-white/70 font-bold uppercase outline-none focus:border-blue-400 cursor-pointer transition-all font-sans"
                        >
                          <option value="easy">🟢 Easy</option>
                          <option value="normal">🔵 Normal</option>
                          <option value="hard">🟡 Hard</option>
                          <option value="nightmare">🔴 Nightmare</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono shrink-0">Presets:</span>
              <button
                onClick={() => {
                  const all: Record<string, 'easy' | 'normal' | 'hard' | 'nightmare'> = {};
                  ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'].forEach(k => all[k] = 'normal');
                  setBotDifficulties(all);
                }}
                className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
              >
                All Normal
              </button>
              <button
                onClick={() => {
                  const all: Record<string, 'easy' | 'normal' | 'hard' | 'nightmare'> = {};
                  ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'].forEach(k => all[k] = 'nightmare');
                  setBotDifficulties(all);
                }}
                className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
              >
                All Nightmare
              </button>
              <button
                onClick={() => {
                  const levels: ('easy' | 'normal' | 'hard' | 'nightmare')[] = ['easy', 'normal', 'normal', 'hard', 'hard', 'nightmare', 'nightmare'];
                  const keys = ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'];
                  const grad: Record<string, 'easy' | 'normal' | 'hard' | 'nightmare'> = {};
                  keys.forEach((k, i) => grad[k] = levels[i]);
                  setBotDifficulties(grad);
                }}
                className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
              >
                Graduated
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-1">
              {isPlaying ? (
                <button
                  onClick={() => {
                    setShowBotSetupMenu(false);
                    setIsPaused(false);
                  }}
                  className="flex-1 h-12 bg-white hover:bg-blue-400 hover:text-white text-slate-900 font-black text-xs uppercase tracking-widest rounded cursor-pointer transition-all active:scale-[0.98] shadow-lg"
                >
                  Apply & Resume
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowBotSetupMenu(false);
                    handleStartGame();
                  }}
                  className="flex-1 h-12 bg-white hover:bg-blue-400 hover:text-white text-slate-900 font-black text-xs uppercase tracking-widest rounded cursor-pointer transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Initialize Simulation
                </button>
              )}
              <button
                onClick={() => setShowBotSetupMenu(false)}
                className="px-5 h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 font-bold text-xs uppercase tracking-widest rounded cursor-pointer transition-all"
              >
                Cancel
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
