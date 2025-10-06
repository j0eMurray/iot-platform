import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { Pool } from "pg";
import pino from "pino";

const log = pino({ name: "api" });

const connectionString =
  process.env.PG_URL ||
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@db:5432/iot";

export const pool = new Pool({
  connectionString,
  // ssl: false, // en dev por defecto no usamos SSL
});

const PORT = Number(process.env.PORT || 3000);

async function waitForDb(retries = 10, delayMs = 1000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log('DB ready');
      return;
    } catch (err) {
      if (err instanceof Error) {
        console.warn(`DB not ready (attempt ${i}/${retries}):`, err.message);
      } else {
        console.warn(`DB not ready (attempt ${i}/${retries}):`, err);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('DB not reachable after retries');
}

await waitForDb();

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: true,        // permite http://localhost:* en dev
  credentials: false,
});
await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.get("/devices/:id/last", async (req) => {
  const { id } = req.params as { id: string };
  const { rows } = await pool.query(
    "SELECT payload, ts FROM telemetry WHERE device_id=$1 ORDER BY ts DESC LIMIT 1",
    [id]
  );
  return rows[0] || {};
});

// 👇 Handler WS correcto: primer parámetro es el WebSocket
app.get("/ws", { websocket: true }, (socket: import("ws").WebSocket) => {
  const timer = setInterval(async () => {
    const { rows } = await pool.query(
      "SELECT device_id, ts, payload FROM telemetry ORDER BY ts DESC LIMIT 20"
    );
    socket.send(JSON.stringify(rows));
  }, 2000);

  socket.on("close", () => clearInterval(timer));
});

app.listen({ port: PORT, host: "0.0.0.0" }, () => log.info(`API on :${PORT}`));
