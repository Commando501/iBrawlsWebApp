import express from "express";
import path from "path";
import http from "http";
import os from "os";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { LIVE_CONFIG_KEY_SET } from "./worker/src/liveConfigKeys";
import { sanitizeCharacterLoadoutForNetwork } from "./src/components/customArmor";
import { normalizePublicRoomCode } from "./src/network/roomCodePrivacy";
import {
  createMatchLobbySummary,
  normalizeMatchLobbyConfig,
  sanitizeLobbyPassword,
} from "./src/network/matchLobbyConfig";
import type { MatchLobbyConfig, MatchLobbySummary } from "./src/network/protocol";
import {
  createLobbyChatRateLimitState,
  validateLobbyChatMessage,
} from "./worker/src/lobbyChatRateLimit";

// ── Live Tuning dev parity ────────────────────────────────────────────────────
// The Cloudflare Worker stores the Official Multiplayer Preset in D1. D1 doesn't
// exist in the plain-Node dev path, so we mirror GET/POST /api/config with a JSON
// file. Keep the seed identical to worker/migrations/0001_init.sql.
const CONFIG_FILE = path.join(process.cwd(), "data", "multiplayer-config.json");

const SEED_CONFIG = {
  version: 1,
  label: "Default Ruleset",
  settings: {
    maxHP: 1, speedForward: 100, speedSide: 100, speedBackward: 100,
    attackRange: 3.2, attackRadius: 4.5, dashDistance: 6, dashDuration: 0.25,
    dashCooldown: 2, respawnInvulnerabilityDuration: 1, hammerReloadTime: 0.6,
    hammerSlamWindupTime: 0.28, hammerSlamAttackTime: 0.12,
    hammerSlamTimingLocked: true, hammerMeleeSpeed: 0.24, hammerMeleeReload: 0.5,
    hammerSplashVfx: "current",
    swordLungeVfx: "current", swordLungeDistance: 14.5, swordLungeSpeed: 24,
    swordSlashSpeed: 0.22, swordSlashReload: 0.6, swordLungeReload: 1.2,
    hammerJumpPower: 6.5, hammerJumpTriggerRadius: 3.5, hammerJumpWindow: 0.6,
    hammerJumpInputGate: 0, hammerJumpAirLimit: 1, visualizeJumpZone: true,
    directLightIntensity: 1.6, ambientLightIntensity: 0.82, skyboxBrightness: 4,
    skyboxHue: 224, showSkybox: true, enableSwordTrade: true,
    enableHammerSwordTrade: true, swordTradeWindow: 350, hammerSwordTradeWindow: 350,
    nameVisibilityDistance: 15, nameVisibilityColor: "#00ffff",
    nameVisibilityOpacity: 0.8, nameVisibilityFontSize: 16, aiDifficulty: "normal",
    aiReactionLatency: 0.25, aiAnticipationFactor: 0.4, aiMovementComplexity: 50,
    aiWeaponSwapIQ: 50, aiPlaystyle: 50, aiWeaponPrioritization: 50,
    aiArchetype: "none", enableBurnDecals: true, weaponReadyTime: 0.5,
    weaponSwapLockout: 1, enableSlide: false, enableSprint: false,
    speedSprint: 140, speedSlide: 160, slideDistance: 8, slideCooldown: 1.5,
    gameMode: "sandbox", iBrawlsKillTarget: 25, matchTimerSeconds: 522,
    grifballGoalTarget: 5,
  } as Record<string, unknown>,
};

function readLiveConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return SEED_CONFIG;
  }
}

function writeLiveConfig(config: unknown) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to persist multiplayer config:", err);
  }
}

const MAX_PLAYER_NAME_LENGTH = 10;
const MAX_ROOM_CLIENTS = 7;
const MAX_ROOM_PLAYERS = 1 + MAX_ROOM_CLIENTS;
const SIGNED_IN_ELSEWHERE_CLOSE_CODE = 4001;
const SIGNED_IN_ELSEWHERE_MESSAGE = "Signed in elsewhere. This page was taken offline to prevent account cloning.";

function normalizePlayerName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const normalized = name.trim().substring(0, MAX_PLAYER_NAME_LENGTH);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePlayerHue(hue: unknown): number | undefined {
  if (typeof hue !== "number" || !Number.isFinite(hue)) return undefined;
  return Math.max(0, Math.min(360, Math.round(hue)));
}

function normalizePlayerLoadout(loadout: unknown): unknown | undefined {
  return sanitizeCharacterLoadoutForNetwork(loadout);
}

function applyGameplayIdentity(socket: WebSocket, message: any) {
  const name = normalizePlayerName(message?.playerName);
  const hue = normalizePlayerHue(message?.hue);
  const loadout = normalizePlayerLoadout(message?.loadout);
  if (name) (socket as any).playerName = name;
  if (hue !== undefined) (socket as any).playerHue = hue;
  if (loadout) (socket as any).playerLoadout = loadout;
}

// Helper to resolve the host machine's physical LAN IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    const addresses = interfaces[interfaceName];
    if (addresses) {
      for (const address of addresses) {
        if (address.family === "IPv4" && !address.internal) {
          return address.address;
        }
      }
    }
  }
  return "127.0.0.1";
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  interface Room {
    host: WebSocket;
    clients: WebSocket[]; // Array of up to MAX_ROOM_CLIENTS guest clients
    observers: Set<WebSocket>;
    keys: string[];
    lobbyConfig: MatchLobbyConfig;
    passwordHash?: string;
    inviteTokens: Map<string, string>;
    matchStarted: boolean;
    quickplayReserved?: boolean;
  }


  // Track active matchmaking rooms by string identifier key
  const rooms = new Map<string, Room>();
  // Direct tracking lookup from socket reference to its active room
  const socketToRoom = new Map<WebSocket, Room>();

  // Quick Play matchmaking structures
  const quickPlayQueue = new Set<WebSocket>();
  const waitingQuickPlayClients = new Map<string, WebSocket>();
  const lobbyStartedAtByRoomCode = new Map<string, number>();

  function getSocketId(socket: WebSocket): string {
    return String((socket as any).id || "");
  }

  function getRoomPublicCode(room: Room): string | undefined {
    for (const key of room.keys) {
      const publicCode = normalizePublicRoomCode(key);
      if (publicCode) return publicCode;
    }
    return undefined;
  }

  function normalizePresenceId(value: unknown, maxLength = 128): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().slice(0, maxLength);
    return normalized.length > 0 ? normalized : undefined;
  }

  function getLobbyStartedAt(roomCode: string): number {
    const existing = lobbyStartedAtByRoomCode.get(roomCode);
    if (existing) return existing;
    const startedAt = Date.now();
    lobbyStartedAtByRoomCode.set(roomCode, startedAt);
    return startedAt;
  }

  function hashLobbyPassword(password: string): string {
    let hash = 2166136261;
    for (let i = 0; i < password.length; i += 1) {
      hash ^= password.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function createInviteToken(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function getRoomPlayerCount(room: Room): number {
    return 1 + room.clients.length;
  }

  function hasRoomPlayerSpace(room: Room): boolean {
    return getRoomPlayerCount(room) < room.lobbyConfig.maxPlayers;
  }

  function buildPresenceLobbySummary(value: unknown): MatchLobbySummary | undefined {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Record<string, unknown>;
    return createMatchLobbySummary(normalizeMatchLobbyConfig(raw as Partial<MatchLobbyConfig>), {
      hasPassword: Boolean(raw.hasPassword),
      inProgress: Boolean(raw.inProgress),
    });
  }

  function buildRoomLobbySummary(room: Room): MatchLobbySummary {
    return createMatchLobbySummary(room.lobbyConfig, {
      hasPassword: Boolean(room.passwordHash),
      inProgress: room.matchStarted,
    });
  }

  function getInviteTokenBypass(room: Room, clientId: string, inviteToken: unknown): boolean {
    return typeof inviteToken === "string" && room.inviteTokens.get(clientId) === inviteToken;
  }

  function broadcastToRoom(room: Room, payload: string) {
    const recipients = [room.host, ...room.clients, ...Array.from(room.observers)];
    recipients.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.send(payload); } catch {}
      }
    });
  }

  function pruneInactiveLobbyStartTimes(activeRoomCodes: Set<string>) {
    for (const roomCode of lobbyStartedAtByRoomCode.keys()) {
      if (!activeRoomCodes.has(roomCode)) {
        lobbyStartedAtByRoomCode.delete(roomCode);
      }
    }
  }

  function getSocketParticipantEntry(socket: WebSocket, role: "host" | "client" | "observer", spawnSlot?: number) {
    const socketId = getSocketId(socket);
    return {
      clientId: socketId,
      role,
      spawnSlot,
      playerName: normalizePlayerName((socket as any).playerName) || `Client ${socketId}`,
      hue: normalizePlayerHue((socket as any).playerHue),
      loadout: normalizePlayerLoadout((socket as any).playerLoadout),
    };
  }

  function getRoomPlayerEntries(room: Room) {
    return [
      getSocketParticipantEntry(room.host, "host", 0),
      ...room.clients.map((client, index) => getSocketParticipantEntry(client, "client", index + 1)),
    ];
  }

  function getRoomParticipantEntries(room: Room) {
    return [
      ...getRoomPlayerEntries(room),
      ...Array.from(room.observers).map(observer => getSocketParticipantEntry(observer, "observer")),
    ];
  }

  function getOtherRoomPlayerEntries(room: Room, selfId: string) {
    return getRoomPlayerEntries(room).filter(player => player.clientId !== selfId);
  }

  function getOtherRoomParticipantEntries(room: Room, selfId: string) {
    return getRoomParticipantEntries(room).filter(player => player.clientId !== selfId);
  }

  function getRoomSpawnSlot(room: Room, socket: WebSocket): number {
    const socketId = getSocketId(socket);
    if (room.host === socket || getSocketId(room.host) === socketId) return 0;
    const index = room.clients.findIndex(client => client === socket || getSocketId(client) === socketId);
    return index >= 0 ? index + 1 : 0;
  }

  // Helper to clean up dead sockets from the quickplay queue
  function cleanQuickPlayQueue() {
    for (const socket of quickPlayQueue) {
      if (socket.readyState !== WebSocket.OPEN) {
        quickPlayQueue.delete(socket);
      }
    }
  }

  app.use(express.json());

  // GET /api/config — dev mirror of the Worker's official-preset read.
  app.get("/api/config", (req, res) => {
    const config = readLiveConfig();
    const etag = `"v${config.version}"`;
    if (req.headers["if-none-match"] === etag) {
      res.status(304).set("ETag", etag).end();
      return;
    }
    res.set("ETag", etag).set("Cache-Control", "no-cache").json(config);
  });

  // POST /api/admin/config — dev mirror of the token-gated publish endpoint.
  app.post("/api/admin/config", (req, res) => {
    const auth = req.headers["authorization"] || "";
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken || !token || token !== adminToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = req.body || {};
    const incoming = (body.settings && typeof body.settings === "object") ? body.settings : null;
    if (!incoming) {
      res.status(400).json({ error: "No valid gameplay settings provided" });
      return;
    }
    // Keep only governed mechanic keys (drops identity + unknown keys), matching the Worker.
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      if (LIVE_CONFIG_KEY_SET.has(k)) settings[k] = v;
    }
    if (Object.keys(settings).length === 0) {
      res.status(400).json({ error: "No valid gameplay settings provided" });
      return;
    }
    const current = readLiveConfig();
    const nextVersion = (current.version || 0) + 1;
    const next = {
      version: nextVersion,
      label: typeof body.label === "string" ? body.label.slice(0, 60) : "",
      settings,
    };
    writeLiveConfig(next);

    // Broadcast the version nudge to every connected session.
    const payload = JSON.stringify({ type: "config_changed", version: nextVersion });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch {}
      }
    });

    res.json({ ok: true, version: nextVersion });
  });

  // API to fetch user's public IP & internal LAN IP
  app.get("/api/my-ip", (req, res) => {
    const forwarded = req.headers['x-forwarded-for'];
    let ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
    
    // Normalize IPv6 representation of localhost
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = '127.0.0.1';
    }
    
    res.json({ 
      ip,
      lanIp: getLocalIpAddress()
    });
  });

  // Attach WebSocket Server
  const wss = new WebSocketServer({ server });

  function closeDuplicateAccountLocations(currentSocket: WebSocket) {
    const accountId = (currentSocket as any).accountId;
    const onlineInstanceId = (currentSocket as any).onlineInstanceId;
    if (!accountId || !onlineInstanceId) return;

    wss.clients.forEach(client => {
      if (client === currentSocket || client.readyState !== WebSocket.OPEN) return;
      if ((client as any).accountId !== accountId) return;
      if ((client as any).onlineInstanceId === onlineInstanceId) return;

      try {
        client.send(JSON.stringify({
          type: "signed_in_elsewhere",
          message: SIGNED_IN_ELSEWHERE_MESSAGE
        }));
      } catch {}
      client.close(SIGNED_IN_ELSEWHERE_CLOSE_CODE, SIGNED_IN_ELSEWHERE_MESSAGE);
    });
  }

  // Broadcast updated presence count and clients list to everyone
  function updatePresence() {
    const lobbyClients = Array.from(wss.clients)
      .filter((client: any) => client.connectionType === 'lobby');
    const onlineCount = lobbyClients.length;
    const activeRoomCodes = new Set<string>();

    lobbyClients.forEach((client: any) => {
      const roomCode = normalizePublicRoomCode(client.roomCode);
      if (client.playerState === 'multi' && roomCode) {
        activeRoomCodes.add(roomCode);
      }
    });
    pruneInactiveLobbyStartTimes(activeRoomCodes);

    const clientPayloads = lobbyClients
      .map((client: any) => {
        const state = client.playerState || 'menu';
        const roomCode = normalizePublicRoomCode(client.roomCode);
        const lobby = client.lobby as MatchLobbySummary | undefined;
        const visibleRoomCode = lobby?.access === "private" ? undefined : roomCode;
        return {
          id: client.id,
          name: normalizePlayerName(client.playerName),
          state,
          roomCode: visibleRoomCode,
          spaceAvailable: client.spaceAvailable !== undefined ? client.spaceAvailable : false,
          playerCount: client.playerCount,
          maxPlayers: client.maxPlayers,
          lobbyStartedAt: state === 'multi' && visibleRoomCode ? getLobbyStartedAt(visibleRoomCode) : undefined,
          lobby
        };
      })
      .filter(c => Boolean(c.id));

    const presencePayload = JSON.stringify({
      type: "presence",
      onlineCount,
      clients: clientPayloads
    });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(presencePayload);
      }
    });
  }

  wss.on("connection", (ws, req) => {
    const wsId = Math.random().toString(36).substring(2, 9);
    (ws as any).id = wsId;
    
    // Parse connection query parameters
    const urlParams = new URLSearchParams(req.url?.split("?")[1]);
    const connectionType = urlParams.get("type") || "lobby";
    const nameParam = urlParams.get("name");
    const accountId = normalizePresenceId(urlParams.get("accountId"));
    const onlineInstanceId = normalizePresenceId(urlParams.get("onlineInstanceId"));

    (ws as any).connectionType = connectionType;
    (ws as any).accountId = accountId;
    (ws as any).onlineInstanceId = onlineInstanceId;
    (ws as any).playerState = 'menu';
    (ws as any).roomCode = undefined;
    (ws as any).spaceAvailable = false;
    (ws as any).playerName = normalizePlayerName(nameParam);
    (ws as any).playerCount = undefined;
    (ws as any).maxPlayers = undefined;
    (ws as any).lobbyStartedAt = undefined;
    (ws as any).lobbyChatRateLimit = createLobbyChatRateLimitState();
    
    console.log(`New WebSocket connection received. Assigned Socket ID: ${wsId}, Type: ${connectionType}, Name: ${nameParam}, Account: ${accountId ? "signed-in" : "guest"}`);

    closeDuplicateAccountLocations(ws);

    // Send immediate welcome greeting carrying the socket's client identity
    ws.send(JSON.stringify({ type: "welcome", clientId: wsId }));
    
    // Broadcast active roster update to everyone connected
    updatePresence();

    ws.on("message", (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());

        switch (message.type) {
          case "update_status": {
            const { status, roomCode, spaceAvailable, name, playerCount, maxPlayers } = message;
            const normalizedRoomCode = status === 'multi' ? normalizePublicRoomCode(roomCode) : undefined;
            console.log(`Client ${wsId} updating playerState to: ${status}, roomCode: ${normalizedRoomCode}, spaceAvailable: ${spaceAvailable}, name: ${name}, players: ${playerCount}/${maxPlayers}`);
            (ws as any).playerState = status;
            (ws as any).roomCode = normalizedRoomCode;
            (ws as any).spaceAvailable = spaceAvailable;
            (ws as any).playerName = normalizePlayerName(name);
            (ws as any).lobby = status === 'multi' ? buildPresenceLobbySummary(message.lobby) : undefined;
            (ws as any).playerCount = typeof playerCount === 'number' && Number.isFinite(playerCount)
              ? Math.max(0, Math.min(MAX_ROOM_PLAYERS, Math.floor(playerCount)))
              : undefined;
            (ws as any).maxPlayers = typeof maxPlayers === 'number' && Number.isFinite(maxPlayers)
              ? Math.max(1, Math.min(MAX_ROOM_PLAYERS, Math.floor(maxPlayers)))
              : undefined;
            (ws as any).lobbyStartedAt = normalizedRoomCode ? getLobbyStartedAt(normalizedRoomCode) : undefined;
            updatePresence();
            break;
          }

          case "lobby_chat": {
            const chatRateLimitState = (ws as any).lobbyChatRateLimit ?? createLobbyChatRateLimitState();
            (ws as any).lobbyChatRateLimit = chatRateLimitState;
            const chat = validateLobbyChatMessage(
              message,
              chatRateLimitState,
              (ws as any).playerName || `Client ${wsId}`,
            );
            if (chat.ok === false) {
              ws.send(JSON.stringify({ type: "error", message: chat.message }));
              break;
            }
            console.log(`Lobby chat message from ${wsId} (${chat.sender}): ${chat.text}`);
            const chatPayload = JSON.stringify({
              type: "lobby_chat",
              id: Math.random().toString(36).substring(2, 9),
              sender: chat.sender,
              text: chat.text,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              clientId: wsId
            });
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(chatPayload);
              }
            });
            break;
          }

          case "ping": {
            const { timestamp } = message;
            ws.send(JSON.stringify({ type: "pong", timestamp }));
            break;
          }

          case "send_invite": {
            const { targetId, roomCode } = message;
            const publicRoomCode = normalizePublicRoomCode(roomCode);
            console.log(`Direct invite from ${wsId} to ${targetId} referencing room ${publicRoomCode ?? "[redacted]"}`);
            let destSocket: WebSocket | null = null;
            for (const client of wss.clients) {
              if ((client as any).id === targetId) {
                destSocket = client;
                break;
              }
            }
            const inviteRoom = publicRoomCode ? rooms.get(publicRoomCode) : undefined;
            const inviteToken = inviteRoom ? createInviteToken() : undefined;
            if (inviteRoom && inviteToken) {
              inviteRoom.inviteTokens.set(targetId, inviteToken);
            }
            if (destSocket && destSocket.readyState === WebSocket.OPEN && publicRoomCode) {
              destSocket.send(JSON.stringify({
                type: "receive_invite",
                fromId: wsId,
                roomCode: publicRoomCode,
                inviteToken
              }));
            }
            break;
          }

          case "decline_invite": {
            const { targetId } = message;
            console.log(`Direct invite declined from ${wsId} targeting original host ${targetId}`);
            let destSocket: WebSocket | null = null;
            for (const client of wss.clients) {
              if ((client as any).id === targetId) {
                destSocket = client;
                break;
              }
            }
            if (destSocket && destSocket.readyState === WebSocket.OPEN) {
              destSocket.send(JSON.stringify({
                type: "invite_declined",
                fromId: wsId
              }));
            }
            break;
          }

          case "quickplay_join": {
            console.log(`Client ${wsId} requested Quick Play matchmaking.`);
            
            // 1. Search for any hosted match with an open player slot (not reserved)
            let foundRoomKey: string | null = null;
            for (const room of rooms.values()) {
              if (
                !room.matchStarted &&
                room.lobbyConfig.access === "open" &&
                !room.passwordHash &&
                hasRoomPlayerSpace(room) &&
                !room.quickplayReserved
              ) {
                const publicRoomCode = getRoomPublicCode(room);
                if (!publicRoomCode) continue;
                foundRoomKey = publicRoomCode;
                room.quickplayReserved = true; // Mark it as reserved
                break;
              }
            }


            if (foundRoomKey) {
              console.log(`Quick Play Matchmaker found open hosted lobby for client ${wsId} under key: ${foundRoomKey}`);
              ws.send(JSON.stringify({ type: "quickplay_match_found", roomCode: foundRoomKey }));
              break;
            }

            // 2. Clean dead sockets in queue and check if anyone else is waiting
            cleanQuickPlayQueue();

            if (quickPlayQueue.size > 0) {
              const peerWs = quickPlayQueue.values().next().value;
              quickPlayQueue.delete(peerWs);

              if (peerWs && peerWs.readyState === WebSocket.OPEN) {
                const qpRoomCode = "QP_" + Math.floor(100000 + Math.random() * 900000).toString();
                console.log(`Quick Play Matchmaker pairing client ${wsId} with peer ${(peerWs as any).id}. Generated Room Code: ${qpRoomCode}`);

                // Send matching coordinates
                peerWs.send(JSON.stringify({ type: "quickplay_host", roomCode: qpRoomCode }));
                waitingQuickPlayClients.set(qpRoomCode, ws);
                
                // Let the joining player know we are configuring the arena
                ws.send(JSON.stringify({ type: "quickplay_queued" }));
                break;
              }
            }

            // 3. No matches or peers available, enter queue
            quickPlayQueue.add(ws);
            console.log(`Client ${wsId} entered the Quick Play queue.`);
            ws.send(JSON.stringify({ type: "quickplay_queued" }));
            break;
          }

          case "quickplay_leave": {
            quickPlayQueue.delete(ws);
            for (const [code, clientWs] of waitingQuickPlayClients.entries()) {
              if (clientWs === ws) {
                waitingQuickPlayClients.delete(code);
              }
            }
            console.log(`Client ${wsId} left Quick Play queue.`);
            break;
          }

          case "host": {
            const { ip, lanIp, customId } = message;
            applyGameplayIdentity(ws, message);
            const lobbyConfig = normalizeMatchLobbyConfig(message.lobbyConfig);
            const password = sanitizeLobbyPassword(message.password);
            if (lobbyConfig.access === "password" && !password) {
              ws.send(JSON.stringify({ type: "error", message: "Password lobbies require a password." }));
              return;
            }
            const keysToRegister = [];
            if (ip) keysToRegister.push(ip);
            if (lanIp && lanIp !== '127.0.0.1') keysToRegister.push(lanIp);
            if (customId) keysToRegister.push(customId);

            console.log(`Registering host with keys: ${keysToRegister.join(", ")}`);

            // Create a single Room instance shared by reference across all registration keys
            const room: Room = {
              host: ws,
              clients: [],
              observers: new Set<WebSocket>(),
              keys: keysToRegister,
              lobbyConfig,
              passwordHash: password ? hashLobbyPassword(password) : undefined,
              inviteTokens: new Map<string, string>(),
              matchStarted: false,
            };

            // Register room under all given keys
            keysToRegister.forEach(key => {
              // Clean up existing room under this key if any
              const existing = rooms.get(key);
              if (existing) {
                if (existing.host !== ws) {
                  existing.host.close();
                }
                if (existing.clients) {
                  existing.clients.forEach(c => c.close());
                }
              }

              rooms.set(key, room);
            });


            socketToRoom.set(ws, room);
            ws.send(JSON.stringify({
              type: "hosted",
              keys: keysToRegister,
              clientId: wsId,
              role: "host",
              spawnSlot: 0,
              lobbyConfig
            }));

            // Trigger the waiting Quick Play client if this is a custom quickplay room code
            if (customId && waitingQuickPlayClients.has(customId)) {
              const guestWs = waitingQuickPlayClients.get(customId);
              waitingQuickPlayClients.delete(customId);
              if (guestWs && guestWs.readyState === WebSocket.OPEN) {
                console.log(`Quick Play Host registered. Dispatching match found to guest client ${(guestWs as any).id}`);
                guestWs.send(JSON.stringify({ type: "quickplay_match_found", roomCode: customId }));
              }
            }
            break;
          }

          case "join": {
            const { targetIpOrId, isObserver, inviteToken } = message;
            applyGameplayIdentity(ws, message);
            console.log(`Client attempting to join room matching: ${targetIpOrId} (isObserver: ${isObserver})`);

            const normalizedTargetCode = normalizePublicRoomCode(targetIpOrId);
            let room = rooms.get(normalizedTargetCode || targetIpOrId);
            
            // Local network fallback: If target is not found by exact string match,
            // but this server hosts exactly ONE active room (which always happens on local direct plays),
            // auto-fallback to that single lobby.
            if (!room && rooms.size > 0) {
              const singleKey = Array.from(rooms.keys())[0];
              room = rooms.get(singleKey);
              console.log(`Fallback: Lobby lookup under "${targetIpOrId}" not found. Auto-paired with active lobby (key: ${singleKey})`);
            }

            if (!room) {
              ws.send(JSON.stringify({ type: "error", message: `Match not found for: ${targetIpOrId}` }));
              return;
            }

            const inviteBypass = getInviteTokenBypass(room, wsId, inviteToken);
            if (room.passwordHash && !inviteBypass) {
              const password = sanitizeLobbyPassword(message.password);
              if (!password || hashLobbyPassword(password) !== room.passwordHash) {
                ws.send(JSON.stringify({ type: "error", message: "Lobby password is incorrect." }));
                return;
              }
            }

            if (isObserver) {
              if (!room.lobbyConfig.allowObservers) {
                ws.send(JSON.stringify({ type: "error", message: "This lobby does not allow observers." }));
                return;
              }
              room.observers.add(ws);
              socketToRoom.set(ws, room);
              console.log(`Client ${wsId} connected as observer to room.`);
              ws.send(JSON.stringify({ 
                type: "connected", 
                clientId: wsId,
                role: "observer", 
                hostClientId: (room.host as any).id, 
                clientClientId: room.clients.length > 0 ? (room.clients[0] as any).id : undefined,
                otherPlayerIds: [
                  (room.host as any).id,
                  ...room.clients.map(c => (c as any).id)
                ],
                otherPlayers: getRoomPlayerEntries(room),
                participants: getOtherRoomParticipantEntries(room, wsId),
                lobbyConfig: room.lobbyConfig,
                matchStarted: room.matchStarted,
              }));
              if (room.matchStarted) {
                ws.send(JSON.stringify({ type: "match_start", lobbyConfig: room.lobbyConfig }));
              }
              
              // Notify host and clients
              const obsJoinedPayload = JSON.stringify({
                type: "observer_joined",
                observerId: wsId,
                role: "observer",
                playerName: normalizePlayerName((ws as any).playerName) || `Client ${wsId}`,
                hue: normalizePlayerHue((ws as any).playerHue),
                loadout: normalizePlayerLoadout((ws as any).playerLoadout),
              });
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(obsJoinedPayload);
              }
              room.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) {
                  c.send(obsJoinedPayload);
                }
              });
              break;
            }

            if (!hasRoomPlayerSpace(room)) {
              ws.send(JSON.stringify({ type: "error", message: `Match is already full (${room.lobbyConfig.maxPlayers}/${room.lobbyConfig.maxPlayers} players present).` }));
              return;
            }

            if (!room.clients.includes(ws) && !room.clients.some((c: any) => c.id === wsId)) {
              room.clients.push(ws);
            }
            room.quickplayReserved = false;
            socketToRoom.set(ws, room);

            // Notify both parties that they have paired successfully
            ws.send(JSON.stringify({ 
              type: "connected", 
              clientId: wsId,
              role: "client", 
              hostClientId: (room.host as any).id, 
              clientClientId: wsId,
              spawnSlot: getRoomSpawnSlot(room, ws),
              otherPlayerIds: [
                (room.host as any).id,
                ...room.clients.filter(c => (c as any).id !== wsId).map(c => (c as any).id)
              ],
              otherPlayers: getOtherRoomPlayerEntries(room, wsId),
              participants: getOtherRoomParticipantEntries(room, wsId),
              lobbyConfig: room.lobbyConfig,
              matchStarted: room.matchStarted,
            }));
            if (room.matchStarted) {
              ws.send(JSON.stringify({ type: "match_start", lobbyConfig: room.lobbyConfig }));
            }

            // Notify host and all other clients of this new player joining
            const clientJoinedPayload = JSON.stringify({
              type: "player_joined",
              role: "client",
              clientId: wsId,
              spawnSlot: getRoomSpawnSlot(room, ws),
              playerName: normalizePlayerName((ws as any).playerName) || `Client ${wsId}`,
              hue: normalizePlayerHue((ws as any).playerHue),
              loadout: normalizePlayerLoadout((ws as any).playerLoadout),
            });

            if (room.clients.length === 1) {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(JSON.stringify({
                  type: "connected",
                  clientId: getSocketId(room.host),
                  role: "host",
                  hostClientId: getSocketId(room.host),
                  spawnSlot: 0,
                  clientClientId: wsId,
                  otherPlayerIds: [
                    wsId
                  ],
                  otherPlayers: getOtherRoomPlayerEntries(room, getSocketId(room.host)),
                  participants: getOtherRoomParticipantEntries(room, getSocketId(room.host)),
                  lobbyConfig: room.lobbyConfig,
                  matchStarted: room.matchStarted,
                }));
              }
            } else {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(clientJoinedPayload);
              }
            }

            room.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(clientJoinedPayload);
              }
            });
            break;
          }

          case "start_match": {
            const room = socketToRoom.get(ws);
            if (!room || room.host !== ws) {
              ws.send(JSON.stringify({ type: "error", message: "Only the host can start this match." }));
              break;
            }
            room.matchStarted = true;
            const payload = JSON.stringify({ type: "match_start", lobbyConfig: room.lobbyConfig });
            broadcastToRoom(room, payload);
            updatePresence();
            break;
          }

          case "change_role": {
            const { role } = message;
            let room = socketToRoom.get(ws);
            if (!room) {
              for (const r of Array.from(rooms.values())) {
                if (r.host === ws || r.clients.includes(ws) || r.observers.has(ws)) {
                  room = r;
                  socketToRoom.set(ws, r);
                  break;
                }
              }
            }
            if (!room) {
              ws.send(JSON.stringify({ type: "error", message: "Room matching reference lost." }));
              break;
            }

            if (role === 'observer') {
              if (!room.lobbyConfig.allowObservers) {
                ws.send(JSON.stringify({ type: "error", message: "This lobby does not allow observers." }));
                break;
              }
              // Transitioning from Player (client) to Observer
              const clientIdx = room.clients.indexOf(ws);
              if (clientIdx !== -1) {
                room.clients.splice(clientIdx, 1);
                room.observers.add(ws);
                ws.send(JSON.stringify({ type: "role_changed", role: "observer" }));
                
                // Let host know opponent went observer
                const changedPayload = JSON.stringify({ type: "opponent_role_changed", clientId: wsId, role: "observer" });
                if (room.host && room.host.readyState === WebSocket.OPEN) {
                  room.host.send(changedPayload);
                }
                room.clients.forEach(c => {
                  if (c.readyState === WebSocket.OPEN) {
                    c.send(changedPayload);
                  }
                });
              } else if (room.host === ws || (room.host && (room.host as any).id === wsId)) {
                // Host becomes observer locally, doesn't vacate room.host reference
                room.observers.add(ws);
                ws.send(JSON.stringify({ type: "role_changed", role: "observer" }));
                
                const changedPayload = JSON.stringify({ type: "opponent_role_changed", clientId: wsId, role: "observer" });
                room.clients.forEach(c => {
                  if (c.readyState === WebSocket.OPEN) {
                    c.send(changedPayload);
                  }
                });
              }
            } else if (role === 'player') {
              // Transitioning from Observer to Player
              if (room.observers.has(ws)) {
                // Check if vacant slot available in clients
                if (hasRoomPlayerSpace(room)) {
                  room.observers.delete(ws);
                  if (!room.clients.includes(ws)) {
                    room.clients.push(ws);
                  }
                  ws.send(JSON.stringify({ 
                    type: "role_changed", 
                    role: "client", 
                    hostClientId: (room.host as any).id, 
                    clientClientId: wsId,
                    spawnSlot: getRoomSpawnSlot(room, ws),
                  }));
                  
                  // Notify Host and all clients of this observer becoming player
                  const playerJoinedPayload = JSON.stringify({
                    type: "player_joined",
                    role: "client",
                    clientId: wsId,
                    spawnSlot: getRoomSpawnSlot(room, ws),
                    playerName: normalizePlayerName((ws as any).playerName) || `Client ${wsId}`,
                    hue: normalizePlayerHue((ws as any).playerHue),
                    loadout: normalizePlayerLoadout((ws as any).playerLoadout),
                  });
                  if (room.host && room.host.readyState === WebSocket.OPEN) {
                    room.host.send(playerJoinedPayload);
                  }
                  room.clients.forEach(c => {
                    if (c !== ws && c.readyState === WebSocket.OPEN) {
                      c.send(playerJoinedPayload);
                    }
                  });
                } else {
                  // Player slots are fully occupied (secure server check)
                  ws.send(JSON.stringify({ 
                    type: "error", 
                    message: `Cannot join as player. The match is already full (${room.lobbyConfig.maxPlayers}/${room.lobbyConfig.maxPlayers}).`
                  }));
                }
              }
            }
            break;
          }


          case "sync": {
            // Forward gameplay simulation sync data directly to all other parties
            let room = socketToRoom.get(ws);
            if (!room) {
              for (const r of Array.from(rooms.values())) {
                if (r.host === ws || r.clients.includes(ws) || r.observers.has(ws) || (r.host && (r.host as any).id === wsId) || r.clients.some((c: any) => c.id === wsId)) {
                  room = r;
                  socketToRoom.set(ws, r);
                  break;
                }
              }
            }
            if (!room) return;

            const isHost = (ws === room.host || (ws as any).id === (room.host as any).id);
            const isClient = room.clients.includes(ws) || room.clients.some((c: any) => c.id === wsId);
            const senderRole = isHost ? 'host' : (isClient ? 'client' : 'observer');

            // Package coordination parameters with sender role tag and senderId
            let parsedMessage = message;
            try {
              parsedMessage = {
                ...message,
                senderRole,
                senderId: wsId
              };
            } catch (err) {}
            const syncPayload = JSON.stringify(parsedMessage);

            if (isHost) {
              // Send to all clients
              room.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(syncPayload);
                }
              });
              // Send to observers
              room.observers.forEach(obs => {
                if (obs.readyState === WebSocket.OPEN) {
                  obs.send(syncPayload);
                }
              });
            } else if (isClient) {
              // Send to host
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(syncPayload);
              }
              // Send to all other clients
              room.clients.forEach(client => {
                if (client !== ws && (client as any).id !== wsId && client.readyState === WebSocket.OPEN) {
                  client.send(syncPayload);
                }
              });
              // Send to observers
              room.observers.forEach(obs => {
                if (obs.readyState === WebSocket.OPEN) {
                  obs.send(syncPayload);
                }
              });
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error("Error processing websocket message:", err);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket connection closed.");

      // Clean up Quick Play matchmaking states
      quickPlayQueue.delete(ws);
      for (const [code, clientWs] of waitingQuickPlayClients.entries()) {
        if (clientWs === ws) {
          waitingQuickPlayClients.delete(code);
        }
      }
      
      const room = socketToRoom.get(ws);
      if (room) {
        // If it is an observer, safely clean it up and do not close the lobby match!
        if (room.observers.has(ws)) {
          room.observers.delete(ws);
          socketToRoom.delete(ws);
          const observerLeftPayload = JSON.stringify({
            type: "player_left",
            leftPlayerId: wsId,
            role: "observer",
            reason: "An observer left the match."
          });
          if (room.host && room.host.readyState === WebSocket.OPEN) {
            room.host.send(observerLeftPayload);
          }
          room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(observerLeftPayload);
            }
          });
          updatePresence();
          return;
        }

        const isHost = (ws === room.host);
        
        if (isHost) {
          // Tell all clients and observers that the host left and match dissolved
          const disconnectPayload = JSON.stringify({ type: "disconnected", reason: "Host left the match." });
          room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(disconnectPayload);
              client.close();
            }
          });
          room.observers.forEach(obs => {
            if (obs.readyState === WebSocket.OPEN) {
              obs.send(disconnectPayload);
              obs.close();
            }
          });
          
          // Remove room listings from memory
          room.keys.forEach(key => {
            rooms.delete(key);
          });
          
          // Remove socket bindings
          socketToRoom.delete(room.host);
          room.clients.forEach(client => socketToRoom.delete(client));
          room.observers.forEach(obs => socketToRoom.delete(obs));
        } else {
          // Client left
          room.clients = room.clients.filter(c => c !== ws && (c as any).id !== wsId);
          socketToRoom.delete(ws);

          // Tell host and other clients that this player left
          const playerLeftPayload = JSON.stringify({
            type: "player_left",
            leftPlayerId: wsId,
            reason: "A player left the match."
          });

          if (room.host && room.host.readyState === WebSocket.OPEN) {
            room.host.send(playerLeftPayload);
          }
          room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(playerLeftPayload);
            }
          });
          room.observers.forEach(obs => {
            if (obs.readyState === WebSocket.OPEN) {
              obs.send(playerLeftPayload);
            }
          });
        }
      }


      // Update active roster information for all surviving connections
      updatePresence();
    });

    ws.on("error", (err) => {
      console.error("WebSocket socket error:", err);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    const sendDevHtml = async (req: express.Request, res: express.Response, next: express.NextFunction, fileName: string) => {
      try {
        const template = fs.readFileSync(path.join(process.cwd(), fileName), "utf-8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        if (error instanceof Error) {
          vite.ssrFixStacktrace(error);
        }
        next(error);
      }
    };
    app.get([
      "/mapmaker.html",
      "/animation-editor.html",
      "/armor-model-editor.html",
      "/v3-performance-smoke.html",
      "/v3-readiness-dashboard.html",
    ], (req, res, next) => {
      sendDevHtml(req, res, next, req.path.slice(1));
    });
    app.get("*", (req, res, next) => {
      sendDevHtml(req, res, next, "index.html");
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
