import { LIVE_CONFIG_KEY_SET } from "./liveConfigKeys";
import { handleAccountRequest } from "./accounts";
import { toAnalyticsDataPoint } from "./telemetrySchema";

export interface Env {
  GAME_LOBBY: DurableObjectNamespace;
  DB: D1Database;
  ADMIN_TOKEN?: string;
  // Optional so deployments without the binding (or older configs) don't break.
  TELEMETRY?: AnalyticsEngineDataset;
}

const CONFIG_ID = "multiplayer_preset";

// ── Telemetry helpers ────────────────────────────────────────────────────────

function telemetryNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function telemetryStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

// Validate + normalize an incoming telemetry payload. Returns null when the body
// is malformed (missing anon id or fingerprint), which the caller rejects 400.
// Also caps string lengths and coerces numbers to bound abuse of the open POST.
function sanitizeTelemetry(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (typeof o.anonId !== "string" || o.anonId.length === 0) return null;
  if (!o.player || typeof o.player !== "object") return null;
  const p = o.player as Record<string, unknown>;
  return {
    anonId: telemetryStr(o.anonId, 64),
    ts: telemetryNum(o.ts),
    appVersion: telemetryStr(o.appVersion, 32),
    liveConfigVersion: telemetryNum(o.liveConfigVersion),
    fingerprintSchema: telemetryNum(o.fingerprintSchema),
    map: telemetryStr(o.map, 32),
    mode: telemetryStr(o.mode, 32),
    aiDifficulty: telemetryStr(o.aiDifficulty, 32),
    aiArchetype: telemetryStr(o.aiArchetype, 32),
    gameMode: telemetryStr(o.gameMode, 32),
    scorePlayer: telemetryNum(o.scorePlayer),
    scoreEnemy: telemetryNum(o.scoreEnemy),
    playerKills: telemetryNum(o.playerKills),
    playerDeaths: telemetryNum(o.playerDeaths),
    durationSeconds: telemetryNum(o.durationSeconds),
    // Match context
    isMultiplayer: telemetryNum(o.isMultiplayer),
    opponentCount: telemetryNum(o.opponentCount),
    multikills: telemetryNum(o.multikills),
    sprees: telemetryNum(o.sprees),
    // Raw per-match action volumes
    lungeAttempts: telemetryNum(o.lungeAttempts),
    lungeHits: telemetryNum(o.lungeHits),
    hammerAttacks: telemetryNum(o.hammerAttacks),
    weaponSwaps: telemetryNum(o.weaponSwaps),
    dashes: telemetryNum(o.dashes),
    countersAttempted: telemetryNum(o.countersAttempted),
    countersLanded: telemetryNum(o.countersLanded),
    damageDealtCount: telemetryNum(o.damageDealtCount),
    damageReceivedCount: telemetryNum(o.damageReceivedCount),
    player: {
      avgLungeDistance: telemetryNum(p.avgLungeDistance),
      lungeFrequency: telemetryNum(p.lungeFrequency),
      dodgeBiasX: telemetryNum(p.dodgeBiasX),
      dodgeBiasZ: telemetryNum(p.dodgeBiasZ),
      counterRate: telemetryNum(p.counterRate),
      approachSpeed: telemetryNum(p.approachSpeed),
      edgeProximity: telemetryNum(p.edgeProximity),
      reactionTime: telemetryNum(p.reactionTime),
      sampleCount: telemetryNum(p.sampleCount),
    },
  };
}

function getLobbyStub(env: Env): DurableObjectStub {
  const id = env.GAME_LOBBY.idFromName("global-lobby");
  return env.GAME_LOBBY.get(id);
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// Re-emit a DO response body with CORS + JSON headers attached.
async function withCorsJson(r: Response, cors: Record<string, string>): Promise<Response> {
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

interface GameConfigRow {
  version: number;
  label: string | null;
  payload: string;
}

// Constant-time-ish string compare to avoid leaking token length/contents via timing.
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Drop unknown / identity keys; keep only governed mechanic keys.
function sanitizeConfigSettings(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (LIVE_CONFIG_KEY_SET.has(key)) out[key] = value;
  }
  return out;
}

interface Room {
  host: GameWebSocket;
  clients: GameWebSocket[]; // Array of up to 7 guest clients (8 players total)
  observers: Set<GameWebSocket>;
  keys: string[];
  quickplayReserved?: boolean;
}

interface GameWebSocket extends WebSocket {
  id?: string;
  playerState?: 'menu' | 'solo' | 'multi';
  roomCode?: string;
  spaceAvailable?: boolean;
  playerName?: string;
}

const MAX_PLAYER_NAME_LENGTH = 10;

function normalizePlayerName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const normalized = name.trim().substring(0, MAX_PLAYER_NAME_LENGTH);
  return normalized.length > 0 ? normalized : undefined;
}

// 1. Entrypoint Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Common CORS Headers. Authorization + If-None-Match are needed for the
    // cross-origin config API (publish auth + ETag revalidation); ETag must be
    // exposed so the browser lets the client read it for caching.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST, PUT",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match, Upgrade",
      "Access-Control-Expose-Headers": "ETag",
    };

    // Handle CORS preflight options
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // ── Accounts (D1-backed): registration, login, recovery, profile, cloud save ──
    const accountResponse = await handleAccountRequest(request, env, corsHeaders);
    if (accountResponse) return accountResponse;

    // ── Live Tuning / Official Multiplayer Preset (D1-backed) ──────────────────

    // GET /api/config — public read of the authoritative gameplay preset.
    if (url.pathname === "/api/config" && request.method === "GET") {
      try {
        const row = await env.DB.prepare(
          "SELECT version, label, payload FROM game_config WHERE id = ?"
        )
          .bind(CONFIG_ID)
          .first<GameConfigRow>();

        if (!row) {
          return new Response(JSON.stringify({ error: "Config not initialized" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        const etag = `"v${row.version}"`;
        // ETag short-circuit: client already has this version.
        if (request.headers.get("If-None-Match") === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, "Cache-Control": "no-cache", ...corsHeaders },
          });
        }

        const body = JSON.stringify({
          version: row.version,
          label: row.label ?? "",
          settings: JSON.parse(row.payload),
        });
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: etag,
            "Cache-Control": "no-cache",
            ...corsHeaders,
          },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to read config", detail: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/admin/config — publish a new official preset. Requires admin token.
    if (url.pathname === "/api/admin/config" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!env.ADMIN_TOKEN || !token || !tokensMatch(token, env.ADMIN_TOKEN)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      let parsed: { settings?: unknown; label?: unknown };
      try {
        parsed = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const settings = sanitizeConfigSettings(parsed.settings);
      if (Object.keys(settings).length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid gameplay settings provided" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      const label = typeof parsed.label === "string" ? parsed.label.slice(0, 60) : "";

      try {
        const current = await env.DB.prepare(
          "SELECT version FROM game_config WHERE id = ?"
        )
          .bind(CONFIG_ID)
          .first<{ version: number }>();
        const nextVersion = (current?.version ?? 0) + 1;
        const now = Date.now();
        const payload = JSON.stringify(settings);

        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO game_config (id, version, label, payload, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, 'admin')
             ON CONFLICT(id) DO UPDATE SET
               version = excluded.version,
               label = excluded.label,
               payload = excluded.payload,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`
          ).bind(CONFIG_ID, nextVersion, label, payload, now),
          env.DB.prepare(
            `INSERT INTO config_history (config_id, version, label, payload, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, 'admin')`
          ).bind(CONFIG_ID, nextVersion, label, payload, now),
        ]);

        // Poke the lobby DO so connected clients get a "config_changed" nudge.
        try {
          const doId = env.GAME_LOBBY.idFromName("global-lobby");
          const stub = env.GAME_LOBBY.get(doId);
          ctx.waitUntil(
            stub.fetch(`https://do/internal/config-bump?version=${nextVersion}`)
          );
        } catch (e) {
          // Broadcast is best-effort; clients also re-fetch on lobby entry.
        }

        return new Response(JSON.stringify({ ok: true, version: nextVersion }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to publish config", detail: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // ── Match telemetry (anonymous gameplay data → Analytics Engine) ──────────
    // Adaptive admission lives in the lobby DO; the entrypoint validates and
    // forwards. Both endpoints are public (no admin token) but the open POST is
    // size-/shape-validated and rate-governed by the DO.

    // GET /api/telemetry/policy — current admission probability for client self-sampling.
    if (url.pathname === "/api/telemetry/policy" && request.method === "GET") {
      const stub = getLobbyStub(env);
      const r = await stub.fetch("https://do/internal/telemetry-policy");
      return withCorsJson(r, corsHeaders);
    }

    // POST /api/telemetry/match — submit one match's anonymous fingerprint + outcome.
    if (url.pathname === "/api/telemetry/match" && request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
      }
      const clean = sanitizeTelemetry(body);
      if (!clean) {
        return jsonResponse({ error: "Invalid telemetry payload" }, 400, corsHeaders);
      }
      const stub = getLobbyStub(env);
      const r = await stub.fetch("https://do/internal/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
      });
      return withCorsJson(r, corsHeaders);
    }

    // Route matchmaking, WebSocket, and IP requests to the same global Durable Object instance
    // to maintain a centralized state (lobby, chat, matchmaking, etc.)
    if (
      url.pathname === "/ws" ||
      url.pathname === "/" || 
      url.pathname === "/api/my-ip"
    ) {
      const doId = env.GAME_LOBBY.idFromName("global-lobby");
      const stub = env.GAME_LOBBY.get(doId);
      
      // Forward the request to the Durable Object
      const response = await stub.fetch(request);
      
      // For WebSocket upgrades, we MUST return the DO response object directly 
      // to preserve the native upgraded `webSocket` property!
      if (request.headers.get("Upgrade") === "websocket") {
        return response;
      }

      // Inject CORS headers into standard HTTP responses
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }

    return new Response("Not Found", { 
      status: 404, 
      headers: corsHeaders 
    });
  }
};

// 2. Durable Object Coordinator
export class GameLobby implements DurableObject {
  state: DurableObjectState;
  env: Env;
  
  // In-memory data structures preserved as long as clients are connected
  rooms = new Map<string, Room>();
  socketToRoom = new Map<GameWebSocket, Room>();
  sessions = new Set<GameWebSocket>();

  // Quick Play matchmaking structures
  quickPlayQueue = new Set<GameWebSocket>();
  waitingQuickPlayClients = new Map<string, GameWebSocket>();

  // ── Telemetry admission governor ───────────────────────────────────────────
  // Sliding window of recent submissions (ephemeral; resets on DO eviction, which
  // just means a brief window of full admission — acceptable). Below the active-
  // sender threshold every match is admitted; above it, admission scales as
  // threshold / activeSenders so the effective volume stays ~threshold.
  telemetryWindow: { t: number; anonId: string }[] = [];
  readonly TELEMETRY_WINDOW_MS = 5 * 60_000;
  readonly TELEMETRY_ACTIVE_THRESHOLD = 50;
  readonly TELEMETRY_MIN_PROBABILITY = 0.02;

  computeAdmissionProbability(now: number): number {
    const cutoff = now - this.TELEMETRY_WINDOW_MS;
    this.telemetryWindow = this.telemetryWindow.filter((e) => e.t >= cutoff);
    const distinct = new Set(this.telemetryWindow.map((e) => e.anonId)).size;
    if (distinct <= this.TELEMETRY_ACTIVE_THRESHOLD) return 1;
    return Math.max(this.TELEMETRY_MIN_PROBABILITY, this.TELEMETRY_ACTIVE_THRESHOLD / distinct);
  }

  writeTelemetryDataPoint(body: Record<string, unknown>): void {
    if (!this.env.TELEMETRY) return;
    try {
      // Positional layout comes from the canonical schema (single source of truth
      // shared with the offline analysis); see worker/src/telemetrySchema.ts.
      this.env.TELEMETRY.writeDataPoint(toAnalyticsDataPoint(body));
    } catch {
      /* AE write is best-effort; never fail the request on telemetry */
    }
  }

  // Helper to clean up dead sockets from the quickplay queue
  cleanQuickPlayQueue() {
    for (const socket of this.quickPlayQueue) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.quickPlayQueue.delete(socket);
      }
    }
  }

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal poke from the entrypoint after an admin publishes a new config.
    // Broadcast a lightweight version ping; clients re-fetch GET /api/config.
    if (url.pathname === "/internal/config-bump") {
      const version = Number(url.searchParams.get("version")) || 0;
      this.broadcastConfigChanged(version);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Current admission probability (no side effects) for client self-sampling.
    if (url.pathname === "/internal/telemetry-policy") {
      return new Response(
        JSON.stringify({ admissionProbability: this.computeAdmissionProbability(Date.now()) }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Record a telemetry submission, decide admission, and (if admitted) write it
    // to Analytics Engine. Returns the decision + the probability the client should
    // adopt for its own self-sampling next time.
    if (url.pathname === "/internal/telemetry" && request.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        /* treat as empty; still report current probability */
      }
      const now = Date.now();
      if (typeof body.anonId === "string" && body.anonId.length > 0) {
        this.telemetryWindow.push({ t: now, anonId: body.anonId });
      }
      const admissionProbability = this.computeAdmissionProbability(now);
      const admitted = Math.random() < admissionProbability;
      if (admitted) this.writeTelemetryDataPoint(body);
      return new Response(
        JSON.stringify({ ok: true, admitted, admissionProbability }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Express "/api/my-ip" replacement
    if (url.pathname === "/api/my-ip") {
      // Cloudflare automatically injects the client's public IP in the CF-Connecting-IP header
      const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
      return new Response(
        JSON.stringify({ 
          ip: clientIp,
          lanIp: "127.0.0.1" // Worker environment runs in serverless, so internal LAN IP of host doesn't apply
        }), 
        {
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Handle WebSocket upgrade request
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    // Create a new WebSocket client/server pair using robust native properties
    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];

    // Connect the socket server end to the Durable Object
    const connectionType = url.searchParams.get("type") || "lobby";
    const nameParam = url.searchParams.get("name");
    await this.handleSession(serverSocket, connectionType, nameParam);

    // Return the 101 Switching Protocols response to upgrade the client connection
    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  }

  async handleSession(ws: WebSocket, connectionType: string, nameParam: string | null) {
    const gameWs = ws as GameWebSocket;
    
    // Accept the WebSocket connection inside the Worker
    gameWs.accept();
    this.sessions.add(gameWs);

    // Generate unique random socket ID (same as original backend)
    const wsId = Math.random().toString(36).substring(2, 9);
    gameWs.id = wsId;
    (gameWs as any).connectionType = connectionType;
    gameWs.playerState = 'menu';
    gameWs.roomCode = undefined;
    gameWs.spaceAvailable = false;
    gameWs.playerName = normalizePlayerName(nameParam);
    
    console.log(`New WebSocket connection received. Assigned Socket ID: ${wsId}, Type: ${connectionType}, Name: ${nameParam}`);

    // Send immediate welcome greeting carrying the socket's client identity
    gameWs.send(JSON.stringify({ type: "welcome", clientId: wsId }));
    
    // Broadcast active roster update to everyone connected
    this.updatePresence();

    gameWs.addEventListener("message", (event) => {
      try {
        const rawMessage = event.data as string;
        const message = JSON.parse(rawMessage);

        switch (message.type) {
          case "update_status": {
            const { status, roomCode, spaceAvailable, name } = message;
            console.log(`Client ${wsId} updating playerState to: ${status}, roomCode: ${roomCode}, spaceAvailable: ${spaceAvailable}`);
            gameWs.playerState = status;
            gameWs.roomCode = roomCode;
            gameWs.spaceAvailable = spaceAvailable;
            gameWs.playerName = normalizePlayerName(name);
            this.updatePresence();
            break;
          }

          case "lobby_chat": {
            const { text, sender } = message;
            console.log(`Lobby chat message from ${wsId} (${sender}): ${text}`);
            const chatPayload = JSON.stringify({
              type: "lobby_chat",
              id: Math.random().toString(36).substring(2, 9),
              sender: sender || `Client ${wsId}`,
              text,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              clientId: wsId
            });
            this.sessions.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(chatPayload);
                } catch(e) {}
              }
            });
            break;
          }

          case "ping": {
            const { timestamp } = message;
            try {
              gameWs.send(JSON.stringify({ type: "pong", timestamp }));
            } catch(e) {}
            break;
          }

          case "send_invite": {
            const { targetId, roomCode } = message;
            console.log(`Direct invite from ${wsId} to ${targetId} referencing room ${roomCode}`);
            let destSocket: GameWebSocket | null = null;
            for (const client of this.sessions) {
              if (client.id === targetId) {
                destSocket = client;
                break;
              }
            }
            if (destSocket && destSocket.readyState === WebSocket.OPEN) {
              try {
                destSocket.send(JSON.stringify({
                  type: "receive_invite",
                  fromId: wsId,
                  roomCode
                }));
              } catch(e) {}
            }
            break;
          }

          case "decline_invite": {
            const { targetId } = message;
            console.log(`Direct invite declined from ${wsId} targeting original host ${targetId}`);
            let destSocket: GameWebSocket | null = null;
            for (const client of this.sessions) {
              if (client.id === targetId) {
                destSocket = client;
                break;
              }
            }
            if (destSocket && destSocket.readyState === WebSocket.OPEN) {
              try {
                destSocket.send(JSON.stringify({
                  type: "invite_declined",
                  fromId: wsId
                }));
              } catch(e) {}
            }
            break;
          }

          case "quickplay_join": {
            console.log(`Client ${wsId} requested Quick Play matchmaking.`);
            
            // 1. Search for any hosted match waiting for a player (not full, not reserved)
            let foundRoomKey: string | null = null;
            for (const [key, room] of this.rooms.entries()) {
              if (room.clients.length === 0 && !room.quickplayReserved) {
                foundRoomKey = key;
                room.quickplayReserved = true; // Mark it as reserved
                break;
              }
            }

            if (foundRoomKey) {
              console.log(`Quick Play Matchmaker found open hosted lobby for client ${wsId} under key: ${foundRoomKey}`);
              try {
                gameWs.send(JSON.stringify({ type: "quickplay_match_found", roomCode: foundRoomKey }));
              } catch(e) {}
              break;
            }

            // 2. Clean dead sockets in queue and check if anyone else is waiting
            this.cleanQuickPlayQueue();

            if (this.quickPlayQueue.size > 0) {
              const peerWs = this.quickPlayQueue.values().next().value;
              if (peerWs) {
                this.quickPlayQueue.delete(peerWs);

                if (peerWs.readyState === WebSocket.OPEN) {
                  const qpRoomCode = "QP_" + Math.floor(100000 + Math.random() * 900000).toString();
                  console.log(`Quick Play Matchmaker pairing client ${wsId} with peer ${peerWs.id}. Generated Room Code: ${qpRoomCode}`);

                  // Send matching coordinates
                  try {
                    peerWs.send(JSON.stringify({ type: "quickplay_host", roomCode: qpRoomCode }));
                  } catch(e) {}
                  this.waitingQuickPlayClients.set(qpRoomCode, gameWs);
                  
                  // Let the joining player know we are configuring the arena
                  try {
                    gameWs.send(JSON.stringify({ type: "quickplay_queued" }));
                  } catch(e) {}
                  break;
                }
              }
            }

            // 3. No matches or peers available, enter queue
            this.quickPlayQueue.add(gameWs);
            console.log(`Client ${wsId} entered the Quick Play queue.`);
            try {
              gameWs.send(JSON.stringify({ type: "quickplay_queued" }));
            } catch(e) {}
            break;
          }

          case "quickplay_leave": {
            this.quickPlayQueue.delete(gameWs);
            for (const [code, clientWs] of this.waitingQuickPlayClients.entries()) {
              if (clientWs === gameWs) {
                this.waitingQuickPlayClients.delete(code);
              }
            }
            console.log(`Client ${wsId} left Quick Play queue.`);
            break;
          }

          case "host": {
            const { ip, lanIp, customId } = message;
            const keysToRegister = [];
            if (ip) keysToRegister.push(ip);
            if (lanIp && lanIp !== '127.0.0.1') keysToRegister.push(lanIp);
            if (customId) keysToRegister.push(customId);

            console.log(`Registering host with keys: ${keysToRegister.join(", ")}`);

            // Create a Room instance shared across registration keys
            const room: Room = { host: gameWs, clients: [], observers: new Set<GameWebSocket>(), keys: keysToRegister };

            // Register room under all given keys
            keysToRegister.forEach(key => {
              const existing = this.rooms.get(key);
              if (existing) {
                if (existing.host !== gameWs) {
                  try { existing.host.close(); } catch(e) {}
                }
                if (existing.clients) {
                  existing.clients.forEach(c => {
                    try { c.close(); } catch(e) {}
                  });
                }
              }
              this.rooms.set(key, room);
            });

            this.socketToRoom.set(gameWs, room);
            try {
              gameWs.send(JSON.stringify({ type: "hosted", keys: keysToRegister }));
            } catch(e) {}

            // Trigger the waiting Quick Play client if this is a custom quickplay room code
            if (customId && this.waitingQuickPlayClients.has(customId)) {
              const guestWs = this.waitingQuickPlayClients.get(customId);
              this.waitingQuickPlayClients.delete(customId);
              if (guestWs && guestWs.readyState === WebSocket.OPEN) {
                console.log(`Quick Play Host registered. Dispatching match found to guest client ${guestWs.id}`);
                try {
                  guestWs.send(JSON.stringify({ type: "quickplay_match_found", roomCode: customId }));
                } catch(e) {}
              }
            }
            break;
          }

          case "join": {
            const { targetIpOrId, isObserver } = message;
            console.log(`Client attempting to join room matching: ${targetIpOrId} (isObserver: ${isObserver})`);

            let room = this.rooms.get(targetIpOrId);
            
            // Local network fallback (same as original server.ts)
            if (!room && this.rooms.size > 0) {
              const singleKey = Array.from(this.rooms.keys())[0];
              room = this.rooms.get(singleKey);
              console.log(`Fallback: Lobby lookup under "${targetIpOrId}" not found. Auto-paired with active lobby (key: ${singleKey})`);
            }

            if (!room) {
              try {
                gameWs.send(JSON.stringify({ type: "error", message: `Match not found for: ${targetIpOrId}` }));
              } catch(e) {}
              return;
            }

            if (isObserver) {
              room.observers.add(gameWs);
              this.socketToRoom.set(gameWs, room);
              console.log(`Client ${wsId} connected as observer to room.`);
              try {
                gameWs.send(JSON.stringify({ 
                  type: "connected", 
                  role: "observer", 
                  hostClientId: room.host.id, 
                  clientClientId: room.clients.length > 0 ? room.clients[0].id : undefined,
                  otherPlayerIds: [
                    room.host.id,
                    ...room.clients.map(c => c.id)
                  ]
                }));
              } catch (e) {}
              
              // Notify host and clients
              const obsJoinedPayload = JSON.stringify({ type: "observer_joined", observerId: wsId });
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try { room.host.send(obsJoinedPayload); } catch (e) {}
              }
              room.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) {
                  try { c.send(obsJoinedPayload); } catch (e) {}
                }
              });
              break;
            }

            if (room.clients.length >= 7) { // 8 players total (1 host + 7 clients)
              try {
                gameWs.send(JSON.stringify({ type: "error", message: `Match is already full (8/8 players present).` }));
              } catch(e) {}
              return;
            }

            if (!room.clients.includes(gameWs) && !room.clients.some((c: any) => c.id === wsId)) {
              room.clients.push(gameWs);
            }
            this.socketToRoom.set(gameWs, room);

            // Notify both parties that they have paired successfully
            try {
              gameWs.send(JSON.stringify({ 
                type: "connected", 
                role: "client", 
                hostClientId: room.host.id, 
                clientClientId: wsId,
                otherPlayerIds: [
                  room.host.id,
                  ...room.clients.filter(c => c.id !== wsId).map(c => c.id)
                ]
              }));
            } catch (e) {}

            // Notify host and all other clients of this new player joining
            const clientJoinedPayload = JSON.stringify({
              type: "player_joined",
              role: "client",
              clientId: wsId,
              playerName: normalizePlayerName(gameWs.playerName) || `Client ${wsId}`
            });

            if (room.clients.length === 1) {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try {
                  room.host.send(JSON.stringify({
                    type: "connected",
                    role: "host",
                    clientClientId: wsId,
                    otherPlayerIds: [
                      wsId
                    ]
                  }));
                } catch (e) {}
              }
            } else {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try { room.host.send(clientJoinedPayload); } catch (e) {}
              }
            }

            room.clients.forEach(client => {
              if (client !== gameWs && client.readyState === WebSocket.OPEN) {
                try { client.send(clientJoinedPayload); } catch (e) {}
              }
            });
            break;
          }

          case "sync": {
            // Forward gameplay simulation sync data directly to all other parties in the same Room
            let room = this.socketToRoom.get(gameWs);
            if (!room) {
              for (const r of Array.from(this.rooms.values())) {
                if (
                  r.host === gameWs || 
                  r.clients.includes(gameWs) || 
                  r.observers.has(gameWs) || 
                  (r.host && r.host.id === wsId) || 
                  r.clients.some((c: any) => c.id === wsId)
                ) {
                  room = r;
                  this.socketToRoom.set(gameWs, r);
                  break;
                }
              }
            }
            if (!room) return;

            const isHost = (gameWs === room.host || gameWs.id === room.host.id);
            const isClient = room.clients.includes(gameWs) || room.clients.some((c: any) => c.id === wsId);
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
                  try { client.send(syncPayload); } catch (e) {}
                }
              });
              // Send to observers
              room.observers.forEach(obs => {
                if (obs.readyState === WebSocket.OPEN) {
                  try { obs.send(syncPayload); } catch (e) {}
                }
              });
            } else if (isClient) {
              // Send to host
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try { room.host.send(syncPayload); } catch (e) {}
              }
              // Send to all other clients
              room.clients.forEach(client => {
                if (client !== gameWs && client.id !== wsId && client.readyState === WebSocket.OPEN) {
                  try { client.send(syncPayload); } catch (e) {}
                }
              });
              // Send to observers
              room.observers.forEach(obs => {
                if (obs.readyState === WebSocket.OPEN) {
                  try { obs.send(syncPayload); } catch (e) {}
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

    gameWs.addEventListener("close", () => {
      console.log("WebSocket connection closed.");
      this.sessions.delete(gameWs);

      // Clean up Quick Play matchmaking states
      this.quickPlayQueue.delete(gameWs);
      for (const [code, clientWs] of this.waitingQuickPlayClients.entries()) {
        if (clientWs === gameWs) {
          this.waitingQuickPlayClients.delete(code);
        }
      }
      
      const room = this.socketToRoom.get(gameWs);
      if (room) {
        // If it is an observer, safely clean it up
        if (room.observers.has(gameWs)) {
          room.observers.delete(gameWs);
          this.socketToRoom.delete(gameWs);
          this.updatePresence();
          return;
        }

        const isHost = (gameWs === room.host);
        
        if (isHost) {
          // Tell all clients and observers that the host left and match dissolved
          const disconnectPayload = JSON.stringify({ type: "disconnected", reason: "Host left the match." });
          room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(disconnectPayload);
                client.close();
              } catch (e) {}
            }
          });
          room.observers.forEach(obs => {
            if (obs.readyState === WebSocket.OPEN) {
              try {
                obs.send(disconnectPayload);
                obs.close();
              } catch (e) {}
            }
          });
          
          // Remove room listings from memory
          room.keys.forEach(key => {
            this.rooms.delete(key);
          });
          
          // Remove socket bindings
          this.socketToRoom.delete(room.host);
          room.clients.forEach(client => this.socketToRoom.delete(client));
          room.observers.forEach(obs => this.socketToRoom.delete(obs));
        } else {
          // Client left
          room.clients = room.clients.filter(c => c !== gameWs && c.id !== wsId);
          this.socketToRoom.delete(gameWs);

          // Tell host and other clients that this player left
          const playerLeftPayload = JSON.stringify({
            type: "player_left",
            leftPlayerId: wsId,
            reason: "A player left the match."
          });

          if (room.host && room.host.readyState === WebSocket.OPEN) {
            try { room.host.send(playerLeftPayload); } catch (e) {}
          }
          room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              try { client.send(playerLeftPayload); } catch (e) {}
            }
          });
          room.observers.forEach(obs => {
            if (obs.readyState === WebSocket.OPEN) {
              try { obs.send(playerLeftPayload); } catch (e) {}
            }
          });
        }
      }

      // Update active roster information for all surviving connections
      this.updatePresence();
    });

    gameWs.addEventListener("error", (err) => {
      console.error("WebSocket socket error:", err);
    });
  }

  // Broadcast a "config_changed" version nudge to every connected session.
  broadcastConfigChanged(version: number) {
    const payload = JSON.stringify({ type: "config_changed", version });
    this.sessions.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          console.error("Error broadcasting config_changed", err);
        }
      }
    });
  }

  // Broadcast updated presence count and clients list to everyone
  updatePresence() {
    const lobbyClients = Array.from(this.sessions)
      .filter((client: any) => client.connectionType === 'lobby');
    const onlineCount = lobbyClients.length;
    const clientPayloads = lobbyClients
      .map((client) => ({
        id: client.id,
        name: normalizePlayerName(client.playerName),
        state: client.playerState || 'menu',
        roomCode: client.roomCode,
        spaceAvailable: client.spaceAvailable !== undefined ? client.spaceAvailable : false
      }))
      .filter(c => Boolean(c.id));

    const presencePayload = JSON.stringify({
      type: "presence",
      onlineCount,
      clients: clientPayloads
    });

    this.sessions.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(presencePayload);
        } catch (err) {
          console.error("Error broadcasting presence", err);
        }
      }
    });
  }
}
