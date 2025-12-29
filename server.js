// server.js
// Tiny local-only radar server using Express + WebSocket

const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

let clients = new Map(); // ws -> { id, name, bio, color, coords, lastSeen }

// Broadcast helper
function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getPublicUserList() {
  const list = [];
  for (const [, user] of clients.entries()) {
    list.push({
      id: user.id,
      name: user.name,
      bio: user.bio,
      color: user.color,
      coords: user.coords,
      lastSeen: user.lastSeen,
    });
  }
  return list;
}

wss.on("connection", (ws) => {
  const userId = "u_" + Math.random().toString(36).slice(2, 9);

  clients.set(ws, {
    id: userId,
    name: "New Signal",
    bio: "",
    color: "#3bff99",
    coords: null,
    lastSeen: Date.now(),
  });

  // Send initial state to this client
  send(ws, {
    type: "welcome",
    payload: {
      selfId: userId,
      users: getPublicUserList(),
    },
  });

  // Notify others that a new user exists
  broadcast({
    type: "user-joined",
    payload: {
      user: {
        id: userId,
        name: "New Signal",
        bio: "",
        color: "#3bff99",
        coords: null,
        lastSeen: Date.now(),
      },
    },
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }

    const entry = clients.get(ws);
    if (!entry) return;

    // Update last seen
    entry.lastSeen = Date.now();

    switch (msg.type) {
      case "update-profile": {
        const { name, bio, color } = msg.payload || {};
        if (typeof name === "string") entry.name = name.slice(0, 40);
        if (typeof bio === "string") entry.bio = bio.slice(0, 160);
        if (typeof color === "string") entry.color = color;

        broadcast({
          type: "user-updated",
          payload: {
            user: {
              id: entry.id,
              name: entry.name,
              bio: entry.bio,
              color: entry.color,
              coords: entry.coords,
              lastSeen: entry.lastSeen,
            },
          },
        });
        break;
      }

      case "update-location": {
        const { coords } = msg.payload || {};
        if (
          coords &&
          typeof coords.latitude === "number" &&
          typeof coords.longitude === "number"
        ) {
          entry.coords = {
            latitude: coords.latitude,
            longitude: coords.longitude,
          };

          broadcast({
            type: "user-updated",
            payload: {
              user: {
                id: entry.id,
                name: entry.name,
                bio: entry.bio,
                color: entry.color,
                coords: entry.coords,
                lastSeen: entry.lastSeen,
              },
            },
          });
        }
        break;
      }

      case "chat-private": {
        const { to, text } = msg.payload || {};
        if (!to || !text) return;

        // Deliver only to the target and sender
        for (const [clientWs, user] of clients.entries()) {
          if (
            clientWs === ws ||
            user.id === to
          ) {
            send(clientWs, {
              type: "chat-private",
              payload: {
                from: entry.id,
                to,
                text: text.slice(0, 500),
                ts: Date.now(),
              },
            });
          }
        }
        break;
      }

      case "chat-group": {
        const { text } = msg.payload || {};
        if (!text) return;
        broadcast({
          type: "chat-group",
          payload: {
            from: entry.id,
            text: text.slice(0, 500),
            ts: Date.now(),
          },
        });
        break;
      }

      case "ping": {
        const { to } = msg.payload || {};
        if (!to) return;
        broadcast({
          type: "ping",
          payload: {
            from: entry.id,
            to,
            ts: Date.now(),
          },
        });
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => {
    const entry = clients.get(ws);
    clients.delete(ws);
    if (entry) {
      broadcast({
        type: "user-left",
        payload: {
          id: entry.id,
        },
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Radar server running on http://localhost:${PORT}`);
});
