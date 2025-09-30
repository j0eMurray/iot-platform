import mqtt from "mqtt";
import { Client } from "pg";
import { z } from "zod";
import pino from "pino";

const log = pino({ name: "ingest" });

const env = {
  MQTT_URL: process.env.MQTT_URL || "mqtt://localhost:1883",
  MQTT_USER: process.env.MQTT_USER || "iot_ingest",
  MQTT_PASS: process.env.MQTT_PASS || "changeme",
  PG_URL: process.env.PG_URL || "postgres://postgres:postgres@localhost:5432/iot"
};

const telemSchema = z.object({ v: z.number().optional(), ts: z.union([z.number(), z.string()]) }).passthrough();

const pg = new Client({ connectionString: env.PG_URL });
await pg.connect();

await pg.query(`
  CREATE TABLE IF NOT EXISTS device (
    id TEXT PRIMARY KEY,
    secret TEXT,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_seen TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS telemetry (
    device_id TEXT,
    ts TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL
  );
`);

const client = mqtt.connect(env.MQTT_URL, {
  username: env.MQTT_USER,
  password: env.MQTT_PASS,
  clean: true
});

client.on("connect", () => {
  log.info("MQTT connected");
  client.subscribe("devices/+/telemetry", { qos: 1 });
});

client.on("message", async (topic, message) => {
  try {
    const [, deviceId] = topic.split("/");
    const raw = JSON.parse(message.toString());
    const data = telemSchema.parse(raw);
    await pg.query("UPDATE device SET last_seen = now() WHERE id=$1", [deviceId]);
    await pg.query(
      "INSERT INTO telemetry(device_id, ts, payload) VALUES ($1, to_timestamp($2::double precision/1000), $3)",
      [deviceId, typeof data.ts === "string" ? Number(data.ts) : data.ts, raw]
    );
  } catch (e) {
    log.error({ err: e }, "ingest error");
  }
});
