export interface Env {
  GAME_LOBBY: DurableObjectNamespace;
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
