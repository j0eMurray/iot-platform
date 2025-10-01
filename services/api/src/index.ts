import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { Client } from "pg";
import pino from "pino";

const log = pino({ name: "api" });
const PG_URL = process.env.PG_URL || "postgres://postgres:postgres@localhost:5432/iot";
const PORT = Number(process.env.PORT || 3000);

const pg = new Client({ connectionString: PG_URL });
await pg.connect();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.get("/devices/:id/last", async (req) => {
  const { id } = req.params as { id: string };
  const { rows } = await pg.query(
    "SELECT payload, ts FROM telemetry WHERE device_id=$1 ORDER BY ts DESC LIMIT 1",
    [id]
  );
  return rows[0] || {};
});

// 👇 Handler WS correcto: primer parámetro es el WebSocket
app.get("/ws", { websocket: true }, (socket: import("ws").WebSocket) => {
  const timer = setInterval(async () => {
    const { rows } = await pg.query(
      "SELECT device_id, ts, payload FROM telemetry ORDER BY ts DESC LIMIT 20"
    );
      socket.send(JSON.stringify(rows));
  }, 2000);

    socket.on("close", () => clearInterval(timer));
});

app.listen({ port: PORT, host: "0.0.0.0" }, () => log.info(`API on :${PORT}`));
