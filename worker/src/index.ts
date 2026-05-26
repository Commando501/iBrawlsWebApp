export interface Env {
  GAME_LOBBY: DurableObjectNamespace;
}

interface Room {
  host: GameWebSocket;
  client?: GameWebSocket;
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

// 1. Entrypoint Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Common CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
      "Access-Control-Allow-Headers": "Content-Type, Upgrade",
    };

    // Handle CORS preflight options
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
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
    await this.handleSession(serverSocket);

    // Return the 101 Switching Protocols response to upgrade the client connection
    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  }

  async handleSession(ws: WebSocket) {
    const gameWs = ws as GameWebSocket;
    
    // Accept the WebSocket connection inside the Worker
    gameWs.accept();
    this.sessions.add(gameWs);

    // Generate unique random socket ID (same as original backend)
    const wsId = Math.random().toString(36).substring(2, 9);
    gameWs.id = wsId;
    gameWs.playerState = 'menu';
    gameWs.roomCode = undefined;
    gameWs.spaceAvailable = false;
    
    console.log(`New WebSocket connection received. Assigned Socket ID: ${wsId}`);

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
            if (name) gameWs.playerName = name;
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
              if (!room.client && !room.quickplayReserved) {
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
            const room: Room = { host: gameWs, keys: keysToRegister };

            // Register room under all given keys
            keysToRegister.forEach(key => {
              const existing = this.rooms.get(key);
              if (existing) {
                if (existing.host !== gameWs) {
                  try { existing.host.close(); } catch(e) {}
                }
                if (existing.client) {
                  try { existing.client.close(); } catch(e) {}
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
            const { targetIpOrId } = message;
            console.log(`Client attempting to join room matching: ${targetIpOrId}`);

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

            if (room.client && room.client !== gameWs && room.client.id !== wsId) {
              try {
                gameWs.send(JSON.stringify({ type: "error", message: `Match is already full (2/2 players present).` }));
              } catch(e) {}
              return;
            }

            // Bind client to room reference
            room.client = gameWs;
            this.socketToRoom.set(gameWs, room);

            // Notify both parties that they have paired successfully
            try {
              gameWs.send(JSON.stringify({ type: "connected", role: "client" }));
            } catch(e) {}
            try {
              room.host.send(JSON.stringify({ type: "connected", role: "host" }));
            } catch(e) {}
            break;
          }

          case "sync": {
            // Forward gameplay simulation sync data directly to the opposite party in the same Room
            let room = this.socketToRoom.get(gameWs);
            if (!room) {
              // Fallback socket-to-room lookup to heal connections
              for (const r of Array.from(this.rooms.values())) {
                if (
                  r.host === gameWs || 
                  r.client === gameWs || 
                  (r.host && r.host.id === wsId) || 
                  (r.client && r.client.id === wsId)
                ) {
                  room = r;
                  this.socketToRoom.set(gameWs, r);
                  break;
                }
              }
            }
            if (!room) return;

            const isHost = (gameWs === room.host || gameWs.id === room.host.id);
            const target = isHost ? room.client : room.host;
            if (target && target.readyState === WebSocket.OPEN) {
              try {
                target.send(rawMessage);
              } catch (e) {}
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
        // Tell the remaining peer that the connection dissolved
        const survivor = (gameWs === room.host) ? room.client : room.host;
        if (survivor && survivor.readyState === WebSocket.OPEN) {
          try {
            survivor.send(JSON.stringify({ type: "disconnected", reason: "Opponent left the match." }));
            survivor.close();
          } catch (e) {}
        }
        
        // Remove room listings from memory
        room.keys.forEach(key => {
          this.rooms.delete(key);
        });
        
        // Remove socket bindings
        if (room.host) this.socketToRoom.delete(room.host);
        if (room.client) this.socketToRoom.delete(room.client);
      }

      // Update active roster information for all surviving connections
      this.updatePresence();
    });

    gameWs.addEventListener("error", (err) => {
      console.error("WebSocket socket error:", err);
    });
  }

  // Broadcast updated presence count and clients list to everyone
  updatePresence() {
    const onlineCount = this.sessions.size;
    const clientPayloads = Array.from(this.sessions)
      .map((client) => ({
        id: client.id,
        name: client.playerName,
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
