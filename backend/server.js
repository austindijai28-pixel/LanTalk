import os from "node:os";
import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 3001);
const HOSTNAME = os.hostname();
const clients = new Map();

function getLanIPv4s() {
  const found = [];
  for (const [iface, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        found.push({ interface: iface, address: entry.address, netmask: entry.netmask });
      }
    }
  }
  return found;
}

function clientAddress(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  const raw = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : socket.handshake.address) || "";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function publicClient(client) {
  return {
    id: client.id,
    name: client.name,
    ips: client.ips,
    connectedAt: client.connectedAt
  };
}

function emitPeers() {
  const list = [...clients.values()].map(publicClient);
  io.emit("peers", list);
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ["GET", "POST"] } });

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    name: HOSTNAME,
    port: PORT,
    ips: getLanIPv4s(),
    peers: [...clients.values()].map(publicClient)
  });
});

io.on("connection", (socket) => {
  const ip = clientAddress(socket);
  const client = {
    id: socket.id,
    name: `${HOSTNAME} device`,
    ips: [ip],
    connectedAt: Date.now()
  };
  clients.set(socket.id, client);

  socket.emit("identity", {
    id: socket.id,
    name: HOSTNAME,
    ips: getLanIPv4s(),
    clientIp: ip,
    signalingPort: PORT
  });
  emitPeers();

  socket.on("register-name", (name) => {
    const cleanName = String(name || "").trim().slice(0, 40);
    if (cleanName) client.name = cleanName;
    emitPeers();
  });

  socket.on("call-signal", ({ targetId, payload }) => {
    if (!targetId || !payload || typeof payload !== "object") return;
    const target = io.sockets.sockets.get(targetId);
    if (target) {
      target.emit("call-signal", {
        fromId: socket.id,
        fromName: client.name,
        payload
      });
    }
  });

  socket.on("disconnect", () => {
    clients.delete(socket.id);
    emitPeers();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`LAN Voice Call backend listening on port ${PORT}`);
  console.log("Server LAN IPv4 addresses:", getLanIPv4s());
});
