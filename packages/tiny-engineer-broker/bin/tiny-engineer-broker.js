#!/usr/bin/env node
import { Referee } from "../src/referee.js";
import { createBroker, robotClient } from "../src/server.js";

/** @param {string} name @param {number} fallback */
function seconds(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} must be a number of seconds, got "${raw}"`);
    process.exit(1);
  }
  return n * 1000;
}

const url = process.env.TE_ROBOT_URL?.trim() || "http://tiny-engineer.local";
const token = process.env.TE_ROBOT_TOKEN?.trim() || null;
const port = Number(process.env.TE_BROKER_PORT?.trim() || 8790);

const broker = createBroker({
  robot: robotClient({ url, token }),
  referee: new Referee({
    stateTtlMs: seconds("TE_STATE_TTL_S", 300),
    attentionRepeatMs: seconds("TE_ATTENTION_REPEAT_S", 30),
    attentionMaxMs: seconds("TE_ATTENTION_MAX_S", 900),
  }),
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
});

await broker.listen(port);
console.log(`face broker on :${port}, robot ${url}${token ? " (token set)" : ""}`);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await broker.close();
    process.exit(0);
  });
}
