import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";

type Broadcaster = (type: string, payload: unknown) => void;

let wss: WebSocketServer | null = null;

export function attachWebSocket(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "hello", payload: { ts: Date.now() } }));
  });

  return wss;
}

export const broadcast: Broadcaster = (type, payload) => {
  if (!wss) return;
  const message = JSON.stringify({ type, payload });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
};
