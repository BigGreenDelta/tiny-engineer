import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  brokerCall,
  describePause,
  formatLeft,
  parseDuration,
  parsePauseArgs,
  PAUSE_MAX_S,
} from "../src/commands/pause.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "tiny-engineer.js");

test("parseDuration takes unit durations only", () => {
  assert.deepEqual(parseDuration("90s"), { seconds: 90 });
  assert.deepEqual(parseDuration("30m"), { seconds: 1800 });
  assert.deepEqual(parseDuration("2h"), { seconds: 7200 });
  assert.deepEqual(parseDuration("1h30m"), { seconds: 5400 });
  assert.deepEqual(parseDuration("1D"), { seconds: 86400 });
  assert.deepEqual(parseDuration("7d"), { seconds: PAUSE_MAX_S });
  for (const bad of ["5", "", "0m", "m", "1.5h", "-1h", "1h 30m", "8d", "30x"]) {
    assert.ok(parseDuration(bad).error, bad);
  }
});

test("parsePauseArgs: --for only on pause, --token-stdin, no stray words", () => {
  const a = parsePauseArgs(["--for", "30m", "--url", "http://b"], { allowFor: true });
  assert.equal(a.error, undefined);
  assert.equal(a.seconds, 1800);
  assert.equal(a.url, "http://b");
  assert.equal(parsePauseArgs(["--for=2h"], { allowFor: true }).seconds, 7200);
  assert.equal(parsePauseArgs([], { allowFor: true }).seconds, null);
  assert.equal(parsePauseArgs(["--token-stdin"]).tokenStdin, true);
  assert.match(parsePauseArgs(["--for", "30m"]).error ?? "", /Unknown argument/);
  assert.match(parsePauseArgs(["--for"], { allowFor: true }).error ?? "", /requires a duration/);
  assert.match(parsePauseArgs(["now"]).error ?? "", /Unknown argument: now/);
});

test("describePause and formatLeft", () => {
  assert.match(describePause({ paused: false }), /^not paused/);
  assert.match(describePause({ paused: true, since: 0, until: null }), /^paused until resume/);
  const now = 10_000_000;
  assert.match(describePause({ paused: true, since: now, until: now + 1800_000 }, now), /30m left/);
  assert.equal(formatLeft(40_000), "40s");
  assert.equal(formatLeft(3900_000), "1h05m");
  assert.equal(formatLeft(7200_000), "2h");
});

/**
 * Minimal broker double: GET/POST /pause, POST /resume, Bearer check.
 * @param {{ token?: string, notBroker?: boolean }} [opts]
 */
async function fakeBroker(opts = {}) {
  const seen = [];
  let pause = null;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body: raw });
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (opts.notBroker) return reply(404, { ok: false, error: "not found" });
    const view = () => ({ ok: true, paused: pause !== null, since: pause?.since ?? null, until: pause?.until ?? null });
    if (req.method !== "GET" && opts.token && req.headers.authorization !== `Bearer ${opts.token}`) {
      return reply(401, { ok: false, error: "unauthorized" });
    }
    if (req.method === "GET" && req.url === "/pause") return reply(200, view());
    if (req.method === "POST" && req.url === "/pause") {
      const body = raw ? JSON.parse(raw) : {};
      pause = { since: Date.now(), until: body.for_s ? Date.now() + body.for_s * 1000 : null };
      return reply(200, view());
    }
    if (req.method === "POST" && req.url === "/resume") {
      const was = pause !== null;
      pause = null;
      return reply(200, { ...view(), was_paused: was });
    }
    return reply(404, { ok: false, error: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Run the CLI with a clean connection env.
 * @param {string[]} args
 * @param {{ stdin?: string, env?: Record<string, string> }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function cli(args, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, NO_COLOR: "1", TINY_ENGINEER_CONFIG_DIR: "/nonexistent-te-config" };
    for (const key of ["TINY_ENGINEER_URL", "TINY_ENGINEER_TOKEN", "TINY_ENGINEER_TRANSPORT", "TINY_ENGINEER_PORT"]) {
      delete env[key];
    }
    Object.assign(env, opts.env ?? {});
    const child = execFile(process.execPath, [BIN, ...args], { env, cwd: "/" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
    child.stdin?.end(opts.stdin ?? "");
  });
}

test("pause / status / resume against a broker", async () => {
  const broker = await fakeBroker();
  try {
    let r = await cli(["pause", "--for", "30m", "--url", broker.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /paused until .*30m left/);
    assert.deepEqual(JSON.parse(broker.seen.at(-1).body), { for_s: 1800 });

    r = await cli(["status", "--url", broker.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /paused until/);

    r = await cli(["resume", "-q", "--url", broker.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "");

    r = await cli(["resume", "--url", broker.url]);
    assert.match(r.stdout, /was not paused/);

    r = await cli(["pause"], { env: { TINY_ENGINEER_URL: broker.url } });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /paused until resume/);
    assert.deepEqual(JSON.parse(broker.seen.at(-1).body), {});
  } finally {
    await broker.close();
  }
});

test("token from TINY_ENGINEER_TOKEN or --token-stdin; 401 explains", async () => {
  const broker = await fakeBroker({ token: "s3cret" });
  try {
    let r = await cli(["pause", "--url", broker.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /TE_BROKER_TOKEN/);

    r = await cli(["pause", "--url", broker.url, "--token-stdin"], { stdin: "s3cret\n" });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(broker.seen.at(-1).auth, "Bearer s3cret");

    r = await cli(["resume", "--url", broker.url], { env: { TINY_ENGINEER_TOKEN: "s3cret" } });
    assert.equal(r.code, 0, r.stderr);

    r = await cli(["pause", "--url", broker.url, "--token-stdin"], { stdin: "" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /nothing on stdin/);
  } finally {
    await broker.close();
  }
});

test("a robot URL (no /pause) and serial transport fail clearly", async () => {
  const robot = await fakeBroker({ notBroker: true });
  try {
    const r = await cli(["status", "--url", robot.url]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not the robot/);
  } finally {
    await robot.close();
  }
  const r = await cli(["pause", "--transport", "serial"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /needs HTTP/);
  const call = await brokerCall("GET", "/pause", { url: "http://127.0.0.1:9" });
  assert.equal(call.ok, false);
  assert.match(call.ok ? "" : call.error, /broker unreachable/);
});
