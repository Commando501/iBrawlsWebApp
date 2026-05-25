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
  }

  // Track active matchmaking rooms by string identifier key
  const rooms = new Map<string, Room>();
  // Direct tracking lookup from socket reference to its active room
  const socketToRoom = new Map<WebSocket, Room>();

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

  wss.on("connection", (ws, req) => {
    console.log("New WebSocket connection received.");

    ws.on("message", (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());

        switch (message.type) {
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

            if (room.client && room.client !== ws) {
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
            const room = socketToRoom.get(ws);
            if (!room) return;

            const target = (ws === room.host) ? room.client : room.host;
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
