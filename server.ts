import express from "express";
import path from "path";
import http from "http";
import os from "os";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";

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
  const PORT = 3000;

  interface Room {
    host: WebSocket;
    client?: WebSocket;
    keys: string[];
    quickplayReserved?: boolean;
  }

  // Track active matchmaking rooms by string identifier key
  const rooms = new Map<string, Room>();
  // Direct tracking lookup from socket reference to its active room
  const socketToRoom = new Map<WebSocket, Room>();

  // Quick Play matchmaking structures
  const quickPlayQueue = new Set<WebSocket>();
  const waitingQuickPlayClients = new Map<string, WebSocket>();

  // Helper to clean up dead sockets from the quickplay queue
  function cleanQuickPlayQueue() {
    for (const socket of quickPlayQueue) {
      if (socket.readyState !== WebSocket.OPEN) {
        quickPlayQueue.delete(socket);
      }
    }
  }

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

  // Broadcast updated presence count and clients list to everyone
  function updatePresence() {
    const onlineCount = wss.clients.size;
    const clientPayloads = Array.from(wss.clients)
      .map((client: any) => ({
        id: client.id,
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
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(presencePayload);
      }
    });
  }

  wss.on("connection", (ws, req) => {
    const wsId = Math.random().toString(36).substring(2, 9);
    (ws as any).id = wsId;
    (ws as any).playerState = 'menu';
    (ws as any).roomCode = undefined;
    (ws as any).spaceAvailable = false;
    console.log(`New WebSocket connection received. Assigned Socket ID: ${wsId}`);

    // Send immediate welcome greeting carrying the socket's client identity
    ws.send(JSON.stringify({ type: "welcome", clientId: wsId }));
    
    // Broadcast active roster update to everyone connected
    updatePresence();

    ws.on("message", (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());

        switch (message.type) {
          case "update_status": {
            const { status, roomCode, spaceAvailable } = message;
            console.log(`Client ${wsId} updating playerState to: ${status}, roomCode: ${roomCode}, spaceAvailable: ${spaceAvailable}`);
            (ws as any).playerState = status;
            (ws as any).roomCode = roomCode;
            (ws as any).spaceAvailable = spaceAvailable;
            updatePresence();
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
            console.log(`Direct invite from ${wsId} to ${targetId} referencing room ${roomCode}`);
            let destSocket: WebSocket | null = null;
            for (const client of wss.clients) {
              if ((client as any).id === targetId) {
                destSocket = client;
                break;
              }
            }
            if (destSocket && destSocket.readyState === WebSocket.OPEN) {
              destSocket.send(JSON.stringify({
                type: "receive_invite",
                fromId: wsId,
                roomCode
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
            
            // 1. Search for any hosted match waiting for a player (not full, not reserved)
            let foundRoomKey: string | null = null;
            for (const [key, room] of rooms.entries()) {
              if (!room.client && !room.quickplayReserved) {
                foundRoomKey = key;
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
            const keysToRegister = [];
            if (ip) keysToRegister.push(ip);
            if (lanIp && lanIp !== '127.0.0.1') keysToRegister.push(lanIp);
            if (customId) keysToRegister.push(customId);

            console.log(`Registering host with keys: ${keysToRegister.join(", ")}`);

            // Create a single Room instance shared by reference across all registration keys
            const room: Room = { host: ws, keys: keysToRegister };

            // Register room under all given keys
            keysToRegister.forEach(key => {
              // Clean up existing room under this key if any
              const existing = rooms.get(key);
              if (existing) {
                if (existing.host !== ws) {
                  existing.host.close();
                }
                if (existing.client) {
                  existing.client.close();
                }
              }

              rooms.set(key, room);
            });

            socketToRoom.set(ws, room);
            ws.send(JSON.stringify({ type: "hosted", keys: keysToRegister }));

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
            const { targetIpOrId } = message;
            console.log(`Client attempting to join room matching: ${targetIpOrId}`);

            let room = rooms.get(targetIpOrId);
            
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

            if (room.client && room.client !== ws && (room.client as any).id !== wsId) {
              ws.send(JSON.stringify({ type: "error", message: `Match is already full (2/2 players present).` }));
              return;
            }

            // Bind client to room reference
            room.client = ws;
            socketToRoom.set(ws, room);

            // Notify both parties that they have paired successfully
            ws.send(JSON.stringify({ type: "connected", role: "client" }));
            room.host.send(JSON.stringify({ type: "connected", role: "host" }));
            break;
          }

          case "sync": {
            // Forward gameplay simulation sync data directly to the opposite party in the same Room
            let room = socketToRoom.get(ws);
            if (!room) {
              // Fallback socket-to-room lookup to heal connections
              for (const r of Array.from(rooms.values())) {
                if (r.host === ws || r.client === ws || (r.host && (r.host as any).id === wsId) || (r.client && (r.client as any).id === wsId)) {
                  room = r;
                  socketToRoom.set(ws, r);
                  break;
                }
              }
            }
            if (!room) return;

            const isHost = (ws === room.host || (ws as any).id === (room.host as any).id);
            const target = isHost ? room.client : room.host;
            if (target && target.readyState === WebSocket.OPEN) {
              target.send(rawMessage.toString());
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
        // Tell the remaining peer that the connection dissolved
        const survivor = (ws === room.host) ? room.client : room.host;
        if (survivor && survivor.readyState === WebSocket.OPEN) {
          survivor.send(JSON.stringify({ type: "disconnected", reason: "Opponent left the match." }));
          survivor.close();
        }
        
        // Remove room listings from memory
        room.keys.forEach(key => {
          rooms.delete(key);
        });
        
        // Remove socket bindings
        if (room.host) socketToRoom.delete(room.host);
        if (room.client) socketToRoom.delete(room.client);
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
      appType: "spa",
    });
    app.use(vite.middlewares);
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
