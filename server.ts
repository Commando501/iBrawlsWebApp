import express from "express";
import path from "path";
import http from "http";
import os from "os";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";

const MAX_PLAYER_NAME_LENGTH = 10;

function normalizePlayerName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const normalized = name.trim().substring(0, MAX_PLAYER_NAME_LENGTH);
  return normalized.length > 0 ? normalized : undefined;
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
  const PORT = 3000;

  interface Room {
    host: WebSocket;
    clients: WebSocket[]; // Array of up to 7 guest clients (8 players total)
    observers: Set<WebSocket>;
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
    const lobbyClients = Array.from(wss.clients)
      .filter((client: any) => client.connectionType === 'lobby');
    const onlineCount = lobbyClients.length;
    const clientPayloads = lobbyClients
      .map((client: any) => ({
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

    (ws as any).connectionType = connectionType;
    (ws as any).playerState = 'menu';
    (ws as any).roomCode = undefined;
    (ws as any).spaceAvailable = false;
    (ws as any).playerName = normalizePlayerName(nameParam);
    
    console.log(`New WebSocket connection received. Assigned Socket ID: ${wsId}, Type: ${connectionType}, Name: ${nameParam}`);

    // Send immediate welcome greeting carrying the socket's client identity
    ws.send(JSON.stringify({ type: "welcome", clientId: wsId }));
    
    // Broadcast active roster update to everyone connected
    updatePresence();

    ws.on("message", (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());

        switch (message.type) {
          case "update_status": {
            const { status, roomCode, spaceAvailable, name } = message;
            console.log(`Client ${wsId} updating playerState to: ${status}, roomCode: ${roomCode}, spaceAvailable: ${spaceAvailable}, name: ${name}`);
            (ws as any).playerState = status;
            (ws as any).roomCode = roomCode;
            (ws as any).spaceAvailable = spaceAvailable;
            (ws as any).playerName = normalizePlayerName(name);
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
              if (room.clients.length === 0 && !room.quickplayReserved) {
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
            const room: Room = { host: ws, clients: [], observers: new Set<WebSocket>(), keys: keysToRegister };

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
            const { targetIpOrId, isObserver } = message;
            console.log(`Client attempting to join room matching: ${targetIpOrId} (isObserver: ${isObserver})`);

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

            if (isObserver) {
              room.observers.add(ws);
              socketToRoom.set(ws, room);
              console.log(`Client ${wsId} connected as observer to room.`);
              ws.send(JSON.stringify({ 
                type: "connected", 
                role: "observer", 
                hostClientId: (room.host as any).id, 
                clientClientId: room.clients.length > 0 ? (room.clients[0] as any).id : undefined,
                otherPlayerIds: [
                  (room.host as any).id,
                  ...room.clients.map(c => (c as any).id)
                ]
              }));
              
              // Notify host and clients
              const obsJoinedPayload = JSON.stringify({ type: "observer_joined", observerId: wsId });
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

            if (room.clients.length >= 7) { // 8 players total (1 host + 7 clients)
              ws.send(JSON.stringify({ type: "error", message: `Match is already full (8/8 players present).` }));
              return;
            }

            if (!room.clients.includes(ws) && !room.clients.some((c: any) => c.id === wsId)) {
              room.clients.push(ws);
            }
            socketToRoom.set(ws, room);

            // Notify both parties that they have paired successfully
            ws.send(JSON.stringify({ 
              type: "connected", 
              role: "client", 
              hostClientId: (room.host as any).id, 
              clientClientId: wsId,
              otherPlayerIds: [
                (room.host as any).id,
                ...room.clients.filter(c => (c as any).id !== wsId).map(c => (c as any).id)
              ]
            }));

            // Notify host and all other clients of this new player joining
            const clientJoinedPayload = JSON.stringify({
              type: "player_joined",
              role: "client",
              clientId: wsId,
              playerName: normalizePlayerName((ws as any).playerName) || `Client ${wsId}`
            });

            if (room.clients.length === 1) {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                room.host.send(JSON.stringify({
                  type: "connected",
                  role: "host",
                  clientClientId: wsId,
                  otherPlayerIds: [
                    wsId
                  ]
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
                if (room.clients.length < 7) {
                  room.observers.delete(ws);
                  if (!room.clients.includes(ws)) {
                    room.clients.push(ws);
                  }
                  ws.send(JSON.stringify({ 
                    type: "role_changed", 
                    role: "client", 
                    hostClientId: (room.host as any).id, 
                    clientClientId: wsId 
                  }));
                  
                  // Notify Host and all clients of this observer becoming player
                  const playerJoinedPayload = JSON.stringify({
                    type: "player_joined",
                    role: "client",
                    clientId: wsId,
                    playerName: normalizePlayerName((ws as any).playerName) || `Client ${wsId}`
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
                    message: "Cannot join as player. Both player slots are occupied." 
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
